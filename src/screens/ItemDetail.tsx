import { useEffect, useState } from "react";
import { api, ebayItemUrl, imgUrl, type Decision, type Doc, type EbayStatus, type Item } from "../api";
import { cleanPage, pagesToPdf, type ScannedPage } from "../lib/scan";
import { currentValue, daysUntil, fmtDate } from "../lib/value";
import { go, useStore } from "../store";
import { DECISION_LABEL, DecisionPill, Icon, Sheet, Topbar, copyText, useToast } from "../ui";
import { enhance, imagesAsFiles, type EnhanceMode } from "../lib/image";
import { EBAY_AUTOMATION_NOTE, ebayStatus, postToEbay } from "../lib/ebay";
import { CONDITION_LABEL, PLATFORM_INFO, listingFields, listingText, money, price, range, suggestedPlatform, type SellPlatform } from "../lib/listing";

const CATEGORIES = [
  "clothing", "shoes", "accessories", "furniture", "electronics", "toys", "books", "media", "sports", "outdoor",
  "tools", "kitchen", "appliances", "decor", "bedding", "baby", "collectibles", "office", "other",
];

export default function ItemDetail({ id }: { id: string }) {
  const { items, rooms, upsertItem, removeItem, loaded } = useStore();
  const toast = useToast();
  const item = items.find((i) => i.id === id);
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [researching, setResearching] = useState(false);
  const [err, setErr] = useState("");

  if (!item) {
    return (
      <>
        <Topbar title="" back="/" />
        <div className="empty">{loaded ? "This item no longer exists." : <span className="spin" />}</div>
      </>
    );
  }

  const room = rooms.find((r) => r.id === item.room_id);
  const save = async (patch: Partial<Item>, msg?: string) => {
    upsertItem({ ...item, ...patch });
    try {
      upsertItem(await api.updateItem(item.id, patch));
      if (msg) toast(msg);
    } catch (e) {
      upsertItem(item);
      toast(e instanceof Error ? e.message : "Save failed");
    }
  };

  const research = async () => {
    setResearching(true);
    setErr("");
    try {
      upsertItem(await api.researchPrice(item.id));
      toast("Prices updated from real listings");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Price check failed");
    } finally {
      setResearching(false);
    }
  };

  const heroKey = item.enhanced_key && !showOriginal ? item.enhanced_key : item.image_key;

  return (
    <>
      <Topbar
        title={room?.name ?? ""}
        back
        right={
          <button
            className="back"
            aria-label="Delete item"
            onClick={async () => {
              if (!confirm(`Delete “${item.name}” from your inventory?`)) return;
              await api.deleteItem(item.id);
              removeItem(item.id);
              history.back();
            }}
          >
            <Icon name="trash" size={20} />
          </button>
        }
      />

      <div className="hero">
        {heroKey ? <img src={imgUrl(heroKey)} alt={item.name} /> : <div style={{ aspectRatio: "4/3" }} />}
        {item.enhanced_key && (
          <button className="btn sm toggle" onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? "Show cleaned up" : "Show original"}
          </button>
        )}
      </div>
      <Enhancer item={item} onSaved={upsertItem} />

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h1 className="grow" style={{ fontSize: 22, margin: 0, lineHeight: 1.25 }}>
            {item.quantity > 1 && <span className="muted">{item.quantity}× </span>}
            {item.name}
          </h1>
          <DecisionPill item={item} />
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          {[item.brand, item.size && `Size ${item.size}`, CONDITION_LABEL[item.condition], item.category].filter(Boolean).join(" · ")}
        </p>
        {item.description && <p style={{ margin: "8px 0 0" }}>{item.description}</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <div className="muted small">Resale value{item.quantity > 1 ? " (each)" : ""}</div>
            <div className="price-big">{range(item)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted small">Replace new</div>
            <div style={{ fontWeight: 600 }}>{money(item.replacement_value)}</div>
          </div>
        </div>
        {item.price_research ? (
          <div style={{ marginTop: 12 }}>
            <p className="small" style={{ margin: "0 0 6px" }}>{item.price_research.summary}</p>
            <div className="comps">
              {item.price_research.comparables.map((c, i) => (
                <a key={i} href={c.url} target="_blank" rel="noreferrer">
                  <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                  <span style={{ whiteSpace: "nowrap" }}>{money(c.price)} {c.sold ? <span className="pill sell">sold</span> : null}</span>
                </a>
              ))}
            </div>
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>Checked {new Date(item.price_research.checked_at).toLocaleDateString()}</p>
          </div>
        ) : (
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>AI estimate from the photo.</p>
        )}
        <button className="btn sm block" style={{ marginTop: 10 }} onClick={research} disabled={researching}>
          {researching ? <><span className="spin" /> Searching real listings…</> : <><Icon name="globe" size={16} /> {item.price_research ? "Re-check" : "Check"} prices against real listings</>}
        </button>
        {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      </div>

      {(item.status === "active" || item.status === "listed") && (
        <>
          <h2>Decision</h2>
          <div className="seg">
            {(["keep", "sell", "donate"] as Decision[]).map((d) => (
              <button
                key={d}
                className={`${d} ${item.decision === d ? "on" : ""}`}
                onClick={() => save({ decision: d, decision_confirmed: true })}
              >
                {DECISION_LABEL[d]}
              </button>
            ))}
          </div>
          {item.ai_reason && (
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              <Icon name="sparkle" size={13} /> AI: {item.ai_reason}
              {!item.decision_confirmed && (
                <>
                  {" "}
                  <button className="btn sm ghost" style={{ minHeight: 0, padding: "0 4px", color: "var(--accent)" }} onClick={() => save({ decision_confirmed: true }, "Confirmed")}>
                    Confirm
                  </button>
                </>
              )}
            </p>
          )}
        </>
      )}

      <OwnershipCard item={item} />
      <Documents item={item} onItem={upsertItem} />

      {item.decision === "sell" && item.status !== "donated" && <SellPanel item={item} save={save} onItem={upsertItem} />}

      {item.decision === "donate" && item.status === "active" && (
        <button className="btn block" style={{ marginTop: 16 }} onClick={() => save({ status: "donated", decision_confirmed: true }, "Marked donated")}>
          Mark as donated
        </button>
      )}
      {(item.status === "sold" || item.status === "donated") && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>{item.status === "sold" ? `Sold for ${money(item.sold_price ?? 0)}` : "Donated"}</b>
          <button className="btn sm block" style={{ marginTop: 10 }} onClick={() => save({ status: "active", sold_price: null }, "Restored")}>
            Undo, I still have it
          </button>
        </div>
      )}

      <h2>Details</h2>
      <button className="btn block" onClick={() => setEditing(true)}>Edit details</button>
      {editing && <EditSheet item={item} onClose={() => setEditing(false)} onSave={async (p) => { await save(p, "Saved"); setEditing(false); }} />}
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Added {new Date(item.created_at.replace(" ", "T") + "Z").toLocaleDateString()} ·{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); go(`/items?room=${item.room_id}`); }}>{room?.name}</a>
      </p>
    </>
  );
}

