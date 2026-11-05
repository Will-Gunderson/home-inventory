import { useEffect, useState } from "react";
import { api, imgUrl, type EbayStatus } from "../api";
import { go, useRoute, useStore } from "../store";
import { Icon, Topbar, useToast } from "../ui";

export default function SettingsScreen() {
  const { settings, setSettings, rooms, setRooms, refresh } = useStore();
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [newRoom, setNewRoom] = useState("");
  const [failed, setFailed] = useState<Awaited<ReturnType<typeof api.failedPhotos>>>([]);
  const [retrying, setRetrying] = useState("");

  useEffect(() => setForm(settings), [settings]);
  useEffect(() => {
    api.failedPhotos().then(setFailed, () => {});
  }, []);

  if (!form) return <Topbar title="Settings" />;

  return (
    <>
      <Topbar title="Settings" />

      <h2>Pricing</h2>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setSettings(await api.saveSettings(form));
          toast("Saved");
        }}
      >
        <label className="field">
          <span>Your city (for local resale prices)</span>
          <input className="input" value={form.location} placeholder="e.g. Minneapolis, MN" onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </label>
        <label className="field">
          <span>Sell threshold: below this resale value, the AI suggests donating</span>
          <input className="input" inputMode="numeric" value={form.sell_threshold} onChange={(e) => setForm({ ...form, sell_threshold: Number(e.target.value) || 0 })} />
        </label>
        <label className="field">
          <span>Household notes for the AI</span>
          <textarea className="input" value={form.household_notes} onChange={(e) => setForm({ ...form, household_notes: e.target.value })} />
        </label>
        <button className="btn primary">Save</button>
      </form>

      <EbayCard />

      <h2>Rooms</h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        {rooms.map((r) => (
          <div className="copyrow" key={r.id} style={{ alignItems: "center" }}>
            <Icon name={r.icon} size={20} />
            <span className="grow">{r.name}</span>
            <button
              className="btn sm ghost"
              onClick={async () => {
                const name = prompt("Rename room", r.name);
                if (!name?.trim()) return;
                await api.renameRoom(r.id, name);
                setRooms(await api.rooms());
              }}
            >
              Rename
            </button>
            <button
              className="btn sm ghost danger"
              onClick={async () => {
                if (!confirm(`Delete ${r.name}?`)) return;
                try {
                  await api.deleteRoom(r.id);
                  setRooms(await api.rooms());
                } catch (e) {
                  toast(e instanceof Error ? e.message : "Couldn't delete");
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
        <form
          className="row"
          style={{ padding: "10px 0" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newRoom.trim()) return;
            await api.addRoom(newRoom);
            setRooms(await api.rooms());
            setNewRoom("");
          }}
        >
          <input className="input grow" placeholder="Add a room (e.g. Basement)" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
          <button className="btn"><Icon name="plus" size={18} /></button>
        </form>
      </div>

      {failed.length > 0 && (
        <>
          <h2>Photos that failed</h2>
          <div className="stack">
            {failed.map((p) => (
              <div className="qrow" key={p.id}>
                <img src={imgUrl(p.r2_key)} alt="" />
                <div className="grow small">
                  <b>{p.room_name}</b>
                  <div className="err">{p.error}</div>
                </div>
                <button
                  className="btn sm"
                  disabled={retrying === p.id}
                  onClick={async () => {
                    setRetrying(p.id);
                    const r = await api.retryPhoto(p.id).catch(() => null);
                    setRetrying("");
                    if (r?.status === "done") {
                      setFailed((f) => f.filter((x) => x.id !== p.id));
                      await refresh();
                      toast(`Found ${r.items.length} items`);
                    } else toast(r?.error ?? "Still failing");
                  }}
                >
                  {retrying === p.id ? <span className="spin" /> : "Retry"}
                </button>
                <button
                  className="btn sm ghost"
                  aria-label="Delete photo"
                  onClick={async () => {
                    await api.deletePhoto(p.id);
                    setFailed((f) => f.filter((x) => x.id !== p.id));
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Insurance & records</h2>
      <a className="btn block" href="/api/export.csv">
        <Icon name="download" /> Export full inventory (CSV)
      </a>
      <p className="tiny muted">Every item with room, condition, replacement value and a photo link. Good to keep with your homeowner's insurance documents.</p>

      <h2>Account</h2>
      <button
        className="btn block danger"
        onClick={async () => {
          await api.logout();
          location.reload();
        }}
      >
        Sign out
      </button>
    </>
  );
}

function EbayCard() {
  const { settings, setSettings } = useStore();
  const { params } = useRoute();
  const toast = useToast();
  const [status, setStatus] = useState<EbayStatus | null>(null);
  const [zip, setZip] = useState(settings?.ebay_postal_code ?? "");

  useEffect(() => {
    api.ebayStatus().then(setStatus, () => {});
    const result = params.get("ebay");
    if (result) {
      toast(result === "connected" ? "eBay connected" : result === "error" ? params.get("msg") || "eBay sign-in failed" : "eBay sign-in cancelled");
      go("/settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setZip(settings?.ebay_postal_code ?? ""), [settings?.ebay_postal_code]);

  if (!status) return null;
  return (
    <>
      <h2>eBay</h2>
      <div className="card stack">
        {!status.configured ? (
          <p className="small muted" style={{ margin: 0 }}>
            Not set up yet: add the EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME secrets (see README).
          </p>
        ) : status.connected ? (
          <>
            <div className="row">
              <Icon name="check" size={18} />
              <b className="grow">Connected{status.sandbox ? " (sandbox)" : ""}</b>
              <button
                className="btn sm ghost danger"
                onClick={async () => {
                  if (!confirm("Disconnect eBay? Existing listings stay live.")) return;
                  setStatus(await api.ebayDisconnect());
                }}
              >
                Disconnect
              </button>
            </div>
            {status.policies && (
              <p className="tiny muted" style={{ margin: 0 }}>
                Listings use: {status.policies.shipping} · {status.policies.payment} · {status.policies.returns}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>Connect once, then post any item to eBay with one tap.</p>
            <a className="btn primary block" href="/api/ebay/connect">
              <Icon name="external" size={18} /> Connect eBay account
            </a>
          </>
        )}
        {status.configured && (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              setSettings(await api.saveSettings({ ebay_postal_code: zip.trim() }));
              toast("Saved");
            }}
          >
            <label className="field grow">
              <span>Ship-from ZIP code</span>
              <input className="input" inputMode="numeric" autoComplete="postal-code" value={zip} placeholder="e.g. 55401" onChange={(e) => setZip(e.target.value)} />
            </label>
            <button className="btn" style={{ alignSelf: "flex-end" }}>Save</button>
          </form>
        )}
      </div>
    </>
  );
}
