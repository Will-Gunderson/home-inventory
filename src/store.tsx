import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Item, type Room, type Settings } from "./api";
import { cropToBox, prepareUpload } from "./lib/image";

export interface QueueEntry {
  id: string;
  roomId: string;
  thumb: string;
  status: "held" | "uploading" | "analyzing" | "cropping" | "done" | "error";
  itemNames: string[];
  error?: string;
  photoId?: string;
  blob: Blob;
  width: number;
  height: number;
  hint: string;
  started?: boolean;
}

interface Store {
  rooms: Room[];
  items: Item[];
  settings: Settings | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  upsertItem: (item: Item) => void;
  removeItem: (id: string) => void;
  queue: QueueEntry[];
  /** With hold: the photo waits (status "held") until releaseEntry, so a voice note can be attached first. */
  enqueuePhoto: (source: Blob | HTMLCanvasElement, roomId: string, hint: string, hold?: boolean) => Promise<string>;
  releaseEntry: (id: string, extraHint?: string) => void;
  retryEntry: (id: string) => void;
  clearDone: () => void;
  setSettings: (s: Settings) => void;
  setRooms: (r: Room[]) => void;
}

const Ctx = createContext<Store | null>(null);
const CONCURRENCY = 3;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]);
  const running = useRef(0);

  const refresh = useCallback(async () => {
    const [r, i, s] = await Promise.all([api.rooms(), api.items(), api.settings()]);
    setRooms(r);
    setItems(i);
    setSettings(s);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
    // Pick up anything that finished while the app was in the background.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const upsertItem = useCallback((item: Item) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = prev.slice();
      next[idx] = item;
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);

  const update = useCallback((id: string, patch: Partial<QueueEntry>) => {
    queueRef.current = queueRef.current.map((e) => (e.id === id ? { ...e, ...patch } : e));
    setQueue(queueRef.current);
  }, []);

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY) {
      const next = queueRef.current.find((e) => e.status === "uploading" && !e.started);
      if (!next) return;
      next.started = true;
      running.current++;
      (async () => {
        try {
          update(next.id, { status: "analyzing" });
          const res = next.photoId
            ? await api.retryPhoto(next.photoId)
            : await api.uploadPhoto(next.blob, next.roomId, next.width, next.height, next.hint);
          if (res.status === "error") {
            update(next.id, { status: "error", error: res.error, photoId: res.photo_id });
            return;
          }
          update(next.id, { status: "cropping", photoId: res.photo_id, itemNames: res.items.map((i) => i.name) });
          res.items.forEach(upsertItem);
          // Crop each detected item out of the photo so it gets its own picture.
          await Promise.all(
            res.items.map(async (it) => {
              if (!it.bbox || res.items.length === 1) return;
              try {
                const crop = await cropToBox(next.blob, it.bbox);
                if (crop) upsertItem(await api.uploadItemImage(it.id, crop, "crop"));
              } catch {
                /* keep the full photo */
              }
            }),
          );
          update(next.id, { status: "done" });
        } catch (e) {
          update(next.id, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
        } finally {
          running.current--;
          pump();
        }
      })();
    }
  }, [update, upsertItem]);

  const enqueuePhoto = useCallback(
    async (source: Blob | HTMLCanvasElement, roomId: string, hint: string, hold = false) => {
      const { blob, width, height } = await prepareUpload(source);
      const entry: QueueEntry = {
        id: crypto.randomUUID(),
        roomId,
        thumb: URL.createObjectURL(blob),
        status: hold ? "held" : "uploading",
        itemNames: [],
        blob,
        width,
        height,
        hint,
      };
      queueRef.current = [entry, ...queueRef.current];
      setQueue(queueRef.current);
      pump();
      return entry.id;
    },
    [pump],
  );

  const releaseEntry = useCallback(
    (id: string, extraHint?: string) => {
      queueRef.current = queueRef.current.map((e) =>
        e.id === id && e.status === "held"
          ? { ...e, status: "uploading" as const, hint: [e.hint, extraHint?.trim()].filter(Boolean).join(". ") }
          : e,
      );
      setQueue(queueRef.current);
      pump();
    },
    [pump],
  );

  const retryEntry = useCallback(
    (id: string) => {
      queueRef.current = queueRef.current.map((e) =>
        e.id === id ? { ...e, status: "uploading" as const, error: undefined, started: false } : e,
      );
      setQueue(queueRef.current);
      pump();
    },
    [pump],
  );

  const clearDone = useCallback(() => {
    queueRef.current = queueRef.current.filter((e) => {
      if (e.status === "done") URL.revokeObjectURL(e.thumb);
      return e.status !== "done";
    });
    setQueue(queueRef.current);
  }, []);

  // Warn before closing the tab while photos are still processing.
  useEffect(() => {
    const busy = queue.some((e) => e.status === "held" || e.status === "uploading" || e.status === "analyzing");
    if (!busy) return;
    const h = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [queue]);

  const value = useMemo(
    () => ({
      rooms, items, settings, loaded, refresh, upsertItem, removeItem,
      queue, enqueuePhoto, releaseEntry, retryEntry, clearDone, setSettings, setRooms,
    }),
    [rooms, items, settings, loaded, refresh, upsertItem, removeItem, queue, enqueuePhoto, releaseEntry, retryEntry, clearDone],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

// ---------- tiny hash router ----------

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const h = () => {
      setHash(window.location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const [path, query = ""] = hash.split("?");
  return { path, params: new URLSearchParams(query), parts: path.split("/").filter(Boolean) };
}

export const go = (path: string) => {
  window.location.hash = path;
};
