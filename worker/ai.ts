import Anthropic from "@anthropic-ai/sdk";

export const CATEGORIES = [
  "clothing",
  "shoes",
  "accessories",
  "furniture",
  "electronics",
  "toys",
  "books",
  "media",
  "sports",
  "outdoor",
  "tools",
  "kitchen",
  "appliances",
  "decor",
  "bedding",
  "baby",
  "collectibles",
  "office",
  "other",
] as const;

export const CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export const DECISIONS = ["keep", "sell", "donate"] as const;
export const PLATFORMS = ["ebay", "facebook", "depop", "garage_sale", "donate"] as const;

export interface DetectedItem {
  name: string;
  category: (typeof CATEGORIES)[number];
  brand: string;
  description: string;
  condition: (typeof CONDITIONS)[number];
  size: string;
  quantity: number;
  resale_low: number;
  resale_high: number;
  asking_price: number;
  replacement_value: number;
  recommendation: (typeof DECISIONS)[number];
  recommendation_reason: string;
  best_platform: (typeof PLATFORMS)[number];
  listing_title: string;
  listing_description: string;
  tags: string[];
  bbox: { x: number; y: number; w: number; h: number };
  model: string;
  serial_number: string;
  purchase_date: string;
  purchase_price: number;
  purchase_store: string;
}

export interface PhotoAnalysis {
  items: DetectedItem[];
  photo_notes: string;
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "photo_notes"],
  properties: {
    photo_notes: { type: "string", description: "One short sentence about the photo, e.g. what was skipped and why." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name", "category", "brand", "description", "condition", "size", "quantity",
          "resale_low", "resale_high", "asking_price", "replacement_value",
          "recommendation", "recommendation_reason", "best_platform",
          "listing_title", "listing_description", "tags", "bbox",
          "model", "serial_number", "purchase_date", "purchase_price", "purchase_store",
        ],
        properties: {
          name: { type: "string", description: "Short specific name, e.g. 'Patagonia Down Sweater Jacket (kids M)'" },
          category: { type: "string", enum: [...CATEGORIES] },
          brand: { type: "string", description: "Brand if visible or confidently recognizable, else empty string" },
          description: { type: "string", description: "1-2 factual sentences: material, color, notable features, visible wear" },
          condition: { type: "string", enum: [...CONDITIONS] },
          size: { type: "string", description: "Clothing/shoe size or dimensions if knowable, else empty string" },
          quantity: { type: "integer" },
          resale_low: { ...num, description: "Realistic used-market price in USD, low end" },
          resale_high: { ...num, description: "Realistic used-market price in USD, high end" },
          asking_price: { ...num, description: "Suggested list price in USD for a reasonably quick sale" },
          replacement_value: { ...num, description: "Cost to buy a comparable item new today in USD (for insurance)" },
          recommendation: { type: "string", enum: [...DECISIONS] },
          recommendation_reason: { type: "string", description: "One short sentence" },
          best_platform: { type: "string", enum: [...PLATFORMS] },
          listing_title: { type: "string", description: "Marketplace title, max 80 characters, keyword-rich, no emojis" },
          listing_description: { type: "string", description: "3-5 sentence listing body in a friendly, honest voice. Mention condition and size." },
          tags: { type: "array", items: str, description: "3-8 lowercase search keywords" },
          model: { type: "string", description: "Model name/number if stated in the owner's note or legible on the item, else empty string" },
          serial_number: { type: "string", description: "Serial number only if stated in the owner's note or legible, else empty string" },
          purchase_date: { type: "string", description: "When the owner bought it, only if the owner's note says: YYYY-MM-DD, YYYY-MM or YYYY; else empty string" },
          purchase_price: { ...num, description: "What the owner paid in USD, only if the owner's note says; else 0" },
          purchase_store: { type: "string", description: "Where the owner bought it, only if the owner's note says; else empty string" },
          bbox: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "w", "h"],
            description: "Approximate bounding box of the item as fractions (0-1) of image width/height; x,y is the top-left corner",
            properties: { x: num, y: num, w: num, h: num },
          },
        },
      },
    },
  },
} as const;

