export type Decision = "keep" | "sell" | "donate";
export type ItemStatus = "active" | "listed" | "sold" | "donated";
export type Platform = "ebay" | "facebook" | "depop" | "garage_sale" | "donate";

export interface Room {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
}

export interface Comparable {
  title: string;
  price: number;
  url: string;
  sold: boolean;
}

export interface Item {
  id: string;
  room_id: string;
  photo_id: string | null;
  name: string;
  category: string;
  brand: string;
  description: string;
  condition: "new" | "like_new" | "good" | "fair" | "poor";
  size: string;
  quantity: number;
  resale_low: number;
  resale_high: number;
  asking_price: number;
  replacement_value: number;
  decision: Decision;
  decision_confirmed: boolean;
  ai_reason: string;
  best_platform: Platform | "";
  listing_title: string;
  listing_description: string;
  tags: string[];
  bbox: { x: number; y: number; w: number; h: number } | null;
  image_key: string | null;
  enhanced_key: string | null;
  status: ItemStatus;
  listed_on: string[];
  sold_price: number | null;
  price_research: {
    summary: string;
    comparables: Comparable[];
    checked_at: string;
  } | null;
  notes: string;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  ebay_listed_at: string | null;
  ebay_price_dropped: number;
  model: string;
  serial_number: string;
  purchase_date: string;
  purchase_price: number;
  purchase_store: string;
  warranty_expires: string;
  warranty_note: string;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  location: string;
  sell_threshold: number;
  household_notes: string;
  ebay_postal_code: string;
}

export interface Doc {
  id: string;
  item_id: string;
  kind: "receipt" | "manual" | "warranty" | "other";
  title: string;
  summary: string;
  r2_key: string;
  content_type: string;
  pages: number | null;
  created_at: string;
}

export interface EbayStatus {
  configured: boolean;
  connected: boolean;
  sandbox: boolean;
  policies: { shipping: string; payment: string; returns: string } | null;
}

export interface PhotoResult {
  photo_id: string;
  photo_key: string;
  status: "done" | "error";
  error?: string;
  notes?: string;
  items: Item[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401 && path !== "/api/login") onUnauthorized();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  me: () => req<{ ok: true }>("/api/me"),
  login: (passcode: string) => req<{ ok: true }>("/api/login", json("POST", { passcode })),
  logout: () => req<{ ok: true }>("/api/logout", { method: "POST" }),

  rooms: () => req<Room[]>("/api/rooms"),
  addRoom: (name: string) => req<Room>("/api/rooms", json("POST", { name })),
  renameRoom: (id: string, name: string) => req("/api/rooms/" + id, json("PATCH", { name })),
  deleteRoom: (id: string) => req("/api/rooms/" + id, { method: "DELETE" }),

  settings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("/api/settings", json("PUT", s)),

  items: () => req<Item[]>("/api/items"),
  addItem: (room_id: string, name: string) => req<Item>("/api/items", json("POST", { room_id, name })),
  updateItem: (id: string, patch: Partial<Item>) => req<Item>("/api/items/" + id, json("PATCH", patch)),
  bulkUpdate: (ids: string[], patch: Partial<Item>) => req("/api/items/bulk", json("POST", { ids, patch })),
  deleteItem: (id: string) => req("/api/items/" + id, { method: "DELETE" }),
  uploadItemImage: (id: string, blob: Blob, kind: "crop" | "enhanced") =>
    req<Item>(`/api/items/${id}/image?kind=${kind}`, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob }),
  removeEnhanced: (id: string) => req<Item>(`/api/items/${id}/image`, { method: "DELETE" }),
  researchPrice: (id: string) => req<Item>(`/api/items/${id}/research`, { method: "POST" }),

  uploadPhoto: (blob: Blob, roomId: string, width: number, height: number, hint: string) => {
    const fd = new FormData();
    fd.append("file", blob, "photo.jpg");
    fd.append("room_id", roomId);
    fd.append("width", String(width));
    fd.append("height", String(height));
    if (hint) fd.append("hint", hint);
    return req<PhotoResult>("/api/photos", { method: "POST", body: fd });
  },
  retryPhoto: (id: string) => req<PhotoResult>(`/api/photos/${id}/retry`, { method: "POST" }),
  failedPhotos: () =>
    req<{ id: string; room_id: string; room_name: string; r2_key: string; error: string; created_at: string }[]>("/api/photos/failed"),
  deletePhoto: (id: string) => req(`/api/photos/${id}`, { method: "DELETE" }),

  ebayStatus: () => req<EbayStatus>("/api/ebay"),
  ebayDisconnect: () => req<EbayStatus>("/api/ebay/disconnect", { method: "POST" }),
  postToEbay: (id: string) => req<{ item: Item; url: string; category: string }>(`/api/items/${id}/ebay`, { method: "POST" }),
  endEbay: (id: string) => req<{ item: Item }>(`/api/items/${id}/ebay`, { method: "DELETE" }),

  documents: (itemId: string) => req<Doc[]>(`/api/items/${itemId}/documents`),
  uploadDocument: (itemId: string, file: Blob, filename: string, pages?: number) =>
    req<{ item: Item; document: Doc; filled: string[]; note: string }>(`/api/items/${itemId}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(filename),
        ...(pages ? { "X-Pages": String(pages) } : {}),
      },
      body: file,
    }),
  deleteDocument: (id: string) => req(`/api/documents/${id}`, { method: "DELETE" }),
  transcribe: (wav: Blob) => req<{ text: string }>("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav }),

  bundle: (ids: string[], kind: "garage_sale" | "marketplace_bundle", details: string) =>
    req<{ title: string; body: string; total: number }>("/api/bundle", json("POST", { ids, kind, details })),
};

export const imgUrl = (key: string | null | undefined) => (key ? `/img/${key}` : "");
export const ebayItemUrl = (i: Item, sandbox = false) =>
  i.ebay_listing_id ? `https://${sandbox ? "sandbox" : "www"}.ebay.com/itm/${i.ebay_listing_id}` : "";
export const itemImage = (i: Item) => imgUrl(i.enhanced_key ?? i.image_key);
