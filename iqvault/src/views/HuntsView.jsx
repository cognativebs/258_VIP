import { useState } from "react";
import { HUNTS, getHunt } from "../data/hunts/index.js";
import { huntCompletion, sectionCompletion, getBuyTargets, statusIcon } from "../lib/huntEngine.js";
import { formatCurrency } from "@shared/format.js";
import IntelligenceRunPanel from "../components/IntelligenceRunPanel.jsx";

function CompletionRing({ pct, size = 72 }) {
  const cls = pct >= 50 ? "high" : pct >= 20 ? "mid" : "low";
  return (
    <div className={`hunt-ring ${cls}`} style={{ width: size, height: size }}>
      <span>{pct}%</span>
    </div>
  );
}

function HuntCard({ hunt, onSelect }) {
  const completion = hunt.comingSoon ? null : huntCompletion(hunt);

  return (
    <div
      className={`hunt-card ${hunt.comingSoon ? "hunt-card-soon" : ""}`}
      onClick={() => onSelect(hunt.id)}
    >
      <div className="hunt-card-header">
        <div className="hunt-card-icon" style={{ background: `${hunt.color}22`, borderColor: `${hunt.color}44` }}>
          {hunt.icon}
        </div>
        {hunt.comingSoon ? (
          <span className="hunt-badge-soon">Coming Soon</span>
        ) : (
          <CompletionRing pct={completion.overall} size={56} />
        )}
      </div>
      <h3 className="hunt-card-title">{hunt.name}</h3>
      <p className="hunt-card-desc">{hunt.description}</p>
      {!hunt.comingSoon && completion && (
        <div className="hunt-card-stats">
          <span>{completion.totalOwned}/{completion.totalItems} owned</span>
          <span>Est. remaining {formatCurrency(completion.remainingCost)}</span>
        </div>
      )}
      {hunt.comingSoon && (
        <p className="hunt-card-preview">{hunt.previewTargets?.length} chase singles queued</p>
      )}
    </div>
  );
}