function client(env: Env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function model(env: Env) {
  return env.CLAUDE_MODEL || "claude-opus-5-5";
}

export class AiError extends Error {}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  if (msg.stop_reason === "refusal") {
    throw new AiError("The AI declined to process this request.");
  }
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export interface AnalyzeContext {
  roomName: string;
  location: string;
  householdNotes: string;
  sellThreshold: number;
  hint?: string;
}

const ANALYZE_SYSTEM = `You catalog a family's belongings from photos for a home inventory app. The owner is a minimalist who wants three things from each photo: a record of what they own (for insurance), a realistic value for each item, and a suggestion of whether to keep, sell or donate it.

How to catalog a photo:
- List each distinct, ownable item that is clearly visible. Group identical or near-identical small things into one entry with a quantity (e.g. "Kids' graphic t-shirts, size 6", quantity 5) instead of listing each one.
- Skip fixtures that come with the house (walls, built-in shelves, light switches, outlets, windows, flooring) and trash.
- If the photo is blurry or ambiguous, still give your best identification and say so in the description.
- Prices are for the US used market (Facebook Marketplace, eBay, Depop sold listings), not retail. Kids' clothing and generic furniture resell for much less than people expect; be realistic. Recognized brands, vintage items, electronics and tools hold value better.
- Replacement value is what it would cost to buy a comparable item new today.

Keep / sell / donate:
- "keep" for things that look actively used or essential (the bed someone sleeps in, a desk in use, everyday appliances) and anything that looks sentimental or irreplaceable (artwork by kids, heirlooms, photos).
- Otherwise "sell" when the realistic resale high is at or above the owner's sell threshold, and "donate" when it is below (selling isn't worth the hassle).
- best_platform: "depop" for trendy, branded or vintage clothing and accessories aimed at younger buyers; "ebay" for electronics, collectibles, brand-name items, and anything small and shippable that is worth over about $40; "facebook" for furniture, large or bulky items, kids' gear, toys and everyday household goods; "garage_sale" for low-value items worth selling only in a bundle; "donate" when recommending donation.

Listing copy should be honest, specific and ready to paste.

The owner's note (often dictated by voice, so expect transcription slips) is the most reliable source: it can name the exact brand and model, how old something is, what they paid, or its condition. Trust it over what you see, and use it in the name, description and listing copy. Only fill model, serial number and purchase details from the note or from text legible in the photo; never guess them.`;

export async function analyzePhoto(
  env: Env,
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  ctx: AnalyzeContext,
): Promise<PhotoAnalysis> {
  if (env.MOCK_AI === "1") return mockAnalysis(ctx);
  const details = [
    `Room: ${ctx.roomName}`,
    ctx.location ? `Owner's location (for local pricing): ${ctx.location}` : "",
    ctx.householdNotes ? `Household notes: ${ctx.householdNotes}` : "",
    `Owner's sell threshold: $${ctx.sellThreshold}`,
    ctx.hint ? `Owner's note about this photo: ${ctx.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client(env).beta.messages.create({
    model: model(env),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown> },
    },
    system: ANALYZE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: `${details}\n\nCatalog the items in this photo.` },
        ],
      },
    ],
  });

  const text = textOf(msg);
  let parsed: PhotoAnalysis;
  try {
    parsed = JSON.parse(text) as PhotoAnalysis;
  } catch {
    throw new AiError(
      msg.stop_reason === "max_tokens" ? "Too many items in one photo; try a closer shot." : "Couldn't read the AI's response.",
    );
  }
  for (const item of parsed.items) {
    item.quantity = Math.max(1, Math.round(item.quantity || 1));
    item.bbox = clampBox(item.bbox);
    item.listing_title = item.listing_title.slice(0, 80);
    item.purchase_date = normDate(item.purchase_date);
    item.purchase_price = Math.max(0, Number(item.purchase_price) || 0);
  }
  return parsed;
}

/** Keep YYYY, YYYY-MM or YYYY-MM-DD; anything else becomes "". */
export function normDate(v: unknown): string {
  const m = String(v ?? "").trim().match(/^(\d{4})(-(0[1-9]|1[0-2]))?(-(0[1-9]|[12]\d|3[01]))?/);
  return m ? m[0] : "";
}

function clampBox(b: { x: number; y: number; w: number; h: number }) {
  const c = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = c(b?.x);
  const y = c(b?.y);
  return { x, y, w: Math.max(0.02, Math.min(1 - x, c(b?.w))), h: Math.max(0.02, Math.min(1 - y, c(b?.h))) };
}

export interface PriceResearch {
  resale_low: number;
  resale_high: number;
  asking_price: number;
  replacement_value: number;
  summary: string;
  comparables: { title: string; price: number; url: string; sold: boolean }[];
  checked_at: string;
}

/** Look up real comparable listings with web search and return a refined price. */
export async function researchPrice(
  env: Env,
  item: { name: string; brand: string; condition: string; size: string; description: string; category: string },
  location: string,
): Promise<PriceResearch> {
  if (env.MOCK_AI === "1") {
    return {
      resale_low: 30, resale_high: 45, asking_price: 40, replacement_value: 130,
      summary: "Mock: similar chairs sold for $30-45.",
      comparables: [{ title: "Wood desk chair (mock)", price: 38, url: "https://example.com", sold: true }],
      checked_at: new Date().toISOString(),
    };
  }
  const prompt = `Find the realistic used resale price for this item by searching for comparable listings, preferring recently SOLD listings (eBay sold, Facebook Marketplace, Depop, Poshmark, Mercari).

Item: ${item.name}
Brand: ${item.brand || "unknown"}
Category: ${item.category}
Condition: ${item.condition}
Size: ${item.size || "n/a"}
Details: ${item.description}
${location ? `Seller location: ${location}` : ""}

Do at most a few searches. Then reply with only a JSON object (no prose before or after) of this shape:
{"resale_low": number, "resale_high": number, "asking_price": number, "replacement_value": number, "summary": "1-2 sentences on what you found", "comparables": [{"title": string, "price": number, "url": string, "sold": boolean}]}
Include up to 5 comparables you actually found. Prices in USD.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let msg: Anthropic.Beta.BetaMessage | undefined;
  // Server tools can pause a long turn; send it back so the server continues.
  for (let i = 0; i < 4; i++) {
    msg = await client(env).beta.messages.create({
      model: model(env),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  const text = textOf(msg!);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const r = JSON.parse(json) as Omit<PriceResearch, "checked_at">;
    return {
      resale_low: Number(r.resale_low) || 0,
      resale_high: Number(r.resale_high) || 0,
      asking_price: Number(r.asking_price) || 0,
      replacement_value: Number(r.replacement_value) || 0,
      summary: String(r.summary ?? ""),
      comparables: Array.isArray(r.comparables) ? r.comparables.slice(0, 5) : [],
      checked_at: new Date().toISOString(),
    };
  } catch {
    throw new AiError("Couldn't read the price research result.");
  }
}

export interface BundleItem {
  name: string;
  condition: string;
  size: string;
  asking_price: number;
  quantity: number;
}

/** Write one combined post (garage sale or Marketplace bundle) for many items. */
export async function writeBundlePost(
  env: Env,
  items: BundleItem[],
  opts: { kind: "garage_sale" | "marketplace_bundle"; location: string; details: string },
): Promise<{ title: string; body: string; total: number }> {
  if (env.MOCK_AI === "1") {
    return {
      title: "Mock bundle post",
      body: items.map((i) => `- ${i.name} $${i.asking_price}`).join("\n"),
      total: items.reduce((s, i) => s + i.asking_price * i.quantity, 0),
    };
  }
  const list = items
    .map((i) => `- ${i.name}${i.size ? ` (size ${i.size})` : ""}, ${i.condition.replace("_", " ")}, qty ${i.quantity}, $${i.asking_price}`)
    .join("\n");
  const kindText =
    opts.kind === "garage_sale"
      ? "a garage sale announcement for Facebook Marketplace / local groups / Nextdoor. Group items by type and list highlights with prices; mention that everything else is priced to go."
      : "a single Facebook Marketplace post selling these items, individually priced, with a discount if someone buys several. Group items by type.";

  const msg = await client(env).beta.messages.create({
    model: model(env),
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "body"],
          properties: {
            title: { type: "string", description: "Post title, max 80 characters" },
            body: { type: "string", description: "Post body, plain text with line breaks; short bullet lines are fine" },
          },
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `Write ${kindText}\n\n${opts.location ? `Location: ${opts.location}\n` : ""}${opts.details ? `Seller's details (date, time, address, pickup notes): ${opts.details}\n` : ""}\nItems:\n${list}\n\nKeep it friendly and scannable. Don't invent details that aren't given; leave a [date/time] placeholder if the seller didn't give one.`,
      },
    ],
  });
  const r = JSON.parse(textOf(msg)) as { title: string; body: string };
  const total = items.reduce((s, i) => s + i.asking_price * i.quantity, 0);
  return { title: r.title.slice(0, 80), body: r.body, total };
}

export interface AspectSpec {
  name: string;
  required: boolean;
  selectionOnly: boolean;
  maxLength: number;
  values: string[];
}

/** Fill an eBay category's item specifics (Brand, Size, Color, Type…) from what we know about the item. */
export async function fillAspects(
  env: Env,
  item: { name: string; brand: string; size: string; description: string; title: string },
  categoryPath: string,
  specs: AspectSpec[],
): Promise<Record<string, string[]>> {
  if (!specs.length) return {};
  let filled: { name: string; value: string }[];
  if (env.MOCK_AI === "1") {
    filled = specs.filter((s) => s.required).map((s) => ({ name: s.name, value: s.name === "Brand" ? item.brand || "Unbranded" : s.values[0] ?? "Unknown" }));
  } else {
    const specText = specs
      .map((s) => `- ${s.name}${s.required ? " (REQUIRED)" : ""}${s.values.length ? `${s.selectionOnly ? " — must be one of" : " — e.g."}: ${s.values.join(" | ")}` : ""}`)
      .join("\n");
    const msg = await client(env).beta.messages.create({
      model: model(env),
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["aspects"],
            properties: {
              aspects: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "value"],
                  properties: { name: { type: "string" }, value: { type: "string" } },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "user",
          content: `Fill in eBay item specifics for this listing in the category "${categoryPath}".

Item: ${item.name}
Title: ${item.title}
Brand: ${item.brand || "(unknown)"}
Size: ${item.size || "(unknown)"}
Description: ${item.description}

Item specifics:
${specText}

Return every REQUIRED specific. Add the others only when the item details make the answer clear; don't guess. When a value list is given, prefer its exact wording. If the brand is unknown, use "Unbranded". For a required specific you can't determine, use "Unknown" unless the list offers something better (e.g. "Does Not Apply").`,
        },
      ],
    });
    filled = (JSON.parse(textOf(msg)) as { aspects: { name: string; value: string }[] }).aspects;
  }

  const out: Record<string, string[]> = {};
  for (const f of filled) {
    const spec = specs.find((s) => s.name.toLowerCase() === f.name.trim().toLowerCase());
    const value = f.value?.trim();
    if (!spec || !value) continue;
    const match = spec.values.find((v) => v.toLowerCase() === value.toLowerCase());
    if (spec.selectionOnly && spec.values.length && !match) continue;
    out[spec.name] = [(match ?? value).slice(0, spec.maxLength)];
  }
  return out;
}

export interface DocumentReading {
  kind: "receipt" | "manual" | "warranty" | "other";
  title: string;
  summary: string;
  store: string;
  purchase_date: string;
  purchase_price: number;
  model: string;
  serial_number: string;
  warranty_expires: string;
  warranty_note: string;
}

/** Read a receipt, manual or warranty (PDF or photo) and pull out purchase and warranty details. */
export async function readDocument(
  env: Env,
  file: { base64: string; mediaType: string },
  item: { name: string; brand: string },
): Promise<DocumentReading> {
  if (env.MOCK_AI === "1") {
    return {
      kind: "receipt", title: "Mock receipt", summary: "Mock: bought at Best Buy.", store: "Best Buy",
      purchase_date: "2024-03-15", purchase_price: 199, model: "", serial_number: "",
      warranty_expires: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10), warranty_note: "Mock 1-year warranty",
    };
  }
  const source =
    file.mediaType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } } as const)
      : ({ type: "image", source: { type: "base64", media_type: file.mediaType as "image/jpeg", data: file.base64 } } as const);
  const today = new Date().toISOString().slice(0, 10);

  const msg = await client(env).beta.messages.create({
    model: model(env),
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "title", "summary", "store", "purchase_date", "purchase_price", "model", "serial_number", "warranty_expires", "warranty_note"],
          properties: {
            kind: { type: "string", enum: ["receipt", "manual", "warranty", "other"] },
            title: { type: "string", description: "Short name for the document, e.g. 'Best Buy receipt' or 'X100V owner's manual'" },
            summary: { type: "string", description: "One sentence on what's useful in it" },
            store: { type: "string", description: "Seller/store on a receipt, else empty" },
            purchase_date: { type: "string", description: "Purchase date YYYY-MM-DD if shown, else empty" },
            purchase_price: { ...num, description: "Price paid for this item in USD (the item's line, not the whole receipt if it has other things), else 0" },
            model: { type: "string", description: "Model name/number if shown, else empty" },
            serial_number: { type: "string", description: "Serial number if shown, else empty" },
            warranty_expires: { type: "string", description: "Warranty end date YYYY-MM-DD, else empty" },
            warranty_note: { type: "string", description: "One short line on the warranty and where the date came from, else empty" },
          },
        },
      },
    },
    messages: [
      {
        role: "user",
        content: [
          source,
          {
            type: "text",
            text: `This document belongs to a household item: "${item.name}"${item.brand ? ` (${item.brand})` : ""}. Today is ${today}.

Read it and fill in what it shows. For warranty_expires: use the warranty terms if the document states them (purchase date + stated length, or a printed end date). If it's a receipt or manual without stated terms but you know the manufacturer's standard warranty for this kind of product with confidence (e.g. Apple: 1 year), compute it from the purchase date and say in warranty_note that it's the standard term, not stated on the document. Otherwise leave it empty. Leave any field empty (or 0) that the document doesn't show; don't guess.`,
          },
        ],
      },
    ],
  });
  const r = JSON.parse(textOf(msg)) as DocumentReading;
  return {
    ...r,
    purchase_date: normDate(r.purchase_date),
    warranty_expires: /^\d{4}-\d{2}-\d{2}$/.test(r.warranty_expires) ? r.warranty_expires : "",
    purchase_price: Math.max(0, Number(r.purchase_price) || 0),
  };
}

