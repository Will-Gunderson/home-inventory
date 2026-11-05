import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { StoreProvider, useRoute, useStore } from "./store";
import { Icon, ToastProvider } from "./ui";
import Login from "./screens/Login";
import Home from "./screens/Home";
import Capture from "./screens/Capture";
import Items from "./screens/Items";
import ItemDetail from "./screens/ItemDetail";
import Review from "./screens/Review";
import Sell from "./screens/Sell";
import SettingsScreen from "./screens/Settings";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api.me().then(() => setAuthed(true), () => setAuthed(false));
  }, []);
  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <ToastProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { parts } = useRoute();
  const { items, queue } = useStore();
  const toReview = items.filter((i) => !i.decision_confirmed && i.status === "active").length;
  const busy = queue.filter((q) => q.status === "uploading" || q.status === "analyzing").length;
  const top = parts[0] ?? "";

  let screen;
  switch (top) {
    case "capture": screen = <Capture />; break;
    case "items": screen = <Items />; break;
    case "item": screen = <ItemDetail id={parts[1]} />; break;
    case "review": screen = <Review />; break;
    case "sell": screen = <Sell />; break;
    case "settings": screen = <SettingsScreen />; break;
    default: screen = <Home />;
  }

  const tab = (href: string, label: string, icon: string, on: boolean, badge?: number) => (
    <a href={`#${href}`} className={on ? "on" : ""}>
      <Icon name={icon} />
      {label}
      {!!badge && <span className="dot">{badge > 99 ? "99+" : badge}</span>}
    </a>
  );

  return (
    <>
      <main className="app">{screen}</main>
      {top !== "capture" && (
        <div className="tabbar">
          <nav>
            {tab("/", "Home", "home", top === "" || top === "items" || top === "item")}
            {tab("/review", "Review", "review", top === "review", toReview)}
            <a href="#/capture" className="cam" aria-label="Capture">
              <span className="big"><Icon name="camera" size={26} /></span>
              {busy ? <span className="dot">{busy}</span> : null}
            </a>
            {tab("/sell", "Sell", "tag", top === "sell")}
            {tab("/settings", "Settings", "settings", top === "settings")}
          </nav>
        </div>
      )}
    </>
  );
}
