"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSpec, fetchSpecs } from "@/lib/orchestr8Api";

type SpecRow = {
  id: string;
  title: string;
  verification_status?: string;
  council?: string | null;
  run_id?: string | null;
  path?: string;
  md_path?: string;
};

export function SpecsPanel() {
  const [rows, setRows] = useState<SpecRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState<string>("");
  const [cursorPrompt, setCursorPrompt] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSpecs();
      setRows(data.specs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load specs");
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
    setMarkdown(null);
    setJsonText("");
    setCursorPrompt("");
    try {
      const data = await fetchSpec(id);
      setMarkdown(data.markdown || JSON.stringify(data.spec, null, 2));
      setJsonText(data.spec ? JSON.stringify(data.spec, null, 2) : "");
      setCursorPrompt(typeof data.spec?.cursor_prompt === "string" ? data.spec.cursor_prompt : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spec");
    }
  };

  return (
    <div className="panel">
      <h2>Specs</h2>
      <p className="sub">Build specs under docs/specs/ via GET /v1/specs (read-only).</p>
      <div className="actions">
        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {loading && <p className="dim">Loading…</p>}
      {!loading && rows.length === 0 && <p className="dim">No specs found.</p>}
      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>id</th>
              <th>title</th>
              <th>verification</th>
              <th>run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={selectedId === r.id ? "selected" : ""}
                onClick={() => open(r.id)}
              >
                <td>{r.id}</td>
                <td>{r.title}</td>
                <td>{r.verification_status || "—"}</td>
                <td className="dim">{r.run_id || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {markdown && (
        <div className="detail">
          <h3 className="orange mono">{selectedId}</h3>
          <div className="council-chat-actions" style={{ margin: "8px 0" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void navigator.clipboard.writeText(markdown);
                setCopied("md");
              }}
            >
              Copy .md
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!jsonText}
              onClick={() => {
                void navigator.clipboard.writeText(jsonText);
                setCopied("json");
              }}
            >
              Copy JSON
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!cursorPrompt}
              onClick={() => {
                void navigator.clipboard.writeText(cursorPrompt);
                setCopied("prompt");
              }}
            >
              Copy Cursor prompt
            </button>
            {copied ? <span className="dim">Copied {copied}</span> : null}
          </div>
          <div className="markdown">{markdown}</div>
        </div>
      )}
    </div>
  );
}
