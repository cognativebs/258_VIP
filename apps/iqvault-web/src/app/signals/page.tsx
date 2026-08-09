import { Nav } from "@/components/Nav";
import { apiGet, type Signal } from "@/lib/api";

export default async function SignalsPage() {
  let error: string | null = null;
  let signals: Signal[] = [];
  let source: string | null = null;
  let feedKind: "job_feed" | "seed" | "unknown" = "unknown";
  try {
    const data = await apiGet<{
      signals: Signal[];
      source?: string;
      feed?: { writtenAt?: string; runId?: string | null; job?: string | null } | null;
    }>("/api/signals");
    signals = data.signals;
    feedKind = data.source === "job_feed" || data.source === "seed" ? data.source : "unknown";
    source = data.source ?? null;
    if (data.feed?.writtenAt) {
      source = `${data.source ?? "feed"} · ${data.feed.job ?? "job"} · ${data.feed.writtenAt.slice(0, 19)}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load signals";
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
