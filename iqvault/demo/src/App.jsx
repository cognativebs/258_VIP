import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  CATEGORIES,
  ASSETS,
  ID_OBSERVATIONS,
  SCAN_SCENARIOS,
  getAsset,
  getCategory,
  computeVaultScore,
  computeOffer,
  formatCurrency,
  formatPct,
} from "./data/mockCatalog.js";

import AcquireView from "./views/AcquireView.jsx";
import LoginGate from "@shared/components/LoginGate.jsx";
import LinkPanel from "@shared/components/LinkPanel.jsx";
import { TOOLS } from "@shared/config.js";
import { clearSession } from "@shared/auth/session.js";
import { publishSync } from "@shared/bridge/sync.js";

const VIEWS = ["overview", "scan", "catalog", "acquire", "review"];

const VIEW_LABELS = {
  overview: "Overview",
  scan: "Scan",
  catalog: "Catalog",
  acquire: "Acquire",
  review: "Review",
};

function VaultScoreRing({ score }) {
  const cls = score >= 70 ? "high" : score >= 50 ? "mid" : "low";
  return (
    <div className={`score-ring ${cls}`}>{score}</div>
  );
}

function OverviewView({ onNavigate, peerSync }) {
  const pendingReview = ID_OBSERVATIONS.filter((o) => !o.confirmed_asset_id).length;
  const totalAssets = ASSETS.length;
  const avgLiquidity = Math.round(
    ASSETS.reduce((s, a) => s + (a.market.raw?.liquidity || 0), 0) / ASSETS.length
  );

  return (
    <>
      <h2 className="page-title">VaultOS</h2>
      <p className="page-sub">
        Store operations — identify, acquire, and feed the IQVault catalog spine.
      </p>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card card-gold">
          <p className="card-title">Catalog Assets</p>
          <p className="stat-value">{totalAssets}</p>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>4 categories · demo seed</span>
        </div>
        <div className="card">
          <p className="card-title">ID Queue</p>
          <p className="stat-value sm">{pendingReview}</p>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>awaiting human confirm</span>
        </div>
        <div className="card">
          <p className="card-title">Avg Liquidity</p>
          <p className="stat-value sm">{avgLiquidity}</p>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>VaultScore input signal</span>
        </div>
        <div className="card">
          <p className="card-title">Classifier Accuracy</p>
          <p className="stat-value sm">94.2%</p>
          <span style={{ fontSize: "0.8rem", color: "var(--green)" }}>↑ compounding with store network</span>
        </div>
      </div>

      {peerSync?.payload && (
        <div className="card card-gold" style={{ marginBottom: 24 }}>
          <p className="card-title">From IQVault</p>
          <p style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>
            Hunt progress: <strong>{peerSync.payload.huntOwned}/{peerSync.payload.huntTotal}</strong>
            {" · "}Active hunts: <strong>{peerSync.payload.activeHunts}</strong>
          </p>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h3 style={{ margin: "0 0 16px" }}>Architecture — SQL Schema Layers</h3>
          <div className="arch-diagram">
            <div className="arch-layer core">
              <strong>vault_core — The Spine</strong>
              <span>asset · external_id · grade_scale · entity · categories</span>
            </div>
            <div className="arch-layer cat">
              <strong>Category Schemas</strong>
              <span>vault_pokemon · vault_mtg · vault_sports · vault_comic</span>
            </div>
            <div className="arch-layer market">
              <strong>vault_market — Valuation</strong>
              <span>priced_unit · sale · market_value · population_report · sealed_product</span>
            </div>
            <div className="arch-layer id">
              <strong>ID Feedback Loop</strong>
              <span>id_observation — every scan + correction trains the classifier</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ margin: "0 0 16px" }}>Identification Pipeline</h3>
          <div className="pipeline">
            {["Capture", "OCR", "Category", "Subset", "Disambiguate", "Price"].map((step, i) => (
              <div key={step} className={`pipeline-step ${i < 5 ? "done" : ""}`}>
                <div className="pipeline-dot">{i + 1}</div>
                <div className="pipeline-label">{step}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "16px 0" }}>
            Stage 4 parallel disambiguation is the moat — sports rainbow ladders, comic printings, TCG finishes.
          </p>
          <div className="actions-row">
            <button className="btn btn-primary" onClick={() => onNavigate("scan")}>
              Run Live Scan Demo
            </button>
            <button className="btn btn-primary" onClick={() => onNavigate("acquire")}>
              Collection Intake
            </button>
            <button className="btn btn-ghost" onClick={() => onNavigate("catalog")}>
              Browse Catalog
            </button>
          </div>
        </div>
      </div>

      <h3 style={{ margin: "32px 0 16px" }}>Featured Assets</h3>
      <div className="asset-grid">
        {ASSETS.slice(0, 4).map((asset) => (
          <AssetCard key={asset.id} asset={asset} onClick={() => onNavigate("catalog", asset.id)} />
        ))}
      </div>
    </>
  );
}

function AssetCard({ asset, onClick }) {
  const cat = getCategory(asset.category);
  const m = asset.market.raw || Object.values(asset.market)[0];
  const trendClass = m.trend_30d >= 0 ? "trend-up" : "trend-down";

  return (
    <div className="asset-card" onClick={onClick}>
      <div className="asset-thumb">{asset.image}</div>
      <div className="asset-name">{asset.canonical_name}</div>
      <div className="asset-meta">
        <span className="badge" style={{ background: `${cat.color}22`, color: cat.color }}>
          {cat.display_name}
        </span>
      </div>
      <div className="asset-price-row">
        <span className="price">{formatCurrency(m.price)}</span>
        <span className={trendClass}>{formatPct(m.trend_30d)}</span>
      </div>
    </div>
  );
}

function ScanView({ onNavigate }) {
  const [scenarioId, setScenarioId] = useState(SCAN_SCENARIOS[0].id);
  const [scanning, setScanning] = useState(false);
  const [stageIndex, setStageIndex] = useState(-1);
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null);
  const intervalRef = useRef(null);

  const scenario = SCAN_SCENARIOS.find((s) => s.id === scenarioId);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const runScan = useCallback(() => {
    if (!scenario?.frames?.length || scanning) return;

    if (intervalRef.current) clearInterval(intervalRef.current);

    setScanning(true);
    setStageIndex(-1);
    setLog([]);
    setResult(null);

    let i = 0;
    intervalRef.current = setInterval(() => {
      if (i < scenario.frames.length) {
        const frame = scenario.frames[i];
        setStageIndex(i);
        setLog((prev) => [...prev, frame]);
        i++;
      } else {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setScanning(false);
        const asset = getAsset(scenario.result);
        if (asset) setResult({ asset, confidence: scenario.confidence });
      }
    }, 700);
  }, [scenario, scanning]);

  useEffect(() => {
    setStageIndex(-1);
    setLog([]);
    setResult(null);
  }, [scenarioId]);

  const pipelineStages = ["Capture", "OCR", "Category", "Subset", "Disambiguate"];

  return (
    <>
      <h2 className="page-title">Scan & Identify</h2>
      <p className="page-sub">Simulated 4-stage ID pipeline with parallel disambiguation.</p>

      <div className="scan-layout">
        <div>
          <div className={`scan-viewport ${scanning ? "scanning" : ""}`}>
            {scanning && <div className="scan-line" />}
            {result?.asset ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 80 }}>{result.asset.image}</div>
                <p style={{ fontWeight: 600, margin: "12px 0 4px" }}>{result.asset.canonical_name}</p>
                <p style={{ color: "var(--gold)", fontWeight: 700 }}>
                  {(result.confidence * 100).toFixed(0)}% confidence
                </p>
              </div>
            ) : (
              <div className="scan-placeholder">
                <div className="emoji">{scanning ? "📷" : "🔍"}</div>
                <p>{scanning ? "Analyzing capture frames…" : "Select a scenario and start scan"}</p>
              </div>
            )}
          </div>

          <div className="pipeline" style={{ marginTop: 20 }}>
            {pipelineStages.map((step, i) => (
              <div
                key={step}
                className={`pipeline-step ${i < stageIndex ? "done" : ""} ${i === stageIndex ? "active" : ""}`}
              >
                <div className="pipeline-dot">{i + 1}</div>
                <div className="pipeline-label">{step}</div>
              </div>
            ))}
          </div>

          <div className="actions-row">
            <button className="btn btn-primary" onClick={runScan} disabled={scanning}>
              {scanning ? "Scanning…" : "Start Scan"}
            </button>
            {result?.asset && (
              <button className="btn btn-ghost" onClick={() => onNavigate("catalog", result.asset.id)}>
                View Asset Detail →
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="card-title">Demo Scenarios</p>
            <div className="scenario-list">
              {SCAN_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  className={`scenario-btn ${scenarioId === s.id ? "selected" : ""}`}
                  onClick={() => setScenarioId(s.id)}
                  disabled={scanning}
                >
                  <strong>{s.label}</strong>
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <p className="card-title">Pipeline Log</p>
            <div className="log-feed">
              {log.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Waiting for scan…</p>
              )}
              {log.map((entry, i) => (
                entry ? (
                  <div key={i} className="log-entry">
                    <div className="log-stage">[{entry.stage}]</div>
                    <div className="log-detail">{entry.detail}</div>
                  </div>
                ) : null
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CatalogView({ selectedId, onSelect, onBack }) {
  const [filter, setFilter] = useState("all");
  const [gradeKey, setGradeKey] = useState("raw");

  const filtered =
    filter === "all" ? ASSETS : ASSETS.filter((a) => a.category === filter);

  if (selectedId) {
    const asset = getAsset(selectedId);
    if (!asset) return null;
    return (
      <AssetDetail asset={asset} gradeKey={gradeKey} setGradeKey={setGradeKey} onBack={onBack} />
    );
  }

  return (
    <>
      <h2 className="page-title">IQVault Catalog</h2>
      <p className="page-sub">Universal asset spine with category-specific detail tables.</p>

      <div className="filter-bar">
        <button
          className={`filter-chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.kind}
            className={`filter-chip ${filter === c.kind ? "active" : ""}`}
            onClick={() => setFilter(c.kind)}
          >
            {c.icon} {c.display_name}
          </button>
        ))}
      </div>

      <div className="asset-grid">
        {filtered.map((asset) => (
          <AssetCard key={asset.id} asset={asset} onClick={() => onSelect(asset.id)} />
        ))}
      </div>
    </>
  );
}

function AssetDetail({ asset, gradeKey, setGradeKey, onBack }) {
  const cat = getCategory(asset.category);
  const gradeKeys = Object.keys(asset.market);
  const m = asset.market[gradeKey] || asset.market.raw;
  const vaultScore = computeVaultScore(asset, gradeKey);
  const offer = computeOffer(asset, gradeKey);

  return (
    <>
      <button className="back-btn" onClick={onBack}>← Back to catalog</button>
      <h2 className="page-title">{asset.canonical_name}</h2>
      <p className="page-sub">
        <span className="badge" style={{ background: `${cat.color}22`, color: cat.color }}>
          {cat.display_name}
        </span>
        {" · "}{asset.slug}
      </p>

      <div className="detail-layout">
        <div className="detail-hero">{asset.image}</div>

        <div>
          <div className="grade-tabs">
            {gradeKeys.map((gk) => (
              <button
                key={gk}
                className={`grade-tab ${gradeKey === gk ? "active" : ""}`}
                onClick={() => setGradeKey(gk)}
              >
                {gk === "raw" ? "Raw" : gk.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="card">
              <p className="card-title">Market Value (90d window)</p>
              <p className="stat-value">{formatCurrency(m.price)}</p>
              <p className={m.trend_30d >= 0 ? "trend-up" : "trend-down"} style={{ margin: "4px 0" }}>
                {formatPct(m.trend_30d)} 30d trend
              </p>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {m.sample_size} sales · {m.velocity} velocity · liquidity {m.liquidity}
              </p>
            </div>

            <div className="offer-box">
              <p className="card-title">Instant Cash Offer</p>
              {!offer ? (
                <p className="offer-meta">No offer data</p>
              ) : offer.avoid ? (
                <>
                  <p className="offer-amount offer-avoid">Avoid</p>
                  <p className="offer-meta" style={{ color: "var(--red)" }}>{offer.avoidReason}</p>
                </>
              ) : (
                <>
                  <VaultScoreRing score={vaultScore} />
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>VaultScore</p>
                  <p className="offer-amount">{formatCurrency(offer.cashOffer)}</p>
                  <p className="offer-meta">
                    {offer.tier} tier · max {formatCurrency(offer.maxOffer)} ·{" "}
                    {Math.round(offer.effectivePct * 100)}% of market
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="detail-section">
            <h3>Asset Identity (vault_core.asset)</h3>
            <dl className="kv-grid">
              <dt>Asset ID</dt>
              <dd style={{ fontFamily: "var(--mono)", fontSize: "0.8rem" }}>{asset.id}</dd>
              <dt>Release Year</dt>
              <dd>{asset.release_year}</dd>
              <dt>Tags</dt>
              <dd>{asset.tags?.join(", ") || "—"}</dd>
              {asset.base_asset_id && (
                <>
                  <dt>Base Asset</dt>
                  <dd style={{ fontFamily: "var(--mono)", fontSize: "0.8rem" }}>{asset.base_asset_id}</dd>
                </>
              )}
            </dl>
          </div>

          {asset.category === "pokemon" && (
            <div className="detail-section">
              <h3>Pokémon Detail (vault_pokemon.card)</h3>
              <dl className="kv-grid">
                <dt>Set</dt>
                <dd>{asset.set}</dd>
                <dt>Collector #</dt>
                <dd>{asset.collector_number}</dd>
                <dt>Variant</dt>
                <dd>{asset.variant_type}</dd>
                <dt>Rarity</dt>
                <dd>{asset.rarity}</dd>
              </dl>
              {asset.parallels && (
                <>
                  <h3 style={{ marginTop: 16 }}>Parallel Ladder</h3>
                  <div className="ladder">
                    {asset.parallels.map((p) => (
                      <span
                        key={p}
                        className={`ladder-rung ${p === asset.variant_type ? "active" : ""}`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {asset.category === "sports" && (
            <div className="detail-section">
              <h3>Sports Detail (vault_sports.card)</h3>
              <dl className="kv-grid">
                <dt>Product</dt>
                <dd>{asset.product}</dd>
                <dt>Player</dt>
                <dd>{asset.player_name}</dd>
                <dt>Card #</dt>
                <dd>{asset.card_number}</dd>
                <dt>Parallel</dt>
                <dd>{asset.parallel_type}{asset.print_run ? ` /${asset.print_run}` : ""}</dd>
                <dt>Rookie</dt>
                <dd>{asset.is_rookie ? "Yes (RC)" : "No"}</dd>
              </dl>
              {asset.parallel_ladder && (
                <>
                  <h3 style={{ marginTop: 16 }}>Rainbow Parallel Ladder</h3>
                  <div className="ladder">
                    {asset.parallel_ladder.map((p) => (
                      <span
                        key={p}
                        className={`ladder-rung ${p === asset.parallel_type ? "active" : ""}`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {asset.pop && (
                <>
                  <h3 style={{ marginTop: 16 }}>Population (PSA)</h3>
                  <dl className="kv-grid">
                    <dt>PSA 10</dt>
                    <dd>{asset.pop.psa10?.toLocaleString()}</dd>
                    <dt>PSA 9</dt>
                    <dd>{asset.pop.psa9?.toLocaleString()}</dd>
                  </dl>
                </>
              )}
            </div>
          )}

          {asset.category === "mtg" && (
            <div className="detail-section">
              <h3>MTG Detail (vault_mtg.card)</h3>
              <dl className="kv-grid">
                <dt>Set</dt>
                <dd>{asset.set}</dd>
                <dt>Collector #</dt>
                <dd>{asset.collector_number}</dd>
                <dt>Variant</dt>
                <dd>{asset.variant_type}</dd>
                <dt>Finish</dt>
                <dd>{asset.finish}</dd>
                {asset.is_serialized && (
                  <>
                    <dt>Serialized</dt>
                    <dd>/{asset.serial_max}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {asset.category === "comic" && (
            <div className="detail-section">
              <h3>Comic Detail (vault_comic.variant)</h3>
              <dl className="kv-grid">
                <dt>Series</dt>
                <dd>{asset.series}</dd>
                <dt>Publisher</dt>
                <dd>{asset.publisher}</dd>
                <dt>Issue</dt>
                <dd>#{asset.issue_number}</dd>
                <dt>Printing</dt>
                <dd>{asset.printing}{asset.printings_available ? ` of ${asset.printings_available}` : ""}</dd>
                <dt>Cover</dt>
                <dd>{asset.cover_label} — {asset.cover_artist}</dd>
                {asset.is_key_issue && (
                  <>
                    <dt>Key Issue</dt>
                    <dd>{asset.key_reason}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {asset.format === "sealed_product" && (
            <div className="detail-section">
              <h3>Sealed Product (vault_market.sealed_product)</h3>
              <dl className="kv-grid">
                <dt>Type</dt>
                <dd>{asset.product_type}</dd>
                <dt>Packs</dt>
                <dd>{asset.pack_count}</dd>
                <dt>MSRP</dt>
                <dd>{formatCurrency(asset.msrp)}</dd>
                <dt>Est. EV</dt>
                <dd>{formatCurrency(asset.estimated_ev)}</dd>
              </dl>
            </div>
          )}

          {asset.external_ids && (
            <div className="detail-section">
              <h3>External IDs (vault_core.external_id)</h3>
              <div className="external-ids">
                {asset.external_ids.map((e) => (
                  <span key={e.source} className="ext-id">
                    <span style={{ color: "var(--gold)" }}>{e.source}</span>: {e.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ReviewView() {
  const [observations, setObservations] = useState(ID_OBSERVATIONS);

  const confirm = (obsId, assetId) => {
    setObservations((prev) =>
      prev.map((o) =>
        o.id === obsId
          ? {
              ...o,
              confirmed_asset_id: assetId,
              was_correct: o.predicted_asset_id === assetId,
            }
          : o
      )
    );
  };

  const pending = observations.filter((o) => !o.confirmed_asset_id);
  const resolved = observations.filter((o) => o.confirmed_asset_id);

  return (
    <>
      <h2 className="page-title">ID Review Queue</h2>
      <p className="page-sub">
        Human corrections feed vault_market.id_observation — the compounding training-data moat.
      </p>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="card-title">Pending Review</p>
          <p className="stat-value sm">{pending.length}</p>
        </div>
        <div className="card">
          <p className="card-title">Resolved Today</p>
          <p className="stat-value sm">{resolved.length}</p>
        </div>
      </div>

      <h3 style={{ marginBottom: 12 }}>Review Queue</h3>
      {pending.map((obs) => {
        const predicted = getAsset(obs.predicted_asset_id);
        return (
          <div key={obs.id} className="queue-item">
            <div className="queue-thumb">{predicted?.image || "❓"}</div>
            <div className="queue-body">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>Scan #{obs.id}</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {obs.capture_frames} frames · store {obs.store_id?.slice(-3)}
                </span>
              </div>
              <div className="queue-ocr">OCR: {obs.ocr_text}</div>
              <p style={{ fontSize: "0.85rem", margin: "0 0 8px" }}>
                Predicted: <strong>{predicted?.canonical_name}</strong>{" "}
                <span style={{ color: "var(--gold)" }}>
                  ({(obs.predicted_confidence * 100).toFixed(0)}%)
                </span>
              </p>
              {obs.candidates && (
                <div className="candidate-list">
                  {obs.candidates.map((c) => {
                    const a = getAsset(c.asset_id);
                    return (
                      <div key={c.asset_id} className="candidate" onClick={() => confirm(obs.id, c.asset_id)}>
                        <div>
                          <div>{a?.canonical_name}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{c.reason}</div>
                          <div className="conf-bar">
                            <div className="conf-fill" style={{ width: `${c.confidence * 100}%` }} />
                          </div>
                        </div>
                        <span style={{ color: "var(--gold)", fontWeight: 600 }}>
                          {(c.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {resolved.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 12px" }}>Recently Resolved</h3>
          {resolved.map((obs) => {
            const confirmed = getAsset(obs.confirmed_asset_id);
            return (
              <div key={obs.id} className="queue-item" style={{ opacity: 0.7 }}>
                <div className="queue-thumb">{confirmed?.image}</div>
                <div>
                  <strong>Scan #{obs.id}</strong>
                  <p style={{ margin: "4px 0", fontSize: "0.85rem" }}>
                    Confirmed: {confirmed?.canonical_name}{" "}
                    {obs.was_correct ? (
                      <span style={{ color: "var(--green)" }}>✓ auto-correct</span>
                    ) : (
                      <span style={{ color: "var(--gold)" }}>↻ human correction → retrain</span>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function VaultOSApp({ session }) {
  const [view, setView] = useState("overview");
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [peerSync, setPeerSync] = useState(null);

  const pendingReview = ID_OBSERVATIONS.filter((o) => !o.confirmed_asset_id).length;

  const syncPayload = useMemo(
    () => ({
      catalogAssets: ASSETS.length,
      pendingReviews: pendingReview,
      classifierAccuracy: "94.2%",
      storeName: session.user.name,
    }),
    [pendingReview, session.user.name]
  );

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "acquire") setView("acquire");
  }, []);

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
  }, [session, pendingReview]);

  const navigate = (v, assetId = null) => {
    setView(v);
    setSelectedAssetId(assetId);
  };

  const signOut = () => {
    clearSession(TOOLS.VAULTOS);
    window.location.reload();
  };

  return (
    <div className="app vaultos-app">
      <header className="header">
        <div className="brand">
          <div className="brand-icon vaultos-icon">🏪</div>
          <div className="brand-text">
            <h1>VaultOS</h1>
            <span>Store Operations · 258 Labs</span>
          </div>
        </div>

        <nav className="nav">
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`nav-btn ${view === v ? "active" : ""}`}
              onClick={() => navigate(v)}
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

      <main className="main">
        {view === "overview" && (
          <>
            <OverviewView onNavigate={navigate} peerSync={peerSync} />
            <LinkPanel session={session} syncPayload={syncPayload} />
          </>
        )}
        {view === "scan" && <ScanView onNavigate={navigate} />}
        {view === "catalog" && (
          <CatalogView
            selectedId={selectedAssetId}
            onSelect={setSelectedAssetId}
            onBack={() => setSelectedAssetId(null)}
          />
        )}
        {view === "acquire" && <AcquireView onNavigate={navigate} />}
        {view === "review" && <ReviewView />}
      </main>

      <footer className="footer">
        Subscription product · feeds IQVault · Schema:{" "}
        <code>01_core_spine.sql</code> · <code>04_market_sealed_id.sql</code>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <LoginGate toolId={TOOLS.VAULTOS}>
      {({ session }) => <VaultOSApp session={session} />}
    </LoginGate>
  );
}
