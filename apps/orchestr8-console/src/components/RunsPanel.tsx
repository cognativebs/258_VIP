"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRun, fetchRuns } from "@/lib/orchestr8Api";

type RunRow = {
  run_id?: string;
  task?: string;
  question?: string;
  question_truncated?: boolean;
  created_at?: string;
  retrieved_at?: string;
  costUsd?: number;
  vetoed?: boolean;
  verification?: string;
};

type TraceStep = {
  role?: string;
  role_label?: string;
  provider_label?: string;
  model_label?: string;
  verdict?: string | null;
  error?: string | null;
  text?: string;
  costUsd?: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function verdictLabel(finalText: string, vetoed: boolean, criticVerdict?: string | null) {
  if (vetoed || /^\[VETO\]/i.test(finalText) || criticVerdict === "reject") return "VETOED";
  if (criticVerdict === "approve" || criticVerdict === "approved") return "APPROVED";
  if (finalText.trim()) return "DONE";
  return "UNKNOWN";
}

function firstParagraph(text: string, max = 900) {
  const cleaned = text.replace(/^\[VETO\][^\n]*\n*/i, "").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
}

export function RunsPanel() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRuns();
      setRows((data.runs || []) as RunRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setShowRaw(false);
    try {
      const data = await fetchRun(id);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    }
  };

  const summary = useMemo(() => {
    if (!detail) return null;
    const question = String(detail.question || "");
    const task = String(detail.task || "");
    const mode = String(detail.mode || "");
    const created = String(detail.created_at || "");
    const finalText = String(detail.final_text || "");
    const usage = asRecord(detail.usage) || {};
    const cost = typeof usage.costUsd === "number" ? usage.costUsd : null;
    const roles = Array.isArray(detail.roles) ? detail.roles.map(String) : [];
    const trace = (Array.isArray(detail.trace) ? detail.trace : []) as TraceStep[];
    const critic = trace.find((t) => t.role === "critic");
    const vetoed =
      Boolean(detail.vetoed) ||
      /^\[VETO\]/i.test(finalText) ||
      critic?.verdict === "reject";
    const status = verdictLabel(finalText, vetoed, critic?.verdict);

    return {
      runId: String(detail.run_id || ""),
      question,
      task,
      mode,
      created,
      cost,
      roles,
      trace,
      finalText,
      status,
      vetoed,
    };
  }, [detail]);

  return (
    <div className="panel">
      <h2>Runs</h2>
      <p className="sub">
        Council results from completed jobs. Click a row for a readable summary (raw JSON optional).
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {loading && <p className="dim">Loading…</p>}
      {!loading && rows.length === 0 && <p className="dim">No runs yet.</p>}
      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>when</th>
              <th>task</th>
              <th>question</th>
              <th>cost</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={String(r.run_id)}
                className={selectedId === r.run_id ? "selected" : ""}
                onClick={() => r.run_id && open(r.run_id)}
              >
                <td className="mono">{(r.created_at || "").replace("T", " ").slice(0, 19)}</td>
                <td>{r.task}</td>
                <td title={r.question}>{r.question}</td>
                <td>{typeof r.costUsd === "number" ? `$${r.costUsd.toFixed(4)}` : "—"}</td>
                <td className={r.vetoed ? "red" : ""}>{r.vetoed ? "VETOED" : "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {summary && (
        <div className="detail">
          <div className={`banner ${summary.vetoed ? "error" : "ok"}`}>
            <strong>{summary.status}</strong>
            {summary.cost != null ? ` · $${summary.cost.toFixed(4)}` : ""}
            {summary.created ? ` · ${summary.created.replace("T", " ").slice(0, 19)} UTC` : ""}
          </div>

          <h3 className="orange" style={{ marginTop: 14 }}>
            {summary.question || "(no question)"}
          </h3>
          <p className="dim">
            Task <span className="mono">{summary.task}</span> · {summary.mode} ·{" "}
            <span className="mono">{summary.runId}</span>
          </p>

          <h4 style={{ margin: "16px 0 8px", color: "var(--amber)" }}>What the council decided</h4>
          <div className="trace-body" style={{ whiteSpace: "pre-wrap" }}>
            {firstParagraph(summary.finalText) || "(no final text)"}
          </div>

          <h4 style={{ margin: "16px 0 8px", color: "var(--amber)" }}>Steps</h4>
          <ul className="steps">
            {summary.trace.map((s, i) => (
              <li
                key={`${s.role}-${i}`}
                className={s.verdict === "reject" || s.error ? "error" : "done"}
              >
                <span className="dot" />
                <div>
                  <div>
                    {s.role_label || s.role}
                    {s.model_label ? ` · ${s.model_label}` : ""}
                    {s.verdict ? ` · ${s.verdict}` : ""}
                    {typeof s.costUsd === "number" ? ` · $${s.costUsd.toFixed(4)}` : ""}
                  </div>
                  {s.text && (
                    <div className="trace-body">{s.text.replace(/\s+/g, " ").slice(0, 280)}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide raw JSON" : "Show raw JSON"}
            </button>
          </div>
          {showRaw && (
            <pre className="markdown">{JSON.stringify(detail, null, 2).slice(0, 12000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
