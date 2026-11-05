import { useMemo, useState } from "react";
import { api, type Item } from "../api";
import { go, useStore } from "../store";
import { Icon, ItemTile, Topbar, useToast } from "../ui";
import { money, price } from "../lib/listing";
import BundleSheet from "./Bundle";

type Tab = "tolist" | "listed" | "sold" | "donate";

export default function Sell() {
  const { items, refresh } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("tolist");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bundle, setBundle] = useState(false);

  const groups = useMemo(() => {
    const by = (f: (i: Item) => boolean) => items.filter(f);
    return {
      tolist: by((i) => i.decision === "sell" && i.status === "active"),
      listed: by((i) => i.status === "listed"),
      sold: by((i) => i.status === "sold"),
      donate: by((i) => i.decision === "donate" && i.status === "active"),
    };
  }, [items]);

  const shown = groups[tab];
  const value = (arr: Item[]) => arr.reduce((s, i) => s + price(i) * i.quantity, 0);
  const earned = groups.sold.reduce((s, i) => s + (i.sold_price ?? 0), 0);
  const donateValue = groups.donate.reduce((s, i) => s + (i.resale_low || i.resale_high) * i.quantity, 0);

  const toggle = (i: Item) => {
    const n = new Set(sel);
    if (n.has(i.id)) n.delete(i.id);
    else n.add(i.id);
    setSel(n);
  };

  return (
    <>
      <Topbar
        title="Sell & donate"
        right={
          tab !== "sold" && shown.length > 0 && (
            <button className="btn sm" onClick={() => { setSelecting(!selecting); setSel(new Set()); }}>
              {selecting ? "Cancel" : "Select"}
            </button>
          )
        }
      />

      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat"><b>{money(value(groups.tolist) + value(groups.listed))}</b><span>could earn</span></div>
        <div className="stat"><b>{money(earned)}</b><span>earned so far</span></div>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        {([
          ["tolist", "To list"],
          ["listed", "Listed"],
          ["sold", "Sold"],
          ["donate", "Donate pile"],
        ] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); setSel(new Set()); setSelecting(false); }}>
            {l} <span className="muted">{groups[t].length}</span>
          </button>
        ))}
      </div>

      {tab === "tolist" && shown.length > 1 && !selecting && (
        <div className="card small" style={{ marginBottom: 12 }}>
          <b>Garage sale or bundle?</b>
          <span className="muted"> Tap Select, pick items, then Post to write one combined Marketplace post or garage-sale announcement.</span>
        </div>
      )}
      {tab === "donate" && shown.length > 0 && (
        <div className="card small" style={{ marginBottom: 12 }}>
          Estimated fair-market value: <b>{money(donateValue)}</b>
          <span className="muted"> (keep the receipt; the CSV export in Settings lists each item for your tax records).</span>
          <button
            className="btn primary block"
            style={{ marginTop: 10 }}
            onClick={async () => {
              const ids = selecting && sel.size ? [...sel] : shown.map((i) => i.id);
              if (!confirm(`Mark ${ids.length} item${ids.length === 1 ? "" : "s"} as donated?`)) return;
              await api.bulkUpdate(ids, { status: "donated", decision_confirmed: true });
              await refresh();
              setSel(new Set());
              setSelecting(false);
              toast("Marked donated. Nice work!");
            }}
          >
            {selecting && sel.size ? `Mark ${sel.size} donated` : "I dropped these off"}
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <Icon name="tag" size={36} />
          <p>
            {tab === "tolist"
              ? "Nothing marked to sell yet. Review new items or mark things Sell from any room."
              : tab === "listed"
                ? "Nothing listed right now."
                : tab === "sold"
                  ? "No sales yet."
                  : "Nothing in the donate pile."}
          </p>
          {tab === "tolist" && <button className="btn" onClick={() => go("/review")}>Go to review</button>}
        </div>
      ) : (
        <div className="grid">
          {shown.map((i) => (
            <ItemTile key={i.id} item={i} selecting={selecting} selected={sel.has(i.id)} onClick={() => (selecting ? toggle(i) : go(`/item/${i.id}`))} />
          ))}
        </div>
      )}

      {selecting && tab !== "donate" && (
        <div className="selbar">
          <div>
            <span className="small" style={{ fontWeight: 600 }}>{sel.size} selected</span>
            <button className="btn sm ghost" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((i) => i.id)))}>
              {sel.size === shown.length ? "None" : "All"}
            </button>
            <span className="grow" />
            <button className="btn sm primary" disabled={!sel.size} onClick={() => setBundle(true)}>
              <Icon name="sparkle" size={16} /> Post together
            </button>
          </div>
        </div>
      )}
      {bundle && (
        <BundleSheet
          items={items.filter((i) => sel.has(i.id))}
          onClose={() => { setBundle(false); setSelecting(false); setSel(new Set()); }}
        />
      )}
    </>
  );
}
