"use client";

import { useState } from "react";
import { formatSourceStats, setSourceActive, type SourceRow } from "@/lib/sourcesApi";

/**
 * Toggle + contribution stats for the job feed SourceRegistry (backlog D).
 * A toggle writes sources-state.json through PATCH /api/sources/:id; the jobs
 * read it on their next run. It does not enable or disable a news source.
 */
export function SourcesEditor({ initial }: { initial: SourceRow[] }) {
  const [sources, setSources] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function toggle(row: SourceRow) {
    const next = !row.active;
    setPending(row.id);
    setError(null);
    setStatus(null);
    try {
      const updated = await setSourceActive(row.id, next);
      setSources((list) => list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      setStatus(
        `${updated.label} is ${updated.active ? "on" : "off"} in the job feed registry. Jobs pick this up on their next run.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the source");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      {status ? <p className="muted">{status}</p> : null}
      <div className="stack">
        {sources.map((s) => {
          const stats = formatSourceStats(s.stats);
          return (
            <article key={s.id} className="panel">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "baseline",
                }}
              >
                <h3 style={{ margin: 0 }}>{s.label}</h3>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={s.active}
                    checked={s.active}
                    disabled={pending !== null}
                    onChange={() => void toggle(s)}
                  />
                  <span className={s.active ? "badge badge-ok" : "badge badge-warn"}>
                    {pending === s.id ? "saving…" : s.active ? "on" : "off"}
                  </span>
                </label>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {s.id} · {s.authority} · {s.accessMethod} · {s.categoryCoverage.join(", ")}
                {s.persistedAt ? ` · changed ${new Date(s.persistedAt).toLocaleString()}` : " · registry default"}
              </p>
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                  margin: "8px 0",
                }}
              >
                <div>
                  <dt className="muted">Signals</dt>
                  <dd style={{ margin: 0 }}>{stats.signals}</dd>
                </div>
                <div>
                  <dt className="muted">Quarantine rate</dt>
                  <dd style={{ margin: 0 }}>{stats.quarantine}</dd>
                </div>
                <div>
                  <dt className="muted">Evidence (active)</dt>
                  <dd style={{ margin: 0 }}>{stats.evidence}</dd>
                </div>
              </dl>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Stats: {stats.method}
              </p>
              <p style={{ marginBottom: 0, fontSize: 13 }}>{s.terms}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
