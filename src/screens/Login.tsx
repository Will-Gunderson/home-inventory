import { useState } from "react";
import { api } from "../api";

export default function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await api.login(code);
            onDone();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't sign in");
          } finally {
            setBusy(false);
          }
        }}
      >
        <img src="/icon.svg" alt="" />
        <h1 style={{ margin: 0, fontSize: 24 }}>Home Inventory</h1>
        <p className="muted" style={{ margin: 0 }}>Enter your passcode</p>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ textAlign: "center" }}
        />
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg" disabled={busy || !code}>
          {busy ? <span className="spin" /> : "Sign in"}
        </button>
      </form>
    </div>
  );
}
