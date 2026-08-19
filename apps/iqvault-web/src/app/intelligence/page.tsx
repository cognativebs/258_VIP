import { IntelligenceDesk } from "@/components/intelligence/IntelligenceDesk";
import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

type IntelligenceSnapshot = {
  version: string;
  signalsIngestion: {
    live: boolean;
    mode: string;
    note: string;
    blocks: string[];
  };
  recommendations: {
    id: string;
    action: string;
    confidence: number;
    rationale: string | null;
    isStale: boolean;
    evidence: { evidenceSource: string; freshnessHours: number; supportingEvidence: string | null }[];
  }[];
  underwriting: {
    lotDescription: string | null;
    offerPrice: number;
    conservativeRawValue: number;
    acquisitionCoverageRatio: number;
    coverageRatioMinimumThreshold: number;
    belowThreshold: boolean;
    blocked: boolean;
  }[];
  grading: Record<
    string,
    {
      recommendation: string;
      expectedIncrementalProfit: number;
      gradingOpportunityScore: number;
      rawValue: number;
      notes: string | null;
    }
  >;
  collection: {
    synergy: {
      collectionSynergyScore: number;
      marketAttractiveness: number;
      museumImportance: number;
      investmentScore: number;
      liquidityScore: number;
      notes: string | null;
    }[];
    binder: {
      museumCompletion: {
        filledSlots: number;
        totalSlots: number;
        ripVsSinglesRecommendation: string;
      };
      culturalIconsPageType: string;
      /** Real binder totals from vault_tcg (ADR 0007). */
      liveBinders: {
        id: string;
        name: string;
        pages: number;
        ownedSlots: number;
        needSlots: number;
      }[];
      pageChaseCompletion: { available: boolean; note: string };
    };
  };
  gradingQueue: {
    notes: string | null;
    recommendation: string;
    gradingOpportunityScore: number;
    expectedIncrementalProfit: number;
  }[];
  predictions: { needsScoring: unknown[] };
  identification: { goldenCount: number; target: number };
  phase2: { manualScans: { watchNote: string | null }[] };
};

