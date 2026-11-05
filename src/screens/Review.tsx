import { useMemo, useState } from "react";
import { api, itemImage, type Decision } from "../api";
import { go, useStore } from "../store";
import { DECISION_LABEL, Icon, Topbar, useToast } from "../ui";
import { CONDITION_LABEL, money, range } from "../lib/listing";

export default function Review() {
  const { items, rooms, upsertItem, refresh } = useStore();
  const toast = useToast();
  const [roomFilter, setRoomFilter] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);

  const queue = useMemo(
    () =>
      items
        .filter((i) => !i.decision_confirmed && i.status === "active" && (!roomFilter || i.room_id === roomFilter))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [items, roomFilter],
  );
  const pending = queue.filter((i) => !skipped.has(i.id));
  const item = pending[0];
  const total = queue.length + done;

  const decide = async (d: Decision) => {
    if (!item) return;
    upsertItem({ ...item, decision: d, decision_confirmed: true });
    setDone((n) => n + 1);
    try {
      await api.updateItem(item.id, { decision: d, decision_confirmed: true });
    } catch {
      upsertItem(item);
      toast("Couldn't save, try again");
    }
  };

  const acceptAll = async () => {
    if (!confirm(`Accept the AI's suggestion for all ${queue.length} items?`)) return;
    await api.bulkUpdate(queue.map((i) => i.id), { decision_confirmed: true });
    await refresh();
    toast(`Confirmed ${queue.length} items`);
  };

  const roomsWithReview = rooms.filter((r) => items.some((i) => i.room_id === r.id && !i.decision_confirmed && i.status === "active"));

  return (
    <>
      <Topbar
        title="Review"
        right={queue.length > 1 && <button className="btn sm" onClick={acceptAll}><Icon name="sparkle" size={16} /> Accept all</button>}
      />
      {roomsWithReview.length > 1 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip ${!roomFilter ? "on" : ""}`} onClick={() => setRoomFilter("")}>All rooms</button>
          {roomsWithReview.map((r) => (
            <button key={r.id} className={`chip ${roomFilter === r.id ? "on" : ""}`} onClick={() => setRoomFilter(r.id)}>{r.name}</button>
          ))}
        </div>
      )}

      {!item ? (
        <div className="empty">
          <Icon name="check" size={40} />
          <p>{skipped.size ? `All caught up, apart from ${skipped.size} skipped.` : "All caught up. Nothing waiting for a decision."}</p>
          {skipped.size > 0 && <button className="btn" onClick={() => setSkipped(new Set())}>Review skipped</button>}
        </div>
      ) : (
        <div className="review-card">
          <div className="progress"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
          <p className="tiny muted" style={{ margin: 0 }}>
            {pending.length} left · {rooms.find((r) => r.id === item.room_id)?.name}
          </p>
          <img className="ph" src={itemImage(item)} alt="" onClick={() => go(`/item/${item.id}`)} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
              {item.quantity > 1 && <span className="muted">{item.quantity}× </span>}
              {item.name}
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              {[item.brand, item.size && `Size ${item.size}`, CONDITION_LABEL[item.condition]].filter(Boolean).join(" · ")}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 16 }}>
              <div><div className="tiny muted">Resale</div><b>{range(item)}</b></div>
              <div><div className="tiny muted">Replace new</div><b>{money(item.replacement_value)}</b></div>
            </div>
            {item.ai_reason && (
              <p className="small" style={{ margin: "10px 0 0" }}>
                <Icon name="sparkle" size={13} /> Suggests <b>{DECISION_LABEL[item.decision].toLowerCase()}</b>: {item.ai_reason}
              </p>
            )}
          </div>
          <div className="decide">
            {(["keep", "sell", "donate"] as Decision[]).map((d) => (
              <button key={d} className={`${d} ${item.decision === d ? "suggested" : ""}`} onClick={() => decide(d)}>
                {DECISION_LABEL[d]}
                {item.decision === d && <small>suggested</small>}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn ghost grow" onClick={() => setSkipped(new Set(skipped).add(item.id))}>Skip</button>
            <button className="btn ghost grow" onClick={() => go(`/item/${item.id}`)}>Edit details</button>
          </div>
        </div>
      )}
    </>
  );
}
