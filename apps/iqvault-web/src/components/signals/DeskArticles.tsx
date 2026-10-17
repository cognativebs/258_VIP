"use client";

import { useMemo, useState } from "react";
import { ago, GROUPS, RADAR_SOURCE, type DeskArticle } from "@/lib/signalsDesk";

const BAND_LABEL: Record<string, string> = {
  noise: "Noise",
  watch: "Watch",
  emerging: "Emerging",
  strong: "Strong",
  high_conviction: "High Conviction",
};

/** The article feed: every signal in the window, newest first, filterable by group and text. */
export function DeskArticles({ articles }: { articles: DeskArticle[] }) {
  const [group, setGroup] = useState<string>("All");
  const [q, setQ] = useState("");
  const [hideNoise, setHideNoise] = useState(true);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) m.set(a.group, (m.get(a.group) ?? 0) + 1);
    return m;
  }, [articles]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return articles.filter(
      (a) =>
        (group === "All" || a.group === group || (group === "Radar" && a.sourceKey === RADAR_SOURCE)) &&
        (!hideNoise || a.band !== "noise") &&
        (!needle || `${a.title} ${a.summary} ${a.attribution} ${a.typeName}`.toLowerCase().includes(needle)),
    );
  }, [articles, group, q, hideNoise]);

  return (
    <div>
      <div className="desk-filters">
        {["All", ...GROUPS, "Radar"].map((g) => (
          <button key={g} type="button" className={group === g ? "desk-chip on" : "desk-chip"} onClick={() => setGroup(g)}>
            {g}{" "}
            <span className="muted">
              {g === "All" ? articles.length : g === "Radar" ? articles.filter((a) => a.sourceKey === RADAR_SOURCE).length : (counts.get(g) ?? 0)}
            </span>
          </button>
        ))}
        <input className="desk-search" placeholder="Search titles, sources…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search articles" />
        <label className="muted desk-toggle">
          <input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} /> hide Pokémon noise
        </label>
      </div>
      {shown.length === 0 ? <p className="muted">No articles match.</p> : null}
      <ul className="desk-articles">
        {shown.map((a) => (
          <li key={a.signalId} className="desk-article">
            <div className="desk-article-meta">
              <span className="badge badge-info">{a.group}</span>
              <span className="badge">{a.typeName}</span>
              {a.band ? <span className={`badge ${a.band === "strong" || a.band === "high_conviction" ? "badge-ok" : ""}`}>{BAND_LABEL[a.band] ?? a.band}</span> : null}
              {a.proposal ? <span className="badge badge-ok">Proposed: {a.proposal}</span> : null}
              {a.reporting ? (
                <span className={`badge ${a.reporting === "corroborated" ? "badge-ok" : ""}`} title="Two or more independent outlets = corroborated; PokéBeach alone = specialist primary reporting">
                  {a.reporting === "specialist_primary" ? "specialist primary" : a.reporting.replace("_", " ")}
                </span>
              ) : null}
              {a.direction === "up" || a.direction === "down" ? <span className="badge">{a.direction === "up" ? "↑ up" : "↓ down"}</span> : null}
              {a.method === "opinion" ? <span className="badge badge-warn">opinion</span> : null}
              {a.thesisCount ? <span className="badge badge-warn">in {a.thesisCount} thesis</span> : null}
              {a.sourceKey === RADAR_SOURCE ? <span className="badge badge-info">radar</span> : null}
              <span className="muted desk-time" title={a.firstSeenAt}>
                {ago(a.firstSeenAt)}
              </span>
            </div>
            <div className="desk-article-title">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer">
                  {a.title}
                </a>
              ) : (
                a.title
              )}
            </div>
            {a.summary && a.summary !== a.title ? <p className="desk-article-summary">{a.summary}</p> : null}
            <div className="muted desk-article-source">
              {a.attribution} · {a.independentSources} independent source{a.independentSources === 1 ? "" : "s"} · confidence {a.confidence.toFixed(2)} · {a.verification}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
