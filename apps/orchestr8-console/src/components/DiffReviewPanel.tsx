"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDiffReviews, fetchSpecs, runDiffReview, type DiffReview } from "@/lib/orchestr8Api";

/**
 * O2 (ADR 0003): paste the diff Cursor produced for a build spec; a rule precheck checks the
 * spec's file plan and tests, then the Challenge Council (critic · tester · domain expert)
 * judges it against the acceptance tests. Orchestr8 never writes or runs the code.
 */
export function DiffReviewPanel() {
  const [specs, setSpecs] = useState<{ id: string; title: string }[]>([]);
  const [specId, setSpecId] = useState("");
  const [diffText, setDiffText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<DiffReview | null>(null);
  const [savedPath, setSavedPath] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchDiffReviews>>["reviews"]>([]);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetchSpecs(), fetchDiffReviews()]);
      setSpecs(s.specs.map((x) => ({ id: x.id, title: x.title })));
      setHistory(h.reviews);
      setSpecId((cur) => cur || s.specs[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load specs");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      const r = await runDiffReview({ specId, diffText, offline });
      setReview(r.review);
      setSavedPath(r.path);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diff review failed");
    } finally {
      setBusy(false);
    }
  };

  const verdictClass = review ? (review.verdict === "approve" ? "ok" : review.verdict === "reject" ? "bad" : "") : "";

  return (
    <div className="panel">
      <h2>Diff Review</h2>
      <p className="sub">
        Paste the diff Cursor produced for a build spec (for example <span className="mono">git diff main...HEAD</span>). The precheck checks the
        spec&apos;s planned files and tests; the Challenge Council scores it against the acceptance tests. Reviews are saved under docs/specs/reviews/.
      </p>
      <label className="field">
        <span>Build spec</span>
        <select value={specId} onChange={(e) => setSpecId(e.target.value)}>
          {specs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} — {s.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Diff</span>
        <textarea value={diffText} onChange={(e) => setDiffText(e.target.value)} placeholder="diff --git a/... b/..." style={{ minHeight: 220 }} />
      </label>
      <div className="actions">
        <label className="dim" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Precheck only (no model call, no cost)
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !specId || !diffText.trim()} onClick={run}>
          {busy ? (offline ? "Checking…" : "Council reviewing… (can take a few minutes)") : offline ? "Run precheck" : "Review with Challenge Council"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}

      {review && (
        <div className="detail">
          <h3 className="mono">
            <span className={`pill ${verdictClass}`}>{review.verdict.toUpperCase()}</span> {review.spec_id}
          </h3>
          <p className="dim">
            {review.provenance.method} · confidence {review.provenance.confidence} · {review.provenance.verification} · {review.id}
            {savedPath ? ` · saved ${savedPath}` : ""}
          </p>
          {review.council ? (
            <p>
              Council{review.council.vetoed ? " (veto)" : ""}: {review.council.verdict} — {review.council.summary}
            </p>
          ) : null}
          <table className="table">
            <thead>
              <tr>
                <th>severity</th>
                <th>source</th>
                <th>criterion</th>
                <th>finding</th>
              </tr>
            </thead>
            <tbody>
              {review.findings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dim">
                    No findings.
                  </td>
                </tr>
              ) : (
                review.findings.map((f, i) => (
                  <tr key={i}>
                    <td className={f.severity === "critical" ? "orange" : ""}>{f.severity}</td>
                    <td className="dim">{f.source}</td>
                    <td>{f.criterion}</td>
                    <td>{f.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="dim">
            {review.precheck.diff_stats.files.length} file(s), +{review.precheck.diff_stats.additions} / -{review.precheck.diff_stats.deletions}
            {review.precheck.diff_stats.truncated ? " · truncated for the council" : ""} · missing planned paths:{" "}
            {review.precheck.missing_paths.join(", ") || "none"} · tests: {review.precheck.test_paths.join(", ") || "none"}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Earlier reviews</h3>
          <table className="table">
            <thead>
              <tr>
                <th>when</th>
                <th>spec</th>
                <th>verdict</th>
                <th>findings</th>
                <th>method</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="dim">{new Date(h.created_at).toLocaleString()}</td>
                  <td>{h.spec_id}</td>
                  <td>{h.verdict}</td>
                  <td>{h.findings}</td>
                  <td className="dim">{h.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
