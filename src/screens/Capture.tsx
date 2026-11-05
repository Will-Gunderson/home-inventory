import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { go, useRoute, useStore } from "../store";
import { Icon, Topbar } from "../ui";
import { startRecording, type Recording } from "../lib/audio";

// How long a new photo waits before uploading, so you can tap the mic and talk about it.
const HOLD_MS = 4000;

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
  const { rooms, queue, enqueuePhoto, releaseEntry, retryEntry } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState("");
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState(0);

  // Voice notes. The newest photo is held for HOLD_MS; tapping the mic in that window attaches the
  // note to it (and keeps it held until the note is transcribed). Otherwise the note goes to the next photo.
  const held = useRef<{ id: string; timer: number } | null>(null);
  const waiting = useRef(new Set<string>()); // photos held for a note being recorded/transcribed
  const recording = useRef<{ rec: Recording; target: string | null } | null>(null);
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [heldNow, setHeldNow] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");

  const releaseHeld = useCallback(() => {
    if (!held.current) return;
    clearTimeout(held.current.timer);
    releaseEntry(held.current.id);
    held.current = null;
    setHeldNow(false);
  }, [releaseEntry]);

  const hold = (id: string) => {
    releaseHeld();
    const timer = window.setTimeout(() => {
      if (held.current?.id === id) releaseHeld();
    }, HOLD_MS);
    held.current = { id, timer };
    setHeldNow(true);
  };

  // Leaving the camera sends anything still held.
  useEffect(
    () => () => {
      if (held.current) {
        clearTimeout(held.current.timer);
        releaseEntry(held.current.id);
      }
      recording.current?.rec.cancel();
      waiting.current.forEach((id) => releaseEntry(id));
    },
    [releaseEntry],
  );

  const stopVoice = async () => {
    const r = recording.current;
    if (!r) return;
    recording.current = null;
    setVoice("transcribing");
    let text = "";
    try {
      text = (await api.transcribe(await r.rec.stop())).text;
      setVoiceMsg(text ? `“${text.length > 60 ? text.slice(0, 57) + "…" : text}”` : "Didn't catch that");
    } catch (e) {
      setVoiceMsg(e instanceof Error ? e.message : "Couldn't transcribe");
    }
    if (r.target) {
      waiting.current.delete(r.target);
      releaseEntry(r.target, text);
    } else if (text) {
      setHint((h) => [h.trim(), text].filter(Boolean).join(". "));
    }
    setVoice("idle");
    window.setTimeout(() => setVoiceMsg(""), 4000);
  };

  const toggleVoice = async () => {
    if (voice === "recording") return stopVoice();
    if (voice !== "idle") return;
    let target: string | null = null;
    if (held.current) {
      // Claim the held photo: it now waits for this note instead of the timer.
      target = held.current.id;
      clearTimeout(held.current.timer);
      held.current = null;
      setHeldNow(false);
      waiting.current.add(target);
    }
    try {
      const rec = await startRecording(() => stopVoice());
      recording.current = { rec, target };
      setVoice("recording");
      setVoiceMsg("");
      navigator.vibrate?.(10);
    } catch (e) {
      if (target) {
        waiting.current.delete(target);
        releaseEntry(target);
      }
      setVoiceMsg(e instanceof Error && e.name === "NotAllowedError" ? "Microphone access was blocked" : e instanceof Error ? e.message : "Couldn't start recording");
      window.setTimeout(() => setVoiceMsg(""), 4000);
    }
  };

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
    const note = hint.trim();
    setHint("");
    // While a note is being recorded, the next photo uploads right away; otherwise hold it for a note.
    const holdIt = voice === "idle";
    if (!holdIt) releaseHeld();
    enqueuePhoto(c, roomId, note, holdIt).then((id) => holdIt && hold(id));
  };

  const fromLibrary = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) enqueuePhoto(f, roomId, hint.trim());
    setHint("");
  };

  const mine = queue;
  const found = mine.reduce((s, q) => s + q.itemNames.length, 0);
  const working = mine.filter((q) => q.status === "held" || q.status === "uploading" || q.status === "analyzing").length;
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
        {(last || voice !== "idle" || voiceMsg) && (
          <div className="toast-cap">
            {voice === "recording"
              ? "Listening… tap the mic when you're done"
              : voice === "transcribing"
                ? "Writing down your note…"
                : voiceMsg
                  ? voiceMsg
                  : heldNow
                    ? "Tap the mic to describe it"
                    : !last
                      ? ""
                      : working
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
                  {q.status === "done" ? q.itemNames.length : q.status === "error" ? "!" : q.status === "held" ? <Icon name="mic" size={16} /> : <span className="spin" />}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="hintrow">
          <input
            className="hint"
            placeholder={heldNow ? "Tap the mic to describe this photo" : "Note for the next photo, or tap the mic"}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            enterKeyHint="done"
          />
          <button
            className={`mic ${voice} ${heldNow ? "ready" : ""}`}
            onClick={toggleVoice}
            disabled={voice === "transcribing"}
            aria-label={voice === "recording" ? "Stop recording" : heldNow ? "Describe this photo by voice" : "Voice note for the next photo"}
          >
            {voice === "transcribing" ? <span className="spin" /> : <Icon name={voice === "recording" ? "stop" : "mic"} size={20} />}
          </button>
        </div>
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
