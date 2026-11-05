import { useMemo, useState } from "react";
import { api, type Decision, type Item } from "../api";
import { go, useRoute, useStore } from "../store";
import { Icon, ItemTile, Sheet, Topbar, useToast } from "../ui";
import { money } from "../lib/listing";
import BundleSheet from "./Bundle";

type Filter = "all" | "review" | Decision | "gone";

export default function Items() {
  const { params } = useRoute();
  const roomId = params.get("room") ?? "";
  const { rooms, items, queue, refresh } = useStore();
  const toast = useToast();
  const room = rooms.find((r) => r.id === roomId);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<"" | "move" | "bundle">("");

  const inRoom = useMemo(() => items.filter((i) => !roomId || i.room_id === roomId), [items, roomId]);
  const categories = useMemo(() => [...new Set(inRoom.map((i) => i.category))].sort(), [inRoom]);
  const shown = useMemo(
    () =>
      inRoom.filter((i) => {
        if (category && i.category !== category) return false;
        const gone = i.status === "sold" || i.status === "donated";
        if (filter === "gone") return gone;
        if (gone) return false;
        if (filter === "review") return !i.decision_confirmed;
        if (filter === "all") return true;
        return i.decision === filter;
      }),
    [inRoom, filter, category],
  );
  const total = shown.reduce((s, i) => s + i.replacement_value * i.quantity, 0);
  const pending = queue.filter((q) => q.roomId === roomId && (q.status === "uploading" || q.status === "analyzing")).length;

  const toggle = (i: Item) => {
    const next = new Set(sel);
    if (next.has(i.id)) next.delete(i.id);
    else next.add(i.id);
    setSel(next);
  };

  const bulk = async (patch: Partial<Item>, msg: string) => {
    await api.bulkUpdate([...sel], patch);
    await refresh();
    toast(msg);
    setSel(new Set());
    setSelecting(false);
    setSheet("");
  };

  const count = (f: Filter) =>
    inRoom.filter((i) => {
      const gone = i.status === "sold" || i.status === "donated";
      if (f === "gone") return gone;
      if (gone) return false;
      if (f === "review") return !i.decision_confirmed;
      return f === "all" || i.decision === f;
    }).length;

  return (
    <>
      <Topbar
        title={room?.name ?? "Everything"}
        back="/"
        right={
          inRoom.length > 0 && (
            <button className="btn sm" onClick={() => { setSelecting(!selecting); setSel(new Set()); }}>
              {selecting ? "Cancel" : "Select"}
            </button>
          )
        }
      />

      {pending > 0 && (
        <div className="card row small" style={{ marginBottom: 12 }}>
          <span className="spin" /> Identifying {pending} photo{pending === 1 ? "" : "s"}…
        </div>
      )}

      <div className="chips" style={{ marginBottom: 8 }}>
        {(["all", "review", "keep", "sell", "donate", "gone"] as Filter[]).map((f) => {
          const n = count(f);
          if (f !== "all" && !n) return null;
          const label = { all: "All", review: "To review", keep: "Keep", sell: "Sell", donate: "Donate", gone: "Sold & donated" }[f];
          return (
            <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {label} <span className="muted">{n}</span>
            </button>
          );
        })}
      </div>
      {categories.length > 1 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip ${!category ? "on" : ""}`} onClick={() => setCategory("")}>All types</button>
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? "on" : ""}`} onClick={() => setCategory(c)} style={{ textTransform: "capitalize" }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          {shown.length} entries · {money(total)} replacement value
        </p>
      )}

      {shown.length === 0 && !pending ? (
        <div className="empty">
          <Icon name="camera" size={36} />
          <p>{inRoom.length ? "Nothing matches this filter." : "Nothing captured here yet."}</p>
          {room && (
            <button className="btn primary" onClick={() => go(`/capture?room=${room.id}`)}>
              <Icon name="camera" /> Capture {room.name}
            </button>
          )}
        </div>
      ) : (
        <div className="grid">
          {shown.map((i) => (
            <ItemTile
              key={i.id}
              item={i}
              selecting={selecting}
              selected={sel.has(i.id)}
              onClick={() => (selecting ? toggle(i) : go(`/item/${i.id}`))}
            />
          ))}
        </div>
      )}

      {room && !selecting && shown.length > 0 && (
        <button className="btn block" style={{ marginTop: 16 }} onClick={() => go(`/capture?room=${room.id}`)}>
          <Icon name="camera" /> Add more photos
        </button>
      )}

      {selecting && (
        <div className="selbar">
          <div>
            <span className="small" style={{ fontWeight: 600 }}>{sel.size} selected</span>
            <button className="btn sm ghost" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((i) => i.id)))}>
              {sel.size === shown.length ? "None" : "All"}
            </button>
            <span className="grow" />
            <button className="btn sm" disabled={!sel.size} onClick={() => bulk({ decision: "keep", decision_confirmed: true }, "Marked keep")}>Keep</button>
            <button className="btn sm" disabled={!sel.size} onClick={() => bulk({ decision: "sell", decision_confirmed: true }, "Marked to sell")}>Sell</button>
            <button className="btn sm" disabled={!sel.size} onClick={() => bulk({ decision: "donate", decision_confirmed: true }, "Marked donate")}>Donate</button>
            <button className="btn sm" disabled={!sel.size} onClick={() => setSheet("move")}>Move</button>
            <button className="btn sm primary" disabled={!sel.size} onClick={() => setSheet("bundle")}>Post</button>
          </div>
        </div>
      )}

      {sheet === "move" && (
        <Sheet title={`Move ${sel.size} to…`} onClose={() => setSheet("")}>
          <div className="room-list">
            {rooms.map((r) => (
              <button key={r.id} className="room-row" onClick={() => bulk({ room_id: r.id }, `Moved to ${r.name}`)}>
                <span className="ic"><Icon name={r.icon} /></span>
                <span className="grow" style={{ fontWeight: 600 }}>{r.name}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "bundle" && <BundleSheet items={items.filter((i) => sel.has(i.id))} onClose={() => setSheet("")} />}
    </>
  );
}