function SellPanel({ item, save, onItem }: { item: Item; save: (p: Partial<Item>, msg?: string) => Promise<void>; onItem: (i: Item) => void }) {
  const toast = useToast();
  const [platform, setPlatform] = useState<SellPlatform>(suggestedPlatform(item));
  const [soldOpen, setSoldOpen] = useState(false);
  const [soldPrice, setSoldPrice] = useState(String(price(item)));
  const fields = listingFields(item, platform);
  const info = PLATFORM_INFO[platform];
  const order: SellPlatform[] = [suggestedPlatform(item), ...(["facebook", "ebay", "depop"] as SellPlatform[]).filter((p) => p !== suggestedPlatform(item))];

  const shareAll = async () => {
    const urls = [imgUrl(item.enhanced_key), imgUrl(item.image_key)].filter(Boolean);
    const text = listingText(item, platform);
    await copyText(text);
    try {
      const files = await imagesAsFiles(urls);
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, text });
        return;
      }
      for (const f of files) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
      }
      toast("Listing copied, photos downloaded");
    } catch {
      toast("Listing copied");
    }
  };

  return (
    <>
      <h2>Sell it</h2>
      <div className="seg" style={{ marginBottom: 8 }}>
        {order.map((p) => (
          <button key={p} className={platform === p ? "on" : ""} onClick={() => setPlatform(p)}>
            {p === "facebook" ? "Facebook" : p === "ebay" ? "eBay" : "Depop"}
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: "0 0 8px" }}>
        {platform === suggestedPlatform(item) && <><Icon name="sparkle" size={12} /> Suggested. </>}
        {info.note}
      </p>
      {platform === "ebay" && <EbayPost item={item} onItem={onItem} />}
      <div className="card" style={{ padding: "4px 14px" }}>
        {fields.map((f) => (
          <div className="copyrow" key={f.label}>
            <div className="v">
              <div className="l">{f.label}</div>
              {f.label === "Price" ? `$${f.value}` : f.value}
            </div>
            <button className="btn sm" aria-label={`Copy ${f.label}`} onClick={async () => { await copyText(f.value); toast(`${f.label} copied`); }}>
              <Icon name="copy" size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn primary block" onClick={shareAll}>
          <Icon name="share" /> Copy listing + share photos
        </button>
        <div className="row">
          <a className="btn grow" href={info.createUrl} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> Open {info.label.split(" ")[0]}
          </a>
          {!item.listed_on.includes(platform) ? (
            <button className="btn grow" onClick={() => save({ status: "listed", decision_confirmed: true, listed_on: [...item.listed_on, platform] }, `Marked listed on ${info.label}`)}>
              Mark listed
            </button>
          ) : (
            <span className="pill sell" style={{ alignSelf: "center" }}>Listed on {info.label.split(" ")[0]}</span>
          )}
        </div>
        {item.status !== "sold" && (
          <button className="btn block" onClick={() => setSoldOpen(true)}>
            <Icon name="dollar" size={18} /> It sold!
          </button>
        )}
      </div>
      {soldOpen && (
        <Sheet title="What did it sell for?" onClose={() => setSoldOpen(false)}>
          <div className="stack">
            <input className="input" inputMode="decimal" value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} autoFocus />
            <button
              className="btn primary lg block"
              onClick={async () => {
                await save(
                  { status: "sold", sold_price: Number(soldPrice) || 0, decision_confirmed: true },
                  item.ebay_listing_id ? "Marked sold and ended the eBay listing" : "Nice! Marked sold",
                );
                setSoldOpen(false);
              }}
            >
              Mark sold
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function EbayPost({ item, onItem }: { item: Item; onItem: (i: Item) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<EbayStatus | null>(null);
  const [busy, setBusy] = useState<"post" | "end" | null>(null);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    ebayStatus().then(setStatus);
  }, []);

  if (!status?.configured) return null;
  if (!status.connected) {
    return (
      <p className="small" style={{ margin: "0 0 10px" }}>
        <a href="#/settings">Connect your eBay account</a> to post this with one tap.
      </p>
    );
  }

  const post = async () => {
    setBusy("post");
    setErr("");
    try {
      await postToEbay(item, onItem, setStep);
      toast(item.ebay_listing_id ? "eBay listing updated" : "Live on eBay!");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't post to eBay");
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    if (!confirm("End the eBay listing?")) return;
    setBusy("end");
    setErr("");
    try {
      onItem((await api.endEbay(item.id)).item);
      toast("eBay listing ended");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't end the listing");
    } finally {
      setBusy(null);
    }
  };

  const live = item.ebay_listing_id && item.status !== "sold";
  const listedOn = item.ebay_listed_at ? new Date(item.ebay_listed_at.replace(" ", "T") + "Z").toLocaleDateString() : "";

  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      {item.ebay_listing_id ? (
        <div className="row">
          <a className="btn primary grow" href={ebayItemUrl(item, status.sandbox)} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> View on eBay
          </a>
          {live && (
            <>
              <button className="btn" onClick={post} disabled={!!busy} title="Push your latest edits to eBay">
                {busy === "post" ? <span className="spin" /> : "Update"}
              </button>
              <button className="btn danger" onClick={end} disabled={!!busy}>
                {busy === "end" ? <span className="spin" /> : "End"}
              </button>
            </>
          )}
        </div>
      ) : item.status !== "sold" ? (
        <button className="btn primary lg block" onClick={post} disabled={!!busy}>
          {busy === "post" ? <><span className="spin" /> {step || "Posting to eBay…"}</> : <><Icon name="tag" size={18} /> Post to eBay for ${price(item)}</>}
        </button>
      ) : null}
      {busy === "post" && <p className="tiny muted" style={{ margin: 0 }}>Takes about 10–30 seconds. Keep this screen open.</p>}
      {live && !busy && (
        <p className="tiny muted" style={{ margin: 0 }}>
          {listedOn && <>Listed {listedOn}. </>}
          {item.ebay_price_dropped ? "Price already dropped 10%. " : ""}
          {EBAY_AUTOMATION_NOTE} Sales are marked here automatically.
        </p>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function Enhancer({ item, onSaved }: { item: Item; onSaved: (i: Item) => void }) {
  const [busy, setBusy] = useState<EnhanceMode | null>(null);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [err, setErr] = useState("");
  const toast = useToast();

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const run = async (mode: EnhanceMode) => {
    if (!item.image_key) return;
    setBusy(mode);
    setErr("");
    setProgress(mode === "white" ? "Starting…" : "Brightening…");
    try {
      const blob = await enhance(imgUrl(item.image_key), mode, setProgress);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't clean up this photo");
    } finally {
      setBusy(null);
    }
  };

  if (preview) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <img src={preview.url} alt="Cleaned-up preview" style={{ borderRadius: 10, maxHeight: "50vh", margin: "0 auto" }} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn grow" onClick={() => setPreview(null)}>Discard</button>
          <button
            className="btn primary grow"
            onClick={async () => {
              onSaved(await api.uploadItemImage(item.id, preview.blob, "enhanced"));
              setPreview(null);
              toast("Saved listing photo");
            }}
          >
            Use this photo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row">
        <button className="btn sm grow" onClick={() => run("white")} disabled={!!busy}>
          {busy === "white" ? <span className="spin" /> : <Icon name="sparkle" size={16} />} Cut out item
        </button>
        <button className="btn sm grow" onClick={() => run("brighten")} disabled={!!busy}>
          {busy === "brighten" ? <span className="spin" /> : <Icon name="image" size={16} />} Brighten
        </button>
        {item.enhanced_key && (
          <button className="btn sm" aria-label="Remove cleaned-up photo" onClick={async () => onSaved(await api.removeEnhanced(item.id))}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {busy && <p className="tiny muted" style={{ margin: "6px 0 0" }}>{progress} (runs on your phone, first time downloads ~40MB)</p>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function OwnershipCard({ item }: { item: Item }) {
  const cv = currentValue(item);
  const days = item.warranty_expires ? daysUntil(item.warranty_expires) : null;
  const rows: [string, React.ReactNode][] = [];
  if (item.model) rows.push(["Model", item.model]);
  if (item.serial_number) rows.push(["Serial", item.serial_number]);
  if (item.purchase_date || item.purchase_price || item.purchase_store) {
    rows.push([
      "Bought",
      [item.purchase_date && fmtDate(item.purchase_date), item.purchase_store, item.purchase_price ? `${money(item.purchase_price)}${item.quantity > 1 ? " each" : ""}` : ""]
        .filter(Boolean)
        .join(" · "),
    ]);
  }
  if (item.warranty_expires) {
    rows.push([
      "Warranty",
      <>
        {days !== null && days < 0 ? "Ended " : "Until "}
        {fmtDate(item.warranty_expires)}
        {days !== null && days >= 0 && days <= 30 && <span className="pill warn" style={{ marginLeft: 6 }}>{days === 0 ? "ends today" : `${days} day${days === 1 ? "" : "s"} left`}</span>}
        {item.warranty_note && <div className="tiny muted">{item.warranty_note}</div>}
      </>,
    ]);
  }
  if (cv.depreciated) {
    rows.push([
      "Worth today",
      <>
        ~{money(cv.value)}{item.quantity > 1 ? " each" : ""}
        <div className="tiny muted">
          {cv.lifeYears ? `Paid price, depreciated over a typical ${cv.lifeYears}-year life (${cv.ageYears!.toFixed(1)} years old)` : "Collectible: holds its value"}
        </div>
      </>,
    ]);
  }
  if (!rows.length) return null;
  return (
    <>
      <h2>Ownership</h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        {rows.map(([l, v]) => (
          <div className="copyrow" key={l}>
            <div className="v"><div className="l">{l}</div>{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const DOC_LABEL: Record<Doc["kind"], string> = { receipt: "Receipt", manual: "Manual", warranty: "Warranty", other: "Document" };

function Documents({ item, onItem }: { item: Item; onItem: (i: Item) => void }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState("");
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.documents(item.id).then(setDocs, () => setDocs([]));
  }, [item.id]);

  const upload = async (file: Blob, name: string, pages?: number) => {
    setBusy("Reading it…");
    setErr("");
    try {
      const r = await api.uploadDocument(item.id, file, name, pages);
      setDocs((d) => [r.document, ...(d ?? [])]);
      onItem(r.item);
      const label = DOC_LABEL[r.document.kind];
      toast(r.note || (r.filled.length ? `${label} saved. Filled in ${r.filled.join(", ")}` : `${label} saved`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <h2>Receipts & manuals</h2>
      {docs && docs.length > 0 && (
        <div className="card" style={{ padding: "4px 14px", marginBottom: 10 }}>
          {docs.map((d) => (
            <div className="copyrow" key={d.id} style={{ alignItems: "center" }}>
              <Icon name="doc" size={20} />
              <a className="v grow" href={imgUrl(d.r2_key)} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                <div className="l">{DOC_LABEL[d.kind]}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}</div>
                {d.title}
                {d.summary && <div className="tiny muted">{d.summary}</div>}
              </a>
              <button
                className="btn sm ghost"
                aria-label={`Delete ${d.title}`}
                onClick={async () => {
                  if (!confirm(`Delete “${d.title}”?`)) return;
                  await api.deleteDocument(d.id);
                  setDocs((all) => (all ?? []).filter((x) => x.id !== d.id));
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn grow" onClick={() => setScanning(true)} disabled={!!busy}>
          <Icon name="scan" size={18} /> Scan pages
        </button>
        <label className={`btn grow ${busy ? "disabled" : ""}`}>
          <Icon name="doc" size={18} /> Add file
          <input
            type="file"
            accept="application/pdf,image/*"
            hidden
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f, f.name);
            }}
          />
        </label>
      </div>
      {busy ? (
        <p className="tiny muted" style={{ margin: "6px 0 0" }}><span className="spin" /> {busy} Purchase date, price and warranty get filled in automatically.</p>
      ) : (
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>Add a receipt or warranty and the AI fills in the purchase date, price and warranty end date.</p>
      )}
      {err && <div className="err">{err}</div>}
      {scanning && (
        <ScanSheet
          onClose={() => setScanning(false)}
          onDone={async (pdf, pages) => {
            setScanning(false);
            await upload(pdf, `Scan ${new Date().toLocaleDateString()}`, pages);
          }}
        />
      )}
    </>
  );
}

/** Photograph pages one at a time with the phone camera; they're cleaned up and saved as one PDF. */
function ScanSheet({ onClose, onDone }: { onClose: () => void; onDone: (pdf: Blob, pages: number) => void }) {
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), [pages]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setWorking(true);
    setErr("");
    try {
      const cleaned: ScannedPage[] = [];
      for (const f of Array.from(files)) cleaned.push(await cleanPage(f));
      setPages((p) => [...p, ...cleaned]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that photo");
    } finally {
      setWorking(false);
    }
  };

  const pick = (capture: boolean) => (
    <input
      type="file"
      accept="image/*"
      multiple={!capture}
      {...(capture ? { capture: "environment" as const } : {})}
      hidden
      onChange={(e) => {
        add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <Sheet title={pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : "Scan a document"} onClose={onClose}>
      <div className="stack">
        {pages.length > 0 && (
          <div className="scanpages">
            {pages.map((p, i) => (
              <div key={p.url} className="scanpage">
                <img src={p.url} alt={`Page ${i + 1}`} />
                <button className="btn sm" aria-label={`Remove page ${i + 1}`} onClick={() => setPages(pages.filter((x) => x !== p))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          Lay the page flat in good light and fill the frame. Each page is brightened so the paper reads as white.
        </p>
        <div className="row">
          <label className="btn primary grow">
            {working ? <span className="spin" /> : <Icon name="camera" size={18} />} {pages.length ? "Next page" : "Take first page"}
            {pick(true)}
          </label>
          <label className="btn">
            <Icon name="image" size={18} />
            {pick(false)}
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn lg block" disabled={!pages.length || working} onClick={async () => onDone(await pagesToPdf(pages), pages.length)}>
          Save {pages.length > 1 ? `${pages.length}-page ` : ""}PDF
        </button>
      </div>
    </Sheet>
  );
}

function EditSheet({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (p: Partial<Item>) => Promise<void> }) {
  const { rooms } = useStore();
  const [f, setF] = useState({ ...item, tagsText: item.tags.join(", ") });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);

  return (
    <Sheet title="Edit details" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { tagsText, ...rest } = f;
          await onSave({
            name: rest.name, room_id: rest.room_id, category: rest.category, brand: rest.brand, size: rest.size,
            condition: rest.condition, quantity: Number(rest.quantity), description: rest.description,
            asking_price: Number(rest.asking_price), resale_low: Number(rest.resale_low), resale_high: Number(rest.resale_high),
            replacement_value: Number(rest.replacement_value), listing_title: rest.listing_title,
            model: rest.model, serial_number: rest.serial_number, purchase_date: rest.purchase_date.trim(),
            purchase_price: Number(rest.purchase_price) || 0, purchase_store: rest.purchase_store,
            warranty_expires: rest.warranty_expires,
            listing_description: rest.listing_description, notes: rest.notes,
            tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          });
          setBusy(false);
        }}
      >
        <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set("name")} /></label>
        <div className="two">
          <label className="field"><span>Room</span>
            <select className="input" value={f.room_id} onChange={set("room_id")}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Category</span>
            <select className="input" value={f.category} onChange={set("category")} style={{ textTransform: "capitalize" }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="two">
          <label className="field"><span>Brand</span><input className="input" value={f.brand} onChange={set("brand")} /></label>
          <label className="field"><span>Size</span><input className="input" value={f.size} onChange={set("size")} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Condition</span>
            <select className="input" value={f.condition} onChange={set("condition")}>
              {Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field"><span>Quantity</span><input className="input" inputMode="numeric" value={f.quantity} onChange={set("quantity")} /></label>
        </div>
        <label className="field"><span>Description</span><textarea className="input" value={f.description} onChange={set("description")} /></label>
        <div className="two">
          <label className="field"><span>Asking price</span><input className="input" inputMode="decimal" value={f.asking_price} onChange={set("asking_price")} /></label>
          <label className="field"><span>Replacement value</span><input className="input" inputMode="decimal" value={f.replacement_value} onChange={set("replacement_value")} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Resale low</span><input className="input" inputMode="decimal" value={f.resale_low} onChange={set("resale_low")} /></label>
          <label className="field"><span>Resale high</span><input className="input" inputMode="decimal" value={f.resale_high} onChange={set("resale_high")} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Model</span><input className="input" value={f.model} onChange={set("model")} /></label>
          <label className="field"><span>Serial number</span><input className="input" value={f.serial_number} onChange={set("serial_number")} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Bought (YYYY-MM-DD, or just year)</span><input className="input" value={f.purchase_date} placeholder="2021-03" onChange={set("purchase_date")} /></label>
          <label className="field"><span>Price paid{item.quantity > 1 ? " (each)" : ""}</span><input className="input" inputMode="decimal" value={f.purchase_price || ""} onChange={set("purchase_price")} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Bought at</span><input className="input" value={f.purchase_store} onChange={set("purchase_store")} /></label>
          <label className="field"><span>Warranty ends</span><input className="input" type="date" value={f.warranty_expires} onChange={set("warranty_expires")} /></label>
        </div>
        <label className="field"><span>Listing title</span><input className="input" maxLength={80} value={f.listing_title} onChange={set("listing_title")} /></label>
        <label className="field"><span>Listing description</span><textarea className="input" value={f.listing_description} onChange={set("listing_description")} /></label>
        <label className="field"><span>Search tags (comma separated)</span><input className="input" value={f.tagsText} onChange={set("tagsText")} /></label>
        <label className="field"><span>Private notes</span><textarea className="input" value={f.notes} onChange={set("notes")} placeholder="Serial number, receipt location, where it's stored…" /></label>
        <button className="btn primary lg block" disabled={busy}>{busy ? <span className="spin" /> : "Save"}</button>
      </form>
    </Sheet>
  );
}
