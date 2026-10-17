import { ThesisActions } from "@/components/signals/DeskActions";
import type { DeskThesis } from "@/lib/signalsDesk";

const VERDICT_CLASS: Record<string, string> = { holds: "badge-ok", weakened: "badge-warn", invalidated: "badge-danger" };

/** One thesis: action and what is withheld, the signals it rests on, Orchestr8's latest verdict, operator buttons. */
export function ThesisCard({ t }: { t: DeskThesis }) {
  return (
    <article className={`panel desk-thesis ${t.status}`}>
      <div className="desk-article-meta">
        <span className={`badge ${t.status === "active" ? "badge-ok" : t.status === "draft" ? "badge-warn" : ""}`}>{t.status}</span>
        <span className="badge badge-ok">{t.action}</span>
        {t.withheld.map((w) => (
          <span key={w.action} className="badge" title={w.reason}>
            {w.action} withheld
          </span>
        ))}
        <span className="badge">conf {t.confidence.toFixed(2)}</span>
        <span className="badge">{t.horizonDays}d · until {new Date(t.expiresAt).toLocaleDateString()}</span>
        {t.lastReview ? (
          <span className={`badge ${VERDICT_CLASS[t.lastReview.verdict] ?? ""}`} title={t.lastReview.reason}>
            Orchestr8: {t.lastReview.verdict}
          </span>
        ) : null}
      </div>
      <h3 className="desk-thesis-claim">{t.claim}</h3>
      <ul className="desk-reasons">
        {t.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
        {t.lastReview ? <li>Latest review: {t.lastReview.reason}</li> : null}
      </ul>
      {t.signals.length ? (
        <div className="desk-thesis-signals">
          <span className="muted">Rests on:</span>{" "}
          {t.signals.slice(0, 6).map((s, i) => (
            <span key={s.signalId}>
              {i ? " · " : ""}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </span>
          ))}
          {t.signals.length > 6 ? <span className="muted"> · +{t.signals.length - 6} more</span> : null}
        </div>
      ) : null}
      <div className="desk-thesis-foot">
        <span className="muted desk-article-source">
          {t.provenance.method} · {t.provenance.verification} · {t.provenance.ruleVersion}
          {t.statusNote ? ` · note: ${t.statusNote}` : ""}
        </span>
        <ThesisActions id={t.id} status={t.status} />
      </div>
    </article>
  );
}
