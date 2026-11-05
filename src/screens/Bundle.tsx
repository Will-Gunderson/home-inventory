import { useState } from "react";
import { api, itemImage, type Item } from "../api";
import { useStore } from "../store";
import { Icon, Sheet, copyText, useToast } from "../ui";
import { imagesAsFiles } from "../lib/image";
import { money, price } from "../lib/listing";

export default function BundleSheet({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const { refresh } = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<"garage_sale" | "marketplace_bundle">("marketplace_bundle");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [post, setPost] = useState<{ title: string; body: string; total: number } | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr("");
    try {
      setPost(await api.bundle(items.map((i) => i.id), kind, details));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const sharePhotos = async () => {
    const urls = items.map(itemImage).filter(Boolean).slice(0, 10);
    try {
      const files = await imagesAsFiles(urls);
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, title: post?.title, text: post ? `${post.title}\n\n${post.body}` : undefined });
      } else {
        for (const f of files) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(f);
          a.download = f.name;
          a.click();
        }
      }
    } catch {
      /* user cancelled */
    }
  };

  const markListed = async () => {
    await api.bulkUpdate(items.map((i) => i.id), { status: "listed", decision: "sell", decision_confirmed: true, listed_on: ["facebook"] });
    await refresh();
    toast("Marked as listed");
    onClose();
  };

  return (
    <Sheet title={`Post ${items.length} item${items.length === 1 ? "" : "s"} together`} onClose={onClose}>
      {!post ? (
        <div className="stack">
          <div className="seg">
            <button className={kind === "marketplace_bundle" ? "on" : ""} onClick={() => setKind("marketplace_bundle")}>Marketplace post</button>
            <button className={kind === "garage_sale" ? "on" : ""} onClick={() => setKind("garage_sale")}>Garage sale</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {kind === "garage_sale"
              ? "Writes an announcement listing highlights and prices, for Marketplace, Nextdoor or local groups."
              : "Writes one Facebook Marketplace post with every item and its price, plus a multi-buy discount."}
          </p>
          <label className="field">
            <span>{kind === "garage_sale" ? "Date, time and address" : "Pickup details (optional)"}</span>
            <textarea
              className="input"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={kind === "garage_sale" ? "Sat May 9, 8am–1pm, 123 Elm St" : "Porch pickup in the evenings, cash or Venmo"}
            />
          </label>
          <div className="small muted">
            Total asking: <b>{money(items.reduce((s, i) => s + price(i) * i.quantity, 0))}</b>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary lg block" onClick={generate} disabled={busy}>
            {busy ? <><span className="spin" /> Writing…</> : <><Icon name="sparkle" /> Write the post</>}
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="card">
            <div className="copyrow">
              <div className="v"><div className="l">Title</div>{post.title}</div>
              <button className="btn sm" onClick={async () => { await copyText(post.title); toast("Title copied"); }}><Icon name="copy" size={16} /></button>
            </div>
            <div className="copyrow">
              <div className="v"><div className="l">Post</div>{post.body}</div>
              <button className="btn sm" onClick={async () => { await copyText(post.body); toast("Post copied"); }}><Icon name="copy" size={16} /></button>
            </div>
          </div>
          <button className="btn block" onClick={sharePhotos}><Icon name="share" /> Share or save photos ({Math.min(10, items.length)})</button>
          <a className="btn block" href="https://www.facebook.com/marketplace/create/item" target="_blank" rel="noreferrer">
            <Icon name="external" /> Open Facebook Marketplace
          </a>
          <div className="row">
            <button className="btn grow" onClick={() => setPost(null)}>Back</button>
            <button className="btn primary grow" onClick={markListed}>Mark all listed</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
