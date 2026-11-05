import { Hono } from "hono";
import { Buffer } from "node:buffer";
import Anthropic from "@anthropic-ai/sdk";
import { checkPasscode, clearCookie, isAuthed, sessionCookie } from "./auth";
import { AiError, analyzePhoto, researchPrice, writeBundlePost, CATEGORIES, CONDITIONS, DECISIONS } from "./ai";

type App = { Bindings: Env };
const app = new Hono<App>();

// ---------- helpers ----------

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

async function getSettings(env: Env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    location: map.location ?? "",
    sell_threshold: Number(map.sell_threshold ?? 20) || 20,
    household_notes: map.household_notes ?? "",
  };
}

type ItemRow = {
  id: string;
  room_id: string;
  photo_id: string | null;
  name: string;
  category: string;
  brand: string;
  description: string;
  condition: string;
  size: string;
  quantity: number;
  resale_high: number;
  asking_price: number;
  image_key: string | null;
  enhanced_key: string | null;
  [col: string]: unknown;
  tags: string;
  bbox: string | null;
  listed_on: string;
  price_research: string | null;
  decision_confirmed: number;
};

function itemOut(r: ItemRow) {
  const safe = (s: string | null, d: unknown) => {
    try {
      return s ? JSON.parse(s) : d;
    } catch {
      return d;
    }
  };
  return {
    ...r,
    tags: safe(r.tags, []),
    bbox: safe(r.bbox, null),
    listed_on: safe(r.listed_on, []),
    price_research: safe(r.price_research, null),
    decision_confirmed: !!r.decision_confirmed,
  };
}

async function getItem(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<ItemRow>();
  return row ? itemOut(row) : null;
}

function errorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key is missing or invalid.";
  if (e instanceof Anthropic.RateLimitError) return "AI rate limit reached; wait a moment and retry.";
  if (e instanceof Anthropic.APIError) return `AI error (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : "Unknown error";
}

// ---------- auth ----------

app.post("/api/login", async (c) => {
  const { passcode } = await c.req.json<{ passcode: string }>();
  if (!(await checkPasscode(c.env, String(passcode ?? "")))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return c.json({ error: "Wrong passcode" }, 401);
  }
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", await sessionCookie(c.env, secure));
  return c.json({ ok: true });
});

// Public, no data: lets a deploy be verified (latest applied migration).
app.get("/api/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
    .first<{ name: string }>()
    .catch(() => null);
  return c.json({ ok: true, migration: row?.name ?? null });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", clearCookie());
  return c.json({ ok: true });
});

// Everything below requires a session.
app.use("/api/*", async (c, next) => {
  if (!(await isAuthed(c.env, c.req.header("Cookie") ?? null))) return c.json({ error: "Not signed in" }, 401);
  await next();
});
app.use("/img/*", async (c, next) => {
  if (!(await isAuthed(c.env, c.req.header("Cookie") ?? null))) return c.text("Not signed in", 401);
  await next();
});

app.get("/api/me", (c) => c.json({ ok: true }));

// ---------- images ----------

app.get("/img/:key{.+}", async (c) => {
  const obj = await c.env.PHOTOS.get(c.req.param("key"));
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      // Keys are never reused, so the browser can cache forever.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

// ---------- rooms ----------

app.get("/api/rooms", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM rooms ORDER BY sort_order, name").all();
  return c.json(results);
});

app.post("/api/rooms", async (c) => {
  const { name, icon } = await c.req.json<{ name: string; icon?: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 4);
  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) m FROM rooms").first<{ m: number }>();
  await c.env.DB.prepare("INSERT INTO rooms (id, name, icon, sort_order) VALUES (?, ?, ?, ?)")
    .bind(id, name.trim(), icon ?? "box", (max?.m ?? 0) + 1)
    .run();
  return c.json({ id, name: name.trim(), icon: icon ?? "box" });
});

app.patch("/api/rooms/:id", async (c) => {
  const { name, icon } = await c.req.json<{ name?: string; icon?: string }>();
  await c.env.DB.prepare("UPDATE rooms SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?")
    .bind(name?.trim() || null, icon ?? null, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.delete("/api/rooms/:id", async (c) => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) n FROM items WHERE room_id = ?").bind(c.req.param("id")).first<{ n: number }>();
  if ((n?.n ?? 0) > 0) return c.json({ error: "Move or delete this room's items first." }, 400);
  await c.env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- settings ----------

app.get("/api/settings", async (c) => c.json(await getSettings(c.env)));

app.put("/api/settings", async (c) => {
  const body = await c.req.json<Record<string, string | number>>();
  const allowed = ["location", "sell_threshold", "household_notes"];
  const stmts = Object.entries(body)
    .filter(([k]) => allowed.includes(k))
    .map(([k, v]) =>
      c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v)),
    );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await getSettings(c.env));
});

// ---------- photos: upload + AI analysis ----------

async function analyzeAndStore(env: Env, photoId: string) {
  const photo = await env.DB.prepare("SELECT p.*, r.name room_name FROM photos p JOIN rooms r ON r.id = p.room_id WHERE p.id = ?")
    .bind(photoId)
    .first<{ id: string; room_id: string; r2_key: string; hint: string | null; room_name: string }>();
  if (!photo) throw new Error("Photo not found");
  const obj = await env.PHOTOS.get(photo.r2_key);
  if (!obj) throw new Error("Photo file missing");
  const buf = await obj.arrayBuffer();
  const settings = await getSettings(env);

  try {
    const analysis = await analyzePhoto(
      env,
      { base64: Buffer.from(buf).toString("base64"), mediaType: "image/jpeg" },
      {
        roomName: photo.room_name,
        location: settings.location,
        householdNotes: settings.household_notes,
        sellThreshold: settings.sell_threshold,
        hint: photo.hint ?? undefined,
      },
    );
    // Retrying a photo replaces the items it produced before.
    const stmts = [env.DB.prepare("DELETE FROM items WHERE photo_id = ?").bind(photoId)];
    const ids: string[] = [];
    for (const it of analysis.items) {
      const id = crypto.randomUUID();
      ids.push(id);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO items (id, room_id, photo_id, name, category, brand, description, condition, size, quantity,
             resale_low, resale_high, asking_price, replacement_value, decision, ai_reason, best_platform,
             listing_title, listing_description, tags, bbox, image_key)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          id, photo.room_id, photoId, it.name, it.category, it.brand, it.description, it.condition, it.size, it.quantity,
          it.resale_low, it.resale_high, it.asking_price, it.replacement_value, it.recommendation, it.recommendation_reason,
          it.best_platform, it.listing_title, it.listing_description, JSON.stringify(it.tags), JSON.stringify(it.bbox),
          photo.r2_key, // until the phone uploads a cropped version
        ),
      );
    }
    stmts.push(env.DB.prepare("UPDATE photos SET status='done', error=NULL, ai_notes=? WHERE id=?").bind(analysis.photo_notes, photoId));
    await env.DB.batch(stmts);
    const { results } = await env.DB.prepare(`SELECT * FROM items WHERE photo_id = ?`).bind(photoId).all<ItemRow>();
    return { status: "done" as const, notes: analysis.photo_notes, items: results.map(itemOut) };
  } catch (e) {
    const msg = errorMessage(e);
    await env.DB.prepare("UPDATE photos SET status='error', error=? WHERE id=?").bind(msg, photoId).run();
    return { status: "error" as const, error: msg, items: [] };
  }
}

app.post("/api/photos", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const roomId = String(form.get("room_id") ?? "");
  if (!(file instanceof File) || !roomId) return c.json({ error: "file and room_id required" }, 400);
  const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(roomId).first();
  if (!room) return c.json({ error: "Unknown room" }, 400);

  const id = crypto.randomUUID();
  const key = `photos/${id}.jpg`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("INSERT INTO photos (id, room_id, r2_key, width, height, hint) VALUES (?,?,?,?,?,?)")
    .bind(id, roomId, key, Number(form.get("width")) || null, Number(form.get("height")) || null, String(form.get("hint") ?? "") || null)
    .run();

  // waitUntil keeps the analysis running if the phone drops the connection mid-request;
  // the items still land in the inventory and show up on the next refresh.
  const work = analyzeAndStore(c.env, id);
  c.executionCtx.waitUntil(work.catch(() => {}));
  const result = await work;
  return c.json({ photo_id: id, photo_key: key, ...result });
});

app.post("/api/photos/:id/retry", async (c) => {
  const result = await analyzeAndStore(c.env, c.req.param("id"));
  const p = await c.env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(c.req.param("id")).first<{ r2_key: string }>();
  return c.json({ photo_id: c.req.param("id"), photo_key: p?.r2_key, ...result });
});

app.get("/api/photos/failed", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT p.id, p.room_id, p.r2_key, p.error, p.created_at, r.name room_name FROM photos p JOIN rooms r ON r.id = p.room_id WHERE p.status = 'error' OR (p.status = 'pending' AND p.created_at < datetime('now', '-5 minutes')) ORDER BY p.created_at DESC",
  ).all();
  return c.json(results);
});

app.delete("/api/photos/:id", async (c) => {
  const p = await c.env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(c.req.param("id")).first<{ r2_key: string }>();
  if (p) {
    const inUse = await c.env.DB.prepare("SELECT COUNT(*) n FROM items WHERE image_key = ?").bind(p.r2_key).first<{ n: number }>();
    if (!inUse?.n) await c.env.PHOTOS.delete(p.r2_key);
  }
  await c.env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- items ----------

app.get("/api/items", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM items ORDER BY created_at DESC").all<ItemRow>();
  return c.json(results.map(itemOut));
});

app.get("/api/items/:id", async (c) => {
  const item = await getItem(c.env, c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "Not found" }, 404);
});

app.post("/api/items", async (c) => {
  // Manual add (no photo).
  const b = await c.req.json<{ room_id: string; name: string }>();
  if (!b.room_id || !b.name?.trim()) return c.json({ error: "room_id and name required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO items (id, room_id, name, decision_confirmed) VALUES (?,?,?,1)").bind(id, b.room_id, b.name.trim()).run();
  return c.json(await getItem(c.env, id));
});

const EDITABLE: Record<string, (v: unknown) => unknown> = {
  name: String,
  room_id: String,
  category: (v) => ((CATEGORIES as readonly string[]).includes(String(v)) ? v : "other"),
  brand: String,
  description: String,
  condition: (v) => ((CONDITIONS as readonly string[]).includes(String(v)) ? v : "good"),
  size: String,
  quantity: (v) => Math.max(1, Math.round(Number(v) || 1)),
  resale_low: Number,
  resale_high: Number,
  asking_price: Number,
  replacement_value: Number,
  decision: (v) => ((DECISIONS as readonly string[]).includes(String(v)) ? v : "keep"),
  decision_confirmed: (v) => (v ? 1 : 0),
  best_platform: String,
  listing_title: (v) => String(v).slice(0, 80),
  listing_description: String,
  tags: (v) => JSON.stringify(Array.isArray(v) ? v.map(String) : []),
  status: (v) => (["active", "listed", "sold", "donated"].includes(String(v)) ? v : "active"),
  listed_on: (v) => JSON.stringify(Array.isArray(v) ? v.map(String) : []),
  sold_price: (v) => (v === null || v === "" ? null : Number(v)),
  notes: String,
};

async function patchItem(env: Env, id: string, body: Record<string, unknown>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!(k in EDITABLE)) continue;
    sets.push(`${k} = ?`);
    vals.push(EDITABLE[k](v));
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(now());
  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
}

app.patch("/api/items/:id", async (c) => {
  await patchItem(c.env, c.req.param("id"), await c.req.json());
  const item = await getItem(c.env, c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "Not found" }, 404);
});

app.post("/api/items/bulk", async (c) => {
  const { ids, patch } = await c.req.json<{ ids: string[]; patch: Record<string, unknown> }>();
  for (const id of ids ?? []) await patchItem(c.env, id, patch ?? {});
  return c.json({ ok: true });
});

async function deleteItemFiles(env: Env, item: { image_key?: unknown; enhanced_key?: unknown; photo_id?: unknown }) {
  const photo = item.photo_id
    ? await env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(item.photo_id).first<{ r2_key: string }>()
    : null;
  for (const k of [item.image_key, item.enhanced_key]) {
    if (typeof k === "string" && k && k !== photo?.r2_key) await env.PHOTOS.delete(k);
  }
}

app.delete("/api/items/:id", async (c) => {
  const item = await getItem(c.env, c.req.param("id"));
  if (!item) return c.json({ ok: true });
  await deleteItemFiles(c.env, item);
  await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// Upload a cropped (kind=crop) or cleaned-up (kind=enhanced) image for an item.
app.put("/api/items/:id/image", async (c) => {
  const kind = c.req.query("kind") === "enhanced" ? "enhanced" : "crop";
  const item = await getItem(c.env, c.req.param("id"));
  if (!item) return c.json({ error: "Not found" }, 404);
  const type = c.req.header("Content-Type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const key = `items/${item.id}-${kind}-${Date.now()}.${ext}`;
  await c.env.PHOTOS.put(key, await c.req.arrayBuffer(), { httpMetadata: { contentType: type } });

  const col = kind === "enhanced" ? "enhanced_key" : "image_key";
  const old = item[col as "image_key" | "enhanced_key"];
  await c.env.DB.prepare(`UPDATE items SET ${col} = ?, updated_at = ? WHERE id = ?`).bind(key, now(), item.id).run();
  const photo = item.photo_id
    ? await c.env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(item.photo_id).first<{ r2_key: string }>()
    : null;
  if (typeof old === "string" && old && old !== photo?.r2_key) await c.env.PHOTOS.delete(old);
  return c.json(await getItem(c.env, item.id));
});

app.delete("/api/items/:id/image", async (c) => {
  // Removes the enhanced version, reverting to the original crop.
  const item = await getItem(c.env, c.req.param("id"));
  if (item?.enhanced_key) {
    await c.env.PHOTOS.delete(String(item.enhanced_key));
    await c.env.DB.prepare("UPDATE items SET enhanced_key = NULL WHERE id = ?").bind(item.id).run();
  }
  return c.json(await getItem(c.env, c.req.param("id")));
});

app.post("/api/items/:id/research", async (c) => {
  const item = await getItem(c.env, c.req.param("id"));
  if (!item) return c.json({ error: "Not found" }, 404);
  const settings = await getSettings(c.env);
  try {
    const r = await researchPrice(
      c.env,
      {
        name: String(item.name),
        brand: String(item.brand),
        condition: String(item.condition),
        size: String(item.size),
        description: String(item.description),
        category: String(item.category),
      },
      settings.location,
    );
    await c.env.DB.prepare(
      "UPDATE items SET resale_low=?, resale_high=?, asking_price=?, replacement_value=CASE WHEN ? > 0 THEN ? ELSE replacement_value END, price_research=?, updated_at=? WHERE id=?",
    )
      .bind(r.resale_low, r.resale_high, r.asking_price, r.replacement_value, r.replacement_value, JSON.stringify(r), now(), item.id)
      .run();
    return c.json(await getItem(c.env, item.id));
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 502);
  }
});

// ---------- selling ----------

app.post("/api/bundle", async (c) => {
  const { ids, kind, details } = await c.req.json<{ ids: string[]; kind: "garage_sale" | "marketplace_bundle"; details?: string }>();
  if (!ids?.length) return c.json({ error: "Pick at least one item" }, 400);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(`SELECT * FROM items WHERE id IN (${placeholders})`).bind(...ids).all<ItemRow>();
  const settings = await getSettings(c.env);
  try {
    const post = await writeBundlePost(
      c.env,
      results.map((r) => ({
        name: String(r.name),
        condition: String(r.condition),
        size: String(r.size),
        asking_price: Number(r.asking_price) || Number(r.resale_high) || 0,
        quantity: Number(r.quantity) || 1,
      })),
      { kind: kind === "garage_sale" ? "garage_sale" : "marketplace_bundle", location: settings.location, details: details ?? "" },
    );
    return c.json(post);
  } catch (e) {
    return c.json({ error: errorMessage(e) }, 502);
  }
});

// ---------- export ----------

app.get("/api/export.csv", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.name room, i.name, i.category, i.brand, i.description, i.condition, i.size, i.quantity,
            i.replacement_value, i.resale_low, i.resale_high, i.asking_price, i.decision, i.status, i.sold_price,
            i.image_key, i.created_at
       FROM items i JOIN rooms r ON r.id = i.room_id ORDER BY r.sort_order, i.category, i.name`,
  ).all<Record<string, unknown>>();
  const origin = new URL(c.req.url).origin;
  const cols = [
    "room", "name", "category", "brand", "description", "condition", "size", "quantity",
    "replacement_value", "resale_low", "resale_high", "asking_price", "decision", "status", "sold_price", "photo_url", "added",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = results.map((r) =>
    [
      r.room, r.name, r.category, r.brand, r.description, r.condition, r.size, r.quantity,
      r.replacement_value, r.resale_low, r.resale_high, r.asking_price, r.decision, r.status, r.sold_price,
      r.image_key ? `${origin}/img/${r.image_key}` : "", r.created_at,
    ].map(esc).join(","),
  );
  return new Response([cols.join(","), ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="home-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
