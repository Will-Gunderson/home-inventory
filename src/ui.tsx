import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { itemImage, type Item } from "./api";
import { money } from "./lib/listing";

const PATHS: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  check: "M5 12.5 10 17l9-10",
  review: "M4 6h16M4 12h10M4 18h7M17 15l2 2 4-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  back: "M15 5l-7 7 7 7",
  x: "M6 6l12 12M18 6 6 18",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  plus: "M12 5v14M5 12h14",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  share: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  desk: "M3 8h18M5 8v11M19 8v11M14 8v6h5",
  bed: "M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3M7 11.5h.01",
  kid: "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 22l2-9h8l2 9M8 13l-3-3M16 13l3-3",
  laundry: "M5 3h14v18H5zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 6h.01M11 6h.01",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  garage: "M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 16h10",
  sofa: "M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2",
  dining: "M3 10h18M5 10v9M19 10v9M8 6v4M12 5v5M16 6v4",
  kitchen: "M4 3h16v18H4zM4 9h16M8 6h.01M12 6h.01M9 13h6v5H9z",
  nook: "M4 9h12v4a6 6 0 0 1-12 0zM16 10h2a2 2 0 0 1 0 4h-2.5M6 3v3M10 3v3M3 21h14",
  closet: "M5 3h14v18H5zM12 3v18M9.5 11v2M14.5 11v2",
  dollar: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  stop: "M7 7h10v10H7z",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
};

export function Icon({ name, size = 22, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.box} />
    </svg>
  );
}

export function Topbar({ title, back, right }: { title: ReactNode; back?: boolean | string; right?: ReactNode }) {
  return (
    <div className="topbar">
      {back && (
        <button
          className="back"
          aria-label="Back"
          onClick={() => (typeof back === "string" ? (window.location.hash = back) : history.back())}
        >
          <Icon name="back" />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </div>
  );
}

export const DECISION_LABEL = { keep: "Keep", sell: "Sell", donate: "Donate" } as const;

export function DecisionPill({ item }: { item: Item }) {
  if (item.status === "sold") return <span className="pill sell">Sold</span>;
  if (item.status === "donated") return <span className="pill donate">Donated</span>;
  if (item.status === "listed") return <span className="pill sell">Listed</span>;
  return (
    <span className={`pill ${item.decision} ${item.decision_confirmed ? "" : "ai"}`}>
      {!item.decision_confirmed && <Icon name="sparkle" size={12} />}
      {DECISION_LABEL[item.decision]}
    </span>
  );
}

export function ItemTile({ item, onClick, selected, selecting }: { item: Item; onClick: () => void; selected?: boolean; selecting?: boolean }) {
  const src = itemImage(item);
  return (
    <button className={`tile ${selected ? "selected" : ""}`} onClick={onClick}>
      {src ? <img className="ph" src={src} alt="" loading="lazy" /> : <div className="ph" />}
      <span className="badge">
        <DecisionPill item={item} />
      </span>
      {selecting && <span className="check">{selected && <Icon name="check" size={16} stroke={3} />}</span>}
      <div className="body">
        <div className="name">
          {item.quantity > 1 && <span className="muted">{item.quantity}× </span>}
          {item.name}
        </div>
        <div className="sub">
          <span>{item.status === "sold" && item.sold_price != null ? `Sold ${money(item.sold_price)}` : money(item.asking_price || item.resale_high)}</span>
          {item.brand && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.brand}</span>}
        </div>
      </div>
    </button>
  );
}

export function Sheet({ onClose, children, title }: { onClose: () => void; children: ReactNode; title?: string }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 className="grow" style={{ margin: 0 }}>{title}</h3>
          <button className="back" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- toast ----------

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