/** Local-dev stand-in so the UI can be exercised without an API key (set MOCK_AI=1 in .dev.vars). */
function mockAnalysis(ctx: AnalyzeContext): PhotoAnalysis {
  const base = {
    brand: "", size: "", quantity: 1, tags: ["sample"], best_platform: "facebook" as const,
    listing_description: "Sample listing description generated in mock mode.",
    model: "", serial_number: "", purchase_date: "", purchase_price: 0, purchase_store: "",
  };
  return {
    photo_notes: `Mock analysis for ${ctx.roomName}.`,
    items: [
      { ...base, name: "Wooden desk chair", category: "furniture", description: "Mock item.", condition: "good",
        resale_low: 25, resale_high: 40, asking_price: 35, replacement_value: 120, recommendation: "sell",
        recommendation_reason: "Solid furniture resells well locally.", listing_title: "Solid wood desk chair",
        bbox: { x: 0.05, y: 0.1, w: 0.4, h: 0.6 } },
      { ...base, name: "Kids' graphic t-shirts, size 6", category: "clothing", description: "Mock item.", condition: "fair",
        quantity: 4, resale_low: 2, resale_high: 4, asking_price: 3, replacement_value: 12, recommendation: "donate",
        recommendation_reason: "Low resale value.", best_platform: "donate", listing_title: "Kids graphic tees size 6",
        bbox: { x: 0.55, y: 0.2, w: 0.35, h: 0.5 } },
    ],
  };
}