function HuntDetail({ hunt, onBack }) {
  const [activeSection, setActiveSection] = useState(hunt.sections?.[0]?.id ?? null);

  if (hunt.comingSoon) {
    return (
      <>
        <button className="back-btn" onClick={onBack}>← All Hunts</button>
        <div className="hunt-soon-hero">
          <div className="hunt-soon-icon">{hunt.icon}</div>
          <h2 className="page-title">{hunt.name}</h2>
          <span className="hunt-badge-soon lg">Coming Soon</span>
          <p className="page-sub">{hunt.description}</p>
        </div>

        <div className="grid-2">
          <div className="card">
            <p className="card-title">Preview Targets</p>
            <ul className="hunt-preview-list">
              {hunt.previewTargets.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <p className="card-title">Planned Features</p>
            <ul className="hunt-preview-list">
              {hunt.plannedFeatures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </>
    );
  }

  const completion = huntCompletion(hunt);
  const buyTargets = getBuyTargets(hunt, 6);
  const section = hunt.sections.find((s) => s.id === activeSection) ?? hunt.sections[0];
  const sectionComp = sectionCompletion(section);

  return (
    <>
      <button className="back-btn" onClick={onBack}>← All Hunts</button>

      <div className="hunt-detail-header">
        <div className="hunt-detail-icon" style={{ background: `${hunt.color}22` }}>{hunt.icon}</div>
        <div>
          <h2 className="page-title">{hunt.name}</h2>
          <p className="page-sub">{hunt.description}</p>
          {hunt.releaseDate && (
            <p style={{ margin: "-16px 0 0", fontSize: "0.85rem", color: "var(--gold)" }}>
              Release wave: {hunt.releaseDate}
            </p>
          )}
        </div>
        <CompletionRing pct={completion.overall} size={80} />
      </div>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card card-gold">
          <p className="card-title">Overall Completion</p>
          <p className="stat-value sm">{completion.overall}%</p>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {completion.totalOwned} of {completion.totalItems} items
          </span>
        </div>
        <div className="card">
          <p className="card-title">Cost Basis (Owned)</p>
          <p className="stat-value sm">{formatCurrency(completion.paidTotal)}</p>
        </div>
        <div className="card">
          <p className="card-title">Est. Remaining</p>
          <p className="stat-value sm">{formatCurrency(completion.remainingCost)}</p>
        </div>
        <div className="card">
          <p className="card-title">Budget</p>
          <p className="stat-value sm">{formatCurrency(hunt.budget)}</p>
        </div>
      </div>

      {hunt.intelligenceRun && <IntelligenceRunPanel run={hunt.intelligenceRun} />}

      <div className="hunt-metrics-bar">
        {hunt.sections.map((s) => {
          const comp = completion.sections[s.metricKey ?? s.id];
          return (
            <button
              key={s.id}
              className={`hunt-metric-chip ${activeSection === s.id ? "active" : ""}`}
              onClick={() => setActiveSection(s.id)}
            >
              <span className="hunt-metric-name">{s.name.split("—")[0].trim()}</span>
              <span className="hunt-metric-pct">{comp.pct}%</span>
              <span className="hunt-metric-count">{comp.owned}/{comp.total}</span>
            </button>
          );
        })}
      </div>

      <div className="grid-2 hunt-detail-grid">
        <div>
          <div className="card">
            <div className="hunt-section-head">
              <h3>{section.name}</h3>
              <span className="hunt-section-pct">{sectionComp.pct}% complete</span>
            </div>

            <div className="hunt-gallery">
              {section.items.map((item) => {
                const st = statusIcon(item.status);
                return (
                  <div key={item.id} className={`hunt-item ${st.className}`}>
                    <div className="hunt-item-status">{st.emoji}</div>
                    <div className="hunt-item-body">
                      <div className="hunt-item-name">{item.name}</div>
                      <div className="hunt-item-meta">
                        {item.grade && <span>{item.grade}</span>}
                        {item.coverArtist && <span>{item.coverArtist}</span>}
                        {item.productType && <span>{item.productType.replace(/_/g, " ")}</span>}
                        {item.priorityLabel && (
                          <span className={`hunt-priority-label priority-${item.priorityLabel.replace("+", "plus")}`}>
                            {item.priorityLabel}
                          </span>
                        )}
                        {item.targetQty != null && <span>Qty {item.targetQty}</span>}
                        {!item.priorityLabel && item.priority === "critical" && (
                          <span className="hunt-priority-critical">Critical</span>
                        )}
                        {!item.priorityLabel && item.priority === "high" && (
                          <span className="hunt-priority-high">High</span>
                        )}
                      </div>
                      {item.notes && <div className="hunt-item-notes">{item.notes}</div>}
                    </div>
                    <div className="hunt-item-prices">
                      {item.paid != null && (
                        <div><span className="hunt-price-label">Paid</span> {formatCurrency(item.paid)}</div>
                      )}
                      {item.market != null && (
                        <div><span className="hunt-price-label">Market</span> {formatCurrency(item.market)}</div>
                      )}
                      {(item.buyUnder != null || item.msrp != null) && (
                        <div className="hunt-buy-under">
                          <span className="hunt-price-label">Buy under</span>{" "}
                          {formatCurrency(item.buyUnder ?? item.msrp)}
                        </div>
                      )}
                      {item.emergencyCap != null && (
                        <div className="hunt-emergency-cap">
                          <span className="hunt-price-label">Emergency</span>{" "}
                          {formatCurrency(item.emergencyCap)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hunt.strategy && (
            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">Strategy</p>
              <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>{hunt.strategy.focus}</p>
              <div className="hunt-rules">
                <div>
                  <strong style={{ color: "var(--green)" }}>Buy</strong>
                  <ul>{hunt.strategy.buyRules.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
                <div>
                  <strong style={{ color: "var(--red)" }}>Avoid</strong>
                  <ul>{hunt.strategy.avoidRules.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="card-title">AI Recommendations</p>
            {hunt.recommendations.map((rec, i) => (
              <div key={i} className="hunt-rec">
                <div className="hunt-rec-head">
                  <strong>{rec.item}</strong>
                  <span className="hunt-rec-conf">{(rec.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="hunt-rec-reason">{rec.reason}</p>
                <div className="hunt-rec-meta">
                  <span>{rec.estimatedRoi}</span>
                  <span>{rec.completionImpact}</span>
                  {rec.buyUnder != null && <span>Buy under {formatCurrency(rec.buyUnder)}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="card-title">Top Buy Targets</p>
            {buyTargets.map((t, i) => (
              <div key={i} className="hunt-target">
                <div>
                  <strong>{t.name}</strong>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t.section}</div>
                </div>
                <div className="hunt-target-price">
                  {t.buyUnder != null && formatCurrency(t.buyUnder)}
                  {t.emergencyCap != null && (
                    <div className="hunt-target-emergency">max {formatCurrency(t.emergencyCap)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <p className="card-title">Market Signals</p>
            {hunt.signals.map((sig, i) => (
              <div key={i} className="hunt-signal">
                <span className={`hunt-signal-type ${sig.type}`}>{sig.type}</span>
                <p>{sig.text}</p>
                <span className="hunt-signal-date">{sig.date}</span>
              </div>
            ))}
          </div>

          {hunt.retailers && (
            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">Retailer Intelligence</p>
              {hunt.retailers.map((r) => (
                <div key={r.name} className="intel-retailer-row">
                  <div>
                    <strong>{r.name}</strong>
                    <span className={`hunt-retailer ${r.priority}`}>{r.priority}</span>
                  </div>
                  <div className="intel-retailer-meta">
                    <span>{r.status}</span>
                    <span>{r.action}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hunt.objectives && (
            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">Objectives</p>
              <ul className="hunt-objectives">
                {hunt.objectives.map((o) => <li key={o}>{o}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function HuntsView() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = selectedId ? getHunt(selectedId) : null;

  if (selected) {
    return <HuntDetail hunt={selected} onBack={() => setSelectedId(null)} />;
  }

  const activeHunts = HUNTS.filter((h) => h.status !== "coming_soon");
  const soonHunts = HUNTS.filter((h) => h.status === "coming_soon");
  const totalOwned = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalOwned ?? 0), 0);
  const totalItems = activeHunts.reduce((s, h) => s + (huntCompletion(h)?.totalItems ?? 0), 0);

  return (
    <>
      <h2 className="page-title">Collection Hunts</h2>
      <p className="page-sub">
        Decision intelligence for curated collectible goals — not just inventory tracking.
      </p>

      <div className="grid-4" style={{ marginBottom: 28 }}>
        <div className="card card-gold">
          <p className="card-title">Active Hunts</p>
          <p className="stat-value sm">{activeHunts.length}</p>
        </div>
        <div className="card">
          <p className="card-title">Items Owned</p>
          <p className="stat-value sm">{totalOwned}/{totalItems}</p>
        </div>
        <div className="card">
          <p className="card-title">Coming Soon</p>
          <p className="stat-value sm">{soonHunts.length}</p>
        </div>
        <div className="card">
          <p className="card-title">Philosophy</p>
          <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--gold)", fontStyle: "italic" }}>
            What should I buy next?
          </p>
        </div>
      </div>

      <h3 style={{ margin: "0 0 16px" }}>Your Vault</h3>
      <div className="hunt-grid">
        {HUNTS.map((hunt) => (
          <HuntCard key={hunt.id} hunt={hunt} onSelect={setSelectedId} />
        ))}
      </div>
    </>
  );
}
