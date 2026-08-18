import { Nav } from "@/components/Nav";
import { apiGet, type Signal } from "@/lib/api";

type PredictionsPayload = {
  signalsIngestion: { live: boolean; mode: string; note: string };
  open: {
    priceAtPrediction: number;
    horizonDays: number;
    probabilityDown: number;
    probabilitySideways: number;
    probabilityUp: number;
    modelVersion: string;
    resolvesAt: string;
  }[];
  needsScoring: unknown[];
  calibration: {
    modelVersion: string;
    resolvedCount: number;
    directionalAccuracyPct: number | null;
    avgForecastError: number | null;
    biasNote: string;
  }[];
  claimLedger: {
    total: number;
    pending: number;
    scored: number;
    averageBrier: number | null;
    hits: number;
    misses: number;
  };
};

export default async function SignalsPage() {
  let error: string | null = null;
  let signals: Signal[] = [];
  let source: string | null = null;
  let feedKind: "job_feed" | "seed" | "unknown" = "unknown";
  let ingestionLive = false;
  let ingestionNote: string | null = null;
  let predictions: PredictionsPayload | null = null;
  try {
    const data = await apiGet<{
      signals: Signal[];
      source?: string;
      feed?: { writtenAt?: string; runId?: string | null; job?: string | null } | null;
      signalsIngestion?: { live: boolean; mode: string; note: string };
    }>("/api/signals");
    signals = data.signals;
    feedKind = data.source === "job_feed" || data.source === "seed" ? data.source : "unknown";
    source = data.source ?? null;
    if (data.feed?.writtenAt) {
      source = `${data.source ?? "feed"} · ${data.feed.job ?? "job"} · ${data.feed.writtenAt.slice(0, 19)}`;
    }
    ingestionLive = data.signalsIngestion?.live ?? false;
    ingestionNote = data.signalsIngestion?.note ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load signals";
  }
  try {
    predictions = await apiGet<PredictionsPayload>("/api/intelligence/predictions");
  } catch {
    predictions = null;
  }

  return (
    <div className="shell">
      <><Nav active="/signals" />
      <h1 className="page-title">Signals</h1>
      <p className="page-sub">
        Normalized intelligence events. Quarantined noise is labeled, not deleted.
        {source ? (
          <>
            {" "}
            <span className="muted">Source: {source}</span>
          </>
        ) : null}
      </p>
      {error ? <div className="error">{error}</div> : null}
      <div className="stack">
        <article className="panel">
          <h3>Signals ingestion</h3>
          <span className={`badge ${ingestionLive ? "badge-ok" : "badge-warn"}`}>
            {ingestionLive ? "live" : "not live"}
          </span>
          <span className="badge badge-info">{feedKind}</span>
          <p className="muted" style={{ marginBottom: 0 }}>
            {ingestionNote ??
              "Job feed is not signals_raw / signals_normalized. Phase 2 cycle scoring stays blocked."}
          </p>
        </article>
        {predictions ? (
          <article className="panel">
            <h3>Prediction ledger</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Price-direction ledger (<code>@vip/intelligence</code>) plus claim/Brier ledger (
              <code>@vip/signals</code>).
            </p>
            {predictions.open.map((p) => (
              <p key={p.resolvesAt} style={{ margin: "8px 0 0" }}>
                Mega Greninja-style open forecast ${p.priceAtPrediction} · {p.horizonDays}d ·{" "}
                {Math.round(p.probabilityDown * 100)}% down / {Math.round(p.probabilitySideways * 100)}%
                sideways / {Math.round(p.probabilityUp * 100)}% up
              </p>
            ))}
            <p className="muted" style={{ fontSize: 13 }}>
              Needs scoring: {predictions.needsScoring.length} · claim ledger {predictions.claimLedger.pending}{" "}
              pending
              {predictions.claimLedger.averageBrier != null
                ? ` · avg Brier ${predictions.claimLedger.averageBrier}`
                : ""}
            </p>
            {predictions.calibration.map((c) => (
              <p key={c.modelVersion} className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                {c.modelVersion}: {c.directionalAccuracyPct}% directional accuracy on {c.resolvedCount}{" "}
                resolved · {c.biasNote}
              </p>
            ))}
          </article>
        ) : null}
        {signals.map((s) => (
          <article key={s.id} className="panel">
            <div>
              <span className="badge badge-info">{s.signalType}</span>
              <span
                className={`badge ${
                  s.quarantineStatus === "quarantined" ? "badge-warn" : "badge-ok"
                }`}
              >
                {s.quarantineStatus}
              </span>
              <span className="badge badge-info" style={{ opacity: 0.85 }}>
                {feedKind === "job_feed" ? "feed" : feedKind === "seed" ? "seed" : "source"}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {s.signalDate}
              </span>
            </div>
            <p style={{ marginBottom: 0 }}>{s.body}</p>
          </article>
        ))}
      </div>
      </>
    </div>
  );
}
