import { useEffect, useRef, useState } from "react";
import { go, useRoute, useStore } from "../store";
import { Icon, Topbar } from "../ui";

const LAST_ROOM = "hi_last_room";
const readLast = () => {
  try {
    return localStorage.getItem(LAST_ROOM) ?? "";
  } catch {
    return "";
  }
};

export default function Capture() {
  const { params } = useRoute();
  const { rooms } = useStore();
  const [roomId, setRoomId] = useState(params.get("room") ?? "");
  const [picked, setPicked] = useState(!!params.get("room"));

  useEffect(() => {
    if (!roomId && rooms.length) {
      const last = readLast();
      if (rooms.some((r) => r.id === last)) setRoomId(last);
    }
  }, [rooms, roomId]);

  const choose = (id: string) => {
    setRoomId(id);
    setPicked(true);
    try {
      localStorage.setItem(LAST_ROOM, id);
    } catch {
      /* ignore */
    }
  };

  if (!picked) {
    return (
      <div className="app" style={{ paddingBottom: 24 }}>
        <Topbar title="Where are you?" back="/" />
        <p className="muted" style={{ marginTop: 0 }}>Pick the room, then just point and shoot. Everything you photograph gets filed here.</p>
        <div className="room-list">
          {rooms.map((r) => (
            <button key={r.id} className="room-row" onClick={() => choose(r.id)} style={r.id === roomId ? { borderColor: "var(--accent)" } : undefined}>
              <span className="ic"><Icon name={r.icon} /></span>
              <span className="grow" style={{ fontWeight: 600 }}>{r.name}</span>
              {r.id === roomId && <span className="pill">Last used</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return <Camera roomId={roomId} onRoomChange={choose} />;
}

function Camera({ roomId, onRoomChange }: { roomId: string; onRoomChange: (id: string) => void }) {
  const { rooms, queue, enqueuePhoto, retryEntry } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState("");
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError("Live camera isn't available here. Use the photo button below instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCamError("Camera permission was blocked. Allow camera access in your browser settings, or use the photo button below.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash((f) => f + 1);
    navigator.vibrate?.(15);
    enqueuePhoto(c, roomId, hint.trim());
    setHint("");
  };

  const fromLibrary = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) enqueuePhoto(f, roomId, hint.trim());
    setHint("");
  };

  const mine = queue;
  const found = mine.reduce((s, q) => s + q.itemNames.length, 0);
  const working = mine.filter((q) => q.status === "uploading" || q.status === "analyzing").length;
  const last = mine[0];

  return (
    <div className="capture">
      {camError ? (
        <div className="nocam">
          <div>
            <Icon name="camera" size={40} />
            <p>{camError}</p>
          </div>
        </div>
      ) : (
        <video ref={videoRef} playsInline muted autoPlay onClick={shoot} />
      )}
      {flash > 0 && <div key={flash} className="flash" />}

      <div className="top">
        <button className="x" onClick={() => go("/")} aria-label="Close camera">
          <Icon name="x" />
        </button>
        <select className="roompick" value={roomId} onChange={(e) => onRoomChange(e.target.value)} aria-label="Room">
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className="bottom" style={{ position: "relative" }}>
        {last && (
          <div className="toast-cap">
            {working
              ? `Identifying ${working} photo${working === 1 ? "" : "s"}… keep shooting`
              : last.status === "error"
                ? "A photo failed. Tap it to retry"
                : `${found} item${found === 1 ? "" : "s"} found`}
          </div>
        )}
        {mine.length > 0 && (
          <div className="strip">
            {mine.map((q) => (
              <div
                key={q.id}
                className={`q ${q.status}`}
                onClick={() => q.status === "error" && retryEntry(q.id)}
                title={q.error ?? q.itemNames.join(", ")}
              >
                <img src={q.thumb} alt="" />
                <div className="st">
                  {q.status === "done" ? q.itemNames.length : q.status === "error" ? "!" : <span className="spin" />}
                </div>
              </div>
            ))}
          </div>
        )}
        <input
          className="hint"
          placeholder="Optional note, e.g. “barely worn, size 8”"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          enterKeyHint="done"
        />
        <div className="controls">
          <label className="lib">
            <Icon name="image" />
            Library
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { fromLibrary(e.target.files); e.target.value = ""; }} />
          </label>
          {camError ? (
            <label className="shutter" aria-label="Take photo">
              <span />
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { fromLibrary(e.target.files); e.target.value = ""; }} />
            </label>
          ) : (
            <button className="shutter" onClick={shoot} aria-label="Take photo">
              <span />
            </button>
          )}
          <button className="done" onClick={() => go(`/items?room=${roomId}`)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
