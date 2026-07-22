import { Nav } from "@/components/Nav";
import { apiGet } from "@/lib/api";

export default async function SignalsPage() {
  let error: string | null = null;
  let signals: {
    id: string;
    signalType: string;
    body: string;
    signalDate: string;
    quarantineStatus: string;
  }[] = [];
  try {
    const data = await apiGet<{ signals: typeof signals }>("/api/signals");
    signals = data.signals;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load signals";
  }

  return (
    <>
      <Nav active="/signals" />
      <h1 className="page-title">Signals</h1>
      <p className="page-sub">Normalized intelligence events. Quarantined noise is labeled, not deleted.</p>
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
              <span className="muted" style={{ fontSize: 12 }}>
                {s.signalDate}
              </span>
            </div>
            <p style={{ marginBottom: 0 }}>{s.body}</p>
          </article>
        ))}
      </div>
    </>
  );
}
