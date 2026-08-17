import { useState, useEffect, useMemo } from "react";
import LoginGate from "@shared/components/LoginGate.jsx";
import LinkPanel from "@shared/components/LinkPanel.jsx";
import HuntsView from "./views/HuntsView.jsx";
import CollectionsView from "./views/CollectionsView.jsx";
import { TOOLS } from "@shared/config.js";
import { clearSession } from "@shared/auth/session.js";
import { publishSync } from "@shared/bridge/sync.js";
import { HUNTS, getActiveHunts } from "./data/hunts/index.js";
import { huntCompletion } from "./lib/huntEngine.js";

const VIEWS = ["overview", "collections", "hunts", "link"];

const VIEW_LABELS = {
  overview: "Overview",
  collections: "Collections",
  hunts: "Hunts",
  link: "VaultOS Link",
};

function OverviewView({ peerSync }) {
  const activeHunts = getActiveHunts();
  const totalOwned = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalOwned ?? 0), 0);
  const totalItems = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalItems ?? 0), 0);
  const remaining = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.remainingCost ?? 0), 0);

  return (
    <>
      <h2 className="page-title">IQVault</h2>
      <p className="page-sub">
        Personal collectible intelligence — calculations, insights, and collection strategy.
      </p>

      <div className="grid-4" style={{ marginBottom: 28 }}>
        <div className="card card-gold">
          <p className="card-title">Hunt Progress</p>
          <p className="stat-value sm">{totalOwned}/{totalItems}</p>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>items owned</span>
        </div>
        <div className="card">
          <p className="card-title">Active Hunts</p>
          <p className="stat-value sm">{activeHunts.length}</p>
        </div>
        <div className="card">
          <p className="card-title">Est. Remaining</p>
          <p className="stat-value sm">${remaining.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="card-title">Philosophy</p>
          <p className="insight-quote">What should I buy next?</p>
        </div>
      </div>

      {peerSync?.payload && (
        <div className="card card-gold" style={{ marginBottom: 24 }}>
          <p className="card-title">From VaultOS</p>
          <p style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>
            Catalog assets: <strong>{peerSync.payload.catalogAssets}</strong>
            {" · "}ID queue: <strong>{peerSync.payload.pendingReviews}</strong>
            {" · "}Classifier: <strong>{peerSync.payload.classifierAccuracy}</strong>
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ margin: "0 0 16px" }}>Where Intelligence Lives</h3>
        <div className="arch-layer vault">
          <strong>IQVault (this app)</strong>
          <span>Collection Hunts · portfolio thesis · buy-under rules · recommendations · completion metrics</span>
        </div>
        <div className="arch-layer hunt">
          <strong>VaultOS (subscription product)</strong>
          <span>Store scan · identify · acquire · ID review queue · feeds market data back here</span>
        </div>
        <div className="arch-layer bridge">
          <strong>Shared bridge</strong>
          <span>Separate logins · linked accounts · catalog spine + signals sync both ways</span>
        </div>
      </div>
    </>
  );
}

function IQVaultApp({ session }) {
  const [view, setView] = useState("overview");
  const [peerSync, setPeerSync] = useState(null);

  const activeHunts = getActiveHunts();
  const huntOwned = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalOwned ?? 0), 0);
  const huntTotal = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalItems ?? 0), 0);

  const syncPayload = useMemo(
    () => ({
      huntOwned,
      huntTotal,
      activeHunts: activeHunts.length,
      hunts: HUNTS.map((h) => h.name).join(", "),
    }),
    [huntOwned, huntTotal, activeHunts.length]
  );

  useEffect(() => {
    let cancelled = false;
    async function push() {
      await publishSync(session, syncPayload);
      const { fetchPeerSync } = await import("@shared/bridge/sync.js");
      const peer = await fetchPeerSync(session);
      if (!cancelled) setPeerSync(peer);
    }
    push();
    const t = setInterval(push, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session, syncPayload]);

  const signOut = () => {
    clearSession(TOOLS.IQVAULT);
    window.location.reload();
  };

  return (
    <div className="app iqvault-app">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">🏛</div>
          <div className="brand-text">
            <h1>IQVault</h1>
            <span>Personal Intelligence · 258 Labs</span>
          </div>
        </div>

        <nav className="nav">
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`nav-btn ${view === v ? "active" : ""}`}
              onClick={() => setView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </nav>

        <div className="header-meta">
          <span className="status-dot" />
          {session.user.name}
          <button type="button" className="header-signout" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className={`main${view === "collections" ? " bb-main" : ""}`}>
        {view === "overview" && <OverviewView peerSync={peerSync} />}
        {view === "collections" && <CollectionsView />}
        {view === "hunts" && <HuntsView />}
        {view === "link" && <LinkPanel session={session} syncPayload={syncPayload} />}
      </main>

      <footer className="footer">
        Personal program · consumes VaultOS data · Schema:{" "}
        <code>infra/db/migrations/20260705_05_collection_hunts.sql</code> ·{" "}
        <code>20260706_06_platform_auth.sql</code>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <LoginGate toolId={TOOLS.IQVAULT}>
      {({ session }) => <IQVaultApp session={session} />}
    </LoginGate>
  );
}
