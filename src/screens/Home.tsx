import { useMemo, useState } from "react";
import { go, useStore } from "../store";
import { Icon, ItemTile } from "../ui";
import { money } from "../lib/listing";
import { currentValue, daysUntil, fmtDate, warrantyEndingSoon } from "../lib/value";

export default function Home() {
  const { rooms, items, loaded } = useStore();
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    const owned = items.filter((i) => i.status !== "sold" && i.status !== "donated");
    const sum = (arr: typeof items, f: (i: (typeof items)[number]) => number) => arr.reduce((s, i) => s + f(i), 0);
    return {
      count: sum(owned, (i) => i.quantity),
      replacement: sum(owned, (i) => i.replacement_value * i.quantity),
      worth: sum(owned, (i) => currentValue(i).value * i.quantity),
      warranties: owned
        .filter(warrantyEndingSoon)
        .sort((a, b) => a.warranty_expires.localeCompare(b.warranty_expires)),
      forSale: sum(owned.filter((i) => i.decision === "sell"), (i) => (i.asking_price || i.resale_high) * i.quantity),
      sold: sum(items.filter((i) => i.status === "sold"), (i) => i.sold_price ?? 0),
      review: owned.filter((i) => !i.decision_confirmed).length,
      perRoom: Object.fromEntries(
        rooms.map((r) => {
          const ri = owned.filter((i) => i.room_id === r.id);
          return [r.id, { n: sum(ri, (i) => i.quantity), value: sum(ri, (i) => i.replacement_value * i.quantity) }];
        }),
      ),
    };
  }, [items, rooms]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return items.filter((i) =>
      [i.name, i.brand, i.category, i.description, ...i.tags].join(" ").toLowerCase().includes(t),
    );
  }, [q, items]);

  return (
    <>
      <div className="topbar">
        <h1>Home</h1>
      </div>

      <div className="search" style={{ marginBottom: 16 }}>
        <Icon name="search" size={18} />
        <input className="input" placeholder="Search everything you own" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>

      {q ? (
        <>
          <p className="muted small">{results.length} result{results.length === 1 ? "" : "s"}</p>
          <div className="grid">
            {results.map((i) => (
              <ItemTile key={i.id} item={i} onClick={() => go(`/item/${i.id}`)} />
            ))}
          </div>
        </>
      ) : (
        <>
          {stats.warranties.length > 0 && (
            <div className="card alert" style={{ marginBottom: 12 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Icon name="shield" size={18} />
                <b className="grow">Warrant{stats.warranties.length === 1 ? "y" : "ies"} ending soon</b>
              </div>
              {stats.warranties.map((i) => {
                const d = daysUntil(i.warranty_expires) ?? 0;
                return (
                  <a key={i.id} href={`#/item/${i.id}`} className="alertrow">
                    <span className="grow">{i.name}</span>
                    <span className="small">{d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`} · {fmtDate(i.warranty_expires)}</span>
                  </a>
                );
              })}
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>Check for problems worth a claim while it's still covered.</p>
            </div>
          )}
          <div className="stats">
            <div className="stat">
              <b>{stats.count.toLocaleString()}</b>
              <span>things documented</span>
            </div>
            <div className="stat">
              <b>{money(stats.replacement)}</b>
              <span>replacement value{stats.worth > 0 && <> · ~{money(stats.worth)} worth today</>}</span>
            </div>
            <div className="stat" onClick={() => go("/sell")} style={{ cursor: "pointer" }}>
              <b>{money(stats.forSale)}</b>
              <span>marked to sell</span>
            </div>
            <div className="stat">
              <b>{money(stats.sold)}</b>
              <span>earned from sales</span>
            </div>
            {stats.review > 0 && (
              <div className="stat cta" style={{ gridColumn: "1 / -1" }} onClick={() => go("/review")}>
                <b>{stats.review} to review</b>
                <span>Confirm keep, sell or donate for new items</span>
              </div>
            )}
          </div>

          {loaded && items.length === 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <b>Start with one room.</b>
              <p className="muted small" style={{ margin: "6px 0 12px" }}>
                Tap the camera, pick a room, and photograph shelves, closets and furniture. The AI names and prices everything it sees, so you only need to point and shoot.
              </p>
              <button className="btn primary block" onClick={() => go("/capture")}>
                <Icon name="camera" /> Start capturing
              </button>
            </div>
          )}

          <h2>Rooms</h2>
          <div className="room-list">
            {rooms.map((r) => (
              <button key={r.id} className="room-row" onClick={() => go(`/items?room=${r.id}`)}>
                <span className="ic"><Icon name={r.icon} /></span>
                <span className="grow">
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="meta">{stats.perRoom[r.id]?.n ? `${stats.perRoom[r.id].n} things` : "Nothing captured yet"}</div>
                </span>
                {!!stats.perRoom[r.id]?.value && <span className="val">{money(stats.perRoom[r.id].value)}</span>}
              </button>
            ))}
            <button className="room-row" onClick={() => go("/items")}>
              <span className="ic"><Icon name="box" /></span>
              <span className="grow" style={{ fontWeight: 600 }}>Everything</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