export default async function IntelligencePage() {
  let error: string | null = null;
  let snap: IntelligenceSnapshot | null = null;
  try {
    snap = await apiGet<IntelligenceSnapshot>("/api/intelligence");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load intelligence";
  }

  return (
    <div className="shell">
      <Nav active="/intelligence" />
      <h1 className="page-title">Intelligence</h1>
      <p className="page-sub">
        Phase 1 scoring + write desk. Phase 2 stays manual-only until Signals ingestion is live.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <IntelligenceDesk />
      {snap ? (
        <div className="stack" style={{ marginTop: 18 }}>
          <article className="panel">
            <h3>Signals ingestion gate</h3>
            <span className={`badge ${snap.signalsIngestion.live ? "badge-ok" : "badge-warn"}`}>
              {snap.signalsIngestion.live ? "live" : "not live"}
            </span>
            <span className="badge badge-info">{snap.signalsIngestion.mode}</span>
            <span className="badge">{snap.version}</span>
            <p className="muted" style={{ marginBottom: 0 }}>
              {snap.signalsIngestion.note} Blocks: {snap.signalsIngestion.blocks.join(", ")}.
            </p>
          </article>

          {snap.recommendations.map((r) => (
            <article key={r.id} className="panel">
              <h3>
                {r.action.toUpperCase()} · {r.rationale ?? "Evidence card"}
              </h3>
              <span className={`badge ${r.isStale ? "badge-warn" : "badge-ok"}`}>
                {r.isStale ? "stale" : "current"}
              </span>
              <span className="badge">{Math.round(r.confidence * 100)}% confidence</span>
              <p style={{ margin: "10px 0 0" }}>{r.rationale}</p>
              <ul className="muted" style={{ fontSize: 13 }}>
                {r.evidence.map((e) => (
                  <li key={e.evidenceSource}>
                    {e.evidenceSource} · {e.freshnessHours}h old
                    {e.supportingEvidence ? ` — ${e.supportingEvidence}` : ""}
                  </li>
                ))}
              </ul>
            </article>
          ))}

          {snap.underwriting.map((u) => (
            <article key={u.lotDescription ?? "lot"} className="panel">
              <h3>Acquisition underwriting · {u.lotDescription}</h3>
              <span className={`badge ${u.belowThreshold ? "badge-warn" : "badge-ok"}`}>
                {u.acquisitionCoverageRatio.toFixed(3)}× coverage
              </span>
              <span className="badge">{u.blocked ? "blocked" : "not blocked"}</span>
              <p className="muted" style={{ marginBottom: 0 }}>
                Offer ${u.offerPrice} / conservative ${u.conservativeRawValue} · threshold{" "}
                {u.coverageRatioMinimumThreshold.toFixed(2)}×. Below threshold flags for
                human review — never auto-blocks.
              </p>
            </article>
          ))}

          <article className="panel">
            <h3>Grading optimizer</h3>
            <div className="evidence">
              {Object.entries(snap.grading).map(([name, g]) => (
                <div key={name}>
                  <strong style={{ textTransform: "capitalize" }}>{name}</strong>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                    {g.recommendation.replaceAll("_", " ")} · score {g.gradingOpportunityScore} ·
                    incremental ${g.expectedIncrementalProfit} vs raw ${g.rawValue}
                  </p>
                  {g.notes ? <p className="muted" style={{ fontSize: 12 }}>{g.notes}</p> : null}
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h3>Binder chase + museum synergy</h3>
            <p>
              Museum page {snap.collection.binder.museumCompletion.filledSlots}/
              {snap.collection.binder.museumCompletion.totalSlots} ·{" "}
              <span className="badge badge-info">
                {snap.collection.binder.museumCompletion.ripVsSinglesRecommendation}
              </span>
              <span className="badge">
                {snap.collection.binder.culturalIconsPageType} is a separate page type
              </span>
            </p>
            {snap.collection.binder.liveBinders.slice(0, 8).map((b) => (
              <p key={b.id} className="muted" style={{ fontSize: 13 }}>
                {b.name} · {b.pages} pages · {b.ownedSlots} owned / {b.needSlots} needed
              </p>
            ))}
            {snap.collection.binder.liveBinders.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No binders in <code>vault_tcg</code> yet.
              </p>
            ) : null}
            {!snap.collection.binder.pageChaseCompletion.available ? (
              <p className="muted" style={{ fontSize: 12 }}>
                {snap.collection.binder.pageChaseCompletion.note}
              </p>
            ) : null}
            {snap.collection.synergy.slice(0, 8).map((s, i) => (
              <p key={`${s.notes ?? "syn"}-${i}`} className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
                {s.notes} — composite {s.collectionSynergyScore} (market {s.marketAttractiveness} ·
                museum {s.museumImportance} · invest {s.investmentScore} · liq {s.liquidityScore})
              </p>
            ))}
          </article>

          <article className="panel">
            <h3>8. Grading queue + needs scoring</h3>
            <p className="muted">
              Unresolved past horizon: {snap.predictions.needsScoring.length}. Golden deck{" "}
              {snap.identification.goldenCount}/{snap.identification.target}.
            </p>
            {snap.gradingQueue.slice(0, 8).map((g, i) => (
              <p key={`${g.notes ?? i}`} className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                {g.recommendation} · score {g.gradingOpportunityScore} · Δ ${g.expectedIncrementalProfit}
                {g.notes ? ` — ${g.notes}` : ""}
              </p>
            ))}
          </article>

          <article className="panel">
            <h3>Manual accumulation watch</h3>
            {snap.phase2.manualScans.map((s, i) => (
              <p key={s.watchNote ?? i} className="muted" style={{ marginBottom: 0 }}>
                {s.watchNote ?? "Manual scan"}
              </p>
            ))}
          </article>
        </div>
      ) : null}
    </div>
  );
}
