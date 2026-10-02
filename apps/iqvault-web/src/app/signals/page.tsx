import { Nav } from "@/components/Nav";
import { apiGet, type Signal } from "@/lib/api";

type SignalOutput = {
  signalId: string;
  title: string;
  body: string;
  action: string;
  bucketHint: string;
  reason: string;
  confidence: number;
};

type DailySports = {
  at: string;
  profile: { name: string; version: string; slots: number; windowHours: number; verified: boolean };
  groups: { key: string; label: string; share: number; stance: string; allocated: number; filled: number; backfilled: number }[];
  unfilled: number;
  items: {
    signalId: string;
    rank: number;
    group: string;
    signalTypeName: string;
    title: string;
    summary: string;
    player: string | null;
    sourceUrl: string | null;
    attribution: string;
    direction: string;
    influence: number;
    baseConfidence: number;
    framing: "sell_window" | "exit_watch" | null;
    backfilled: boolean;
  }[];
};

const FRAMING_LABEL = { sell_window: "Sell window", exit_watch: "Exit · watch" } as const;

export default async function SignalsPage() {
  let error: string | null = null;
  let signals: Signal[] = [];
  let outputs: SignalOutput[] = [];
  let source: string | null = null;
  let feedKind: "job_feed" | "seed" | "unknown" = "unknown";
  let daily: DailySports | null = null;
  let dailyError: string | null = null;
  try {
    daily = await apiGet<DailySports>("/api/signals/daily-sports");
  } catch (e) {
    dailyError = e instanceof Error ? e.message : "Failed to load the daily sports list";
  }
  try {
    const data = await apiGet<{
      signals: Signal[];
      source?: string;
      feed?: { writtenAt?: string; runId?: string | null; job?: string | null } | null;
      output?: { outputs?: SignalOutput[] };
    }>("/api/signals");
    signals = data.signals;
    outputs = data.output?.outputs ?? [];
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
      <Nav active="/signals" />
      <h1 className="page-title">Signals</h1>
      <p className="page-sub">
        Normalized intelligence events. Quarantined noise is labeled, not deleted. Output
        below is bucket-aware (Hold / Review / Churn) — inferred · unverified, never a price.
        {source ? (
          <>
            {" "}
            <span className="muted">Source: {source}</span>
          </>
        ) : null}
      </p>
      {error ? <div className="error">{error}</div> : null}

      <section className="panel" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Daily Sports SIGNAL</h2>
        {dailyError ? <div className="error">{dailyError}</div> : null}
        {daily ? (
          <>
            <p className="muted">
              Last {daily.profile.windowHours}h · {daily.profile.slots} slots ·{" "}
              {daily.groups.map((g) => `${g.label} ${Math.round(g.share * 100)}% (${g.filled + g.backfilled}/${g.allocated})`).join(" · ")}
              {daily.unfilled ? ` · ${daily.unfilled} slots unfilled` : ""} · profile {daily.profile.name}@
              {daily.profile.version} {daily.profile.verified ? "" : "· unverified"}. Ranked by decayed priority; shares
              decide slots only. Sell windows mark sports you are exiting — not a Sell recommendation.
            </p>
            {daily.items.length === 0 ? (
              <p className="muted">No sports signals first seen in this window.</p>
            ) : (
              <div className="stack">
                {daily.items.map((i) => (
                  <article key={i.signalId}>
                    <span className="badge badge-info">{i.group}</span>{" "}
                    <span className="badge badge-info">{i.signalTypeName}</span>{" "}
                    {i.framing ? (
                      <span className={`badge ${i.framing === "sell_window" ? "badge-ok" : "badge-warn"}`}>
                        {FRAMING_LABEL[i.framing]}
                      </span>
                    ) : null}{" "}
                    {i.backfilled ? <span className="badge badge-warn">backfill</span> : null}{" "}
                    <strong>{i.title}</strong>
                    <p style={{ marginBottom: 0 }}>{i.summary}</p>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                      {i.player ? `${i.player} · ` : ""}
                      {i.direction} · confidence {i.baseConfidence.toFixed(2)} · influence {i.influence.toFixed(3)} · inferred ·
                      unverified ·{" "}
                      {i.sourceUrl ? (
                        <a href={i.sourceUrl} target="_blank" rel="noreferrer">
                          {i.attribution}
                        </a>
                      ) : (
                        i.attribution
                      )}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>

      {outputs.length ? (
        <section className="panel" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Basic Signals output</h2>
          <p className="muted">
            Personal Collection → Hold. Investment Vault → Review. Dealer Inventory → Churn
            only if a live range exists later. Headlines are not comps.
          </p>
          <div className="stack">
            {outputs.map((o) => (
              <article key={o.signalId}>
                <span className="badge badge-ok">{o.action}</span>{" "}
                <span className="badge badge-info">{o.bucketHint}</span>{" "}
                <strong>{o.title}</strong>
                <p style={{ marginBottom: 0 }}>{o.reason}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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
            {s.title ? <strong>{s.title}</strong> : null}
            <p style={{ marginBottom: 0 }}>{s.body}</p>
            {s.attribution ? (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                {s.sourceUrl ? (
                  <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                    {s.attribution}
                  </a>
                ) : (
                  s.attribution
                )}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
