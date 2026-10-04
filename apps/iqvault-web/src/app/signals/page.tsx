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

type DailyList = {
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
    subject: string | null;
    sourceUrl: string | null;
    attribution: string;
    direction: string;
    influence: number;
    baseConfidence: number;
    method: string;
    framing: "sell_window" | "exit_watch" | null;
    backfilled: boolean;
  }[];
};

const DAILY_LISTS = [
  { name: "daily-sports", title: "Daily Sports SIGNAL" },
  { name: "daily-collectibles", title: "Daily Collectibles SIGNAL" },
  { name: "daily-headlines", title: "Daily Headlines SIGNAL (US · World)" },
  { name: "daily-markets", title: "Daily Markets & Business SIGNAL" },
] as const;

const FRAMING_LABEL = { sell_window: "Sell window", exit_watch: "Exit · watch" } as const;

type Synthesized = {
  signals: {
    signalId: string;
    title: string;
    themeName: string;
    band: "noise" | "watch" | "emerging" | "strong" | "high_conviction";
    priority: number;
    influence: number;
    independentSourceCount: number;
    method: string;
    direction: string;
    evidence: { title: string | null; outlet: string; url: string | null; at: string | null; timeSource: string | null }[];
  }[];
};

const BAND_LABEL = { noise: "Noise", watch: "Watch", emerging: "Emerging", strong: "Strong", high_conviction: "High Conviction" } as const;

function PokemonSignals({ data, error }: { data: Synthesized | null; error: string | null }) {
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Pokémon SIGNALS</h2>
      <p className="muted">
        Synthesized from official PokéBeach news and other outlets. Bands come from read-time priority; High Conviction needs
        two independent sources. Inferred · unverified. A signal proposes; it never sets a price or a buy.
      </p>
      {error ? <div className="error">{error}</div> : null}
      {data && data.signals.length === 0 ? <p className="muted">Nothing above Noise right now.</p> : null}
      <div className="stack">
        {(data?.signals ?? []).map((s) => (
          <article key={s.signalId}>
            <span className={`badge ${s.band === "strong" || s.band === "high_conviction" ? "badge-ok" : "badge-info"}`}>{BAND_LABEL[s.band]}</span>{" "}
            <span className="badge badge-info">{s.themeName}</span>{" "}
            {s.method === "opinion" ? <span className="badge badge-warn">opinion</span> : null} <strong>{s.title}</strong>
            <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              {s.independentSourceCount} independent source{s.independentSourceCount === 1 ? "" : "s"} · priority {s.priority.toFixed(3)} ·
              influence {s.influence.toFixed(3)} · {s.direction}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {s.evidence.map((e, i) => (
                <li key={`${s.signalId}-${i}`}>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.title ?? e.url}
                    </a>
                  ) : (
                    (e.title ?? "(article)")
                  )}{" "}
                  <span className="muted">
                    · {e.outlet}
                    {e.at ? ` · ${e.at.slice(0, 16).replace("T", " ")} UTC` : ""}
                    {e.timeSource?.includes("inferred") ? " (time inferred)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function DailySection({ title, list, error }: { title: string; list: DailyList | null; error: string | null }) {
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {error ? <div className="error">{error}</div> : null}
      {list ? (
        <>
          <p className="muted">
            Last {list.profile.windowHours}h · {list.profile.slots} slots ·{" "}
            {list.groups.map((g) => `${g.label} ${Math.round(g.share * 100)}% (${g.filled + g.backfilled}/${g.allocated})`).join(" · ")}
            {list.unfilled ? ` · ${list.unfilled} slots unfilled` : ""} · profile {list.profile.name}@{list.profile.version}
            {list.profile.verified ? "" : " · unverified"}. Ranked by decayed priority; shares decide slots only.
          </p>
          {list.items.length === 0 ? (
            <p className="muted">No signals first seen in this window.</p>
          ) : (
            <div className="stack">
              {list.items.map((i) => (
                <article key={i.signalId}>
                  <span className="badge badge-info">{i.group}</span>{" "}
                  <span className="badge badge-info">{i.signalTypeName}</span>{" "}
                  {i.framing ? (
                    <span className={`badge ${i.framing === "sell_window" ? "badge-ok" : "badge-warn"}`}>
                      {FRAMING_LABEL[i.framing]}
                    </span>
                  ) : null}{" "}
                  {i.method === "opinion" ? <span className="badge badge-warn">opinion</span> : null}{" "}
                  {i.backfilled ? <span className="badge badge-warn">backfill</span> : null}{" "}
                  <strong>{i.title}</strong>
                  <p style={{ marginBottom: 0 }}>{i.summary}</p>
                  <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                    {i.subject ? `${i.subject} · ` : ""}
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
  );
}

export default async function SignalsPage() {
  let error: string | null = null;
  let signals: Signal[] = [];
  let outputs: SignalOutput[] = [];
  let source: string | null = null;
  let feedKind: "job_feed" | "seed" | "unknown" = "unknown";
  let synthesized: Synthesized | null = null;
  let synthesizedError: string | null = null;
  try {
    synthesized = await apiGet<Synthesized>("/api/signals/synthesized");
  } catch (e) {
    synthesizedError = e instanceof Error ? e.message : "Failed to load Pokémon signals";
  }
  const dailies = await Promise.all(
    DAILY_LISTS.map(async ({ name, title }) => {
      try {
        return { title, list: await apiGet<DailyList>(`/api/signals/daily/${name}`), error: null };
      } catch (e) {
        return { title, list: null, error: e instanceof Error ? e.message : `Failed to load ${title}` };
      }
    }),
  );
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

      <PokemonSignals data={synthesized} error={synthesizedError} />

      {dailies.map((d) => (
        <DailySection key={d.title} title={d.title} list={d.list} error={d.error} />
      ))}

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
