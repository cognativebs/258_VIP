export default function CollectionPlaceholderView({ collection }) {
  const isPokemon = collection.id === "pokemon";

  return (
    <div className="bb-terminal bb-terminal-placeholder">
      <div className="bb-topbar">
        <div className="bb-topbar-brand">
          <span className="bb-orange">IQVAULT</span>
          <span className="bb-dim">{collection.terminalLabel}</span>
        </div>
        <div className="bb-topbar-stats">
          <span><em>Status</em> Schema ready</span>
          <span><em>Holdings</em> —</span>
          <span><em>Value</em> —</span>
        </div>
      </div>

      <div className="bb-placeholder-body">
        <div className="bb-placeholder-icon">{collection.icon}</div>
        <h2 className="bb-placeholder-title">{collection.label}</h2>
        <p className="bb-placeholder-sub">
          Terminal shell is wired — inventory loader and API for this vertical are next.
          Holdings, scores, and recommendations will use the same intelligence spine as Comics.
        </p>

        <div className="bb-placeholder-grid">
          <div className="bb-placeholder-card">
            <span className="bb-placeholder-card-label">Schema</span>
            <code>{collection.schema}</code>
            {collection.sport && (
              <span className="bb-placeholder-card-meta">sport = {collection.sport}</span>
            )}
          </div>
          <div className="bb-placeholder-card">
            <span className="bb-placeholder-card-label">Category kind</span>
            <code>{collection.kind}</code>
          </div>
          <div className="bb-placeholder-card">
            <span className="bb-placeholder-card-label">Planned workspaces</span>
            <div className="bb-placeholder-ws">
              {collection.workspaces?.map((ws) => (
                <span key={ws} className="bb-ws-chip disabled">{ws}</span>
              ))}
            </div>
          </div>
        </div>

        {isPokemon && (
          <p className="bb-placeholder-hint">
            Pokémon hunts are live under <strong>Hunts</strong> — sealed 30th and singles placeholders.
          </p>
        )}

        <p className="bb-placeholder-hint bb-dim">
          Shared layer: <code>vault_collection.holding</code> · Orchestr8 analytics · VaultOS sync
        </p>
      </div>

      <footer className="bb-statusbar">
        <span>{collection.label} · coming soon</span>
        <span>Same terminal UX as Comics · F1–F8 workspaces when data loads</span>
        <span>Switch tabs above to change vertical</span>
      </footer>
    </div>
  );
}
