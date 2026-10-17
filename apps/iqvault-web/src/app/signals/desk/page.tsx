import Link from "next/link";
import { Nav } from "@/components/Nav";
import { DeskArticles } from "@/components/signals/DeskArticles";
import { MeasureButtons } from "@/components/signals/DeskActions";
import { ThesisCard } from "@/components/signals/ThesisCard";
import { apiGet, ORCHESTR8_CONSOLE_URL } from "@/lib/api";
import { ago, type DeskArticle, type DeskBrief, type DeskHealth, type DeskPredictions, type DeskThesis } from "@/lib/signalsDesk";

export const dynamic = "force-dynamic";

async function load<T>(path: string, timeoutMs?: number): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await apiGet<T>(path, timeoutMs), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : `failed to load ${path}` };
  }
}

const STATE_CLASS: Record<string, string> = { ok: "badge-ok", stale: "badge-warn", failing: "badge-danger", blocked: "badge-danger", off: "" };

function BriefCard({ b, latest }: { b: DeskBrief; latest: boolean }) {
  return (
    <article className={latest ? "panel desk-brief latest" : "panel desk-brief"}>
      <div className="desk-article-meta">
        <span className="badge badge-info">Orchestr8 brief</span>
        {b.vetoed ? <span className="badge badge-danger">vetoed by Critic</span> : null}
        {!b.parsed ? <span className="badge badge-warn">no structured summary</span> : null}
        <span className="muted desk-time" title={b.createdAt}>
          {new Date(b.createdAt).toLocaleString()} · {ago(b.createdAt)}
        </span>
      </div>
      <h3 className="desk-brief-headline">{b.headline ?? "Brief"}</h3>
      {b.summary ? <p className="desk-brief-summary">{b.summary}</p> : null}
      {b.sections.length ? (
        <div className="desk-brief-sections">
          {b.sections.map((s) => (
            <div key={s.group}>
              <div className="desk-section-label">{s.group}</div>
              <ul>
                {s.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      <div className="muted desk-article-source">
        {b.thesesProposed} thesis proposal(s) · {b.verdicts.length} verdict(s) on open theses · {b.models.join(", ") || "default models"} · ${b.costUsd.toFixed(4)} ·{" "}
        <a href={`/api/orchestr8/v1/runs/${encodeURIComponent(b.runId)}`} target="_blank" rel="noreferrer">
          run {b.runId}
        </a>
      </div>
    </article>
  );
}

export default async function SignalDeskPage() {
  const [briefs, theses, articles, health, predictions] = await Promise.all([
    load<{ running: boolean; briefs: DeskBrief[]; error?: string }>("/api/signals/briefs?limit=7", 30_000),
    load<{ theses: DeskThesis[] }>("/api/theses"),
    load<{ hours: number; articles: DeskArticle[] }>("/api/signals/articles?hours=72&limit=300", 20_000),
    load<DeskHealth>("/api/signals/health"),
    load<DeskPredictions>("/api/signals/predictions"),
  ]);
  const briefList = briefs.data?.briefs ?? [];
  const open = (theses.data?.theses ?? []).filter((t) => t.status === "draft" || t.status === "active");
  const closed = (theses.data?.theses ?? []).filter((t) => t.status === "retired" || t.status === "invalidated");
  const h = health.data;
  const trouble = (h?.sources ?? []).filter((s) => s.enabled && s.state !== "ok");

  return (
    <div className="shell">
      <Nav active="/signals/desk" />
      <h1 className="page-title">Signal Desk</h1>
      <p className="page-sub">
        Today&apos;s Orchestr8 brief, the theses it proposed, and every signal article from the last 72 hours. Inferred · unverified unless
        marked. News is never a price; Buy, Sell and Grade wait for market data. <Link href="/signals">Daily lists →</Link>
      </p>

      <section className="desk-health">
        {h ? (
          <>
            <span className={`badge ${h.summary.failing ? "badge-danger" : h.summary.stale ? "badge-warn" : "badge-ok"}`}>
              Feeds {h.summary.ok}/{h.summary.enabled} OK
            </span>
            <span className="badge">Last ingest {ago(h.summary.lastIngestAt)}</span>
            <span className="badge">Last brief {ago(briefList[0]?.createdAt ?? null)}</span>
            {briefs.data?.running ? <span className="badge badge-info">brief running…</span> : null}
            {trouble.map((s) => (
              <span key={s.sourceKey} className={`badge ${STATE_CLASS[s.state]}`} title={s.blockedReason ?? `last success ${ago(s.lastSuccessAt)}`}>
                {s.sourceKey}: {s.state}
                {s.failingStatus ? ` (${s.failingStatus})` : ""}
              </span>
            ))}
          </>
        ) : (
          <span className="badge badge-danger">Health unavailable: {health.error}</span>
        )}
      </section>

      <div className="desk-grid">
        <div className="desk-col">
          <h2 className="section-title">Orchestr8 briefs</h2>
          {briefs.data?.error || briefs.error ? <div className="error">{briefs.data?.error ?? briefs.error}</div> : null}
          {briefList.length === 0 && !briefs.error ? (
            <p className="muted">
              No brief yet. The jobs scheduler runs one each morning (after 7:00) when there are new signals; or run{" "}
              <code>npm run signals-brief -w @vip/jobs -- --force</code>.
            </p>
          ) : null}
          {briefList[0] ? <BriefCard b={briefList[0]} latest /> : null}
          {briefList.length > 1 ? (
            <details className="desk-older">
              <summary>Earlier briefs ({briefList.length - 1})</summary>
              <div className="stack">
                {briefList.slice(1).map((b) => (
                  <BriefCard key={b.runId} b={b} latest={false} />
                ))}
              </div>
            </details>
          ) : null}

          <h2 className="section-title">Theses</h2>
          {theses.error ? <div className="error">{theses.error}</div> : null}
          {open.length === 0 && !theses.error ? <p className="muted">No open theses. Orchestr8 drafts them from the daily brief.</p> : null}
          <div className="stack">
            {open.map((t) => (
              <ThesisCard key={t.id} t={t} />
            ))}
          </div>
          {closed.length ? (
            <details className="desk-older">
              <summary>Retired and invalidated ({closed.length})</summary>
              <div className="stack">
                {closed.map((t) => (
                  <ThesisCard key={t.id} t={t} />
                ))}
              </div>
            </details>
          ) : null}

          <h2 className="section-title">Calls to score</h2>
          {predictions.error ? <div className="error">{predictions.error}</div> : null}
          {predictions.data ? (
            <div className="panel">
              <p style={{ marginTop: 0 }}>
                <span className="badge badge-info">
                  Brier {predictions.data.calibration.brier ?? "—"} (coin flip {predictions.data.calibration.coinFlipBrier})
                </span>
                <span className="badge">
                  {predictions.data.calibration.hits}/{predictions.data.calibration.resolved} held
                </span>
                <span className="badge">{predictions.data.calibration.pending} pending</span>
                <span className="muted"> {predictions.data.calibration.note}</span>
              </p>
              {predictions.data.due.length === 0 ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Nothing due. Each thesis is scored at +7, +30, +90, +180 and +365 days.
                </p>
              ) : (
                <ul className="desk-due">
                  {predictions.data.due.slice(0, 20).map((d) => (
                    <li key={d.measurementId}>
                      <span>{d.claim}</span>{" "}
                      <span className="muted">
                        (said {Math.round(d.confidence * 100)}%, due {new Date(d.dueAt).toLocaleDateString()})
                      </span>{" "}
                      <MeasureButtons measurementId={d.measurementId} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="desk-col">
          <h2 className="section-title">Articles · last {articles.data?.hours ?? 72}h</h2>
          {articles.error ? <div className="error">{articles.error}</div> : null}
          {articles.data ? <DeskArticles articles={articles.data.articles} /> : null}
        </div>
      </div>

      <details className="desk-older" style={{ marginTop: 24 }}>
        <summary>Feed health ({h?.sources.filter((s) => s.enabled).length ?? 0} enabled sources)</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>State</th>
                <th>Last success</th>
                <th>Last signal</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(h?.sources ?? []).map((s) => (
                <tr key={s.sourceKey}>
                  <td>
                    {s.name}
                    <div className="muted desk-article-source">{s.sourceKey}</div>
                  </td>
                  <td>
                    <span className={`badge ${STATE_CLASS[s.state]}`}>{s.state}</span>
                  </td>
                  <td>{ago(s.lastSuccessAt)}</td>
                  <td>{ago(s.lastSignalAt)}</td>
                  <td className="muted">
                    {s.blockedReason ??
                      (s.consecutiveFailures ? `${s.consecutiveFailures} failure(s)${s.failingStatus ? `, HTTP ${s.failingStatus}` : ""}${s.nextAttemptAt ? `; retry at ${new Date(s.nextAttemptAt).toLocaleString()}` : ""}` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="muted" style={{ fontSize: 12 }}>
        Briefs are Orchestr8 runs (task signals_brief) kept in its immutable run store. Open the{" "}
        <a href={ORCHESTR8_CONSOLE_URL} target="_blank" rel="noreferrer">
          Orchestr8 console
        </a>{" "}
        to read a run step by step.
      </p>
    </div>
  );
}
