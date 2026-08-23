"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_PROMPTS,
  applySlice,
  buildAnalysisContext,
  contextToJson,
  type SliceId,
} from "@/lib/analysisContext";
import { loadInventory, type InventoryBundle } from "@/lib/inventoryApi";
import { analysisEffective, useCouncilSession } from "@/lib/councilSession";
import { CreditPauseAlert } from "@/components/CreditPauseAlert";

const SLICES: { id: SliceId; label: string }[] = [
  { id: "all", label: "All loaded" },
  { id: "sellHigh", label: "Sell priority High" },
  { id: "highLiquidity", label: "Liquidity ≥ 60" },
  { id: "museum", label: "Museum candidates" },
  { id: "lot", label: "Sell / Lot labels" },
];

export function AnalysisPanel() {
  const { team, runJob, sessions, liveKind } = useCouncilSession();
  const session = sessions.analysis;
  const [bundle, setBundle] = useState<InventoryBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slice, setSlice] = useState<SliceId>("sellHigh");
  const [question, setQuestion] = useState(ANALYSIS_PROMPTS[0]);
  const [showContext, setShowContext] = useState(false);

  const loading = session.loading;
  const busy = Boolean(liveKind);

  const refresh = async () => {
    setLoadError(null);
    try {
      const inv = await loadInventory();
      setBundle(inv);
      if (inv.source === "none") {
        setLoadError(inv.meta.note || "No inventory available");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Inventory load failed");
      setBundle(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filteredCount = useMemo(() => {
    if (!bundle) return 0;
    return applySlice(bundle.rows, slice).length;
  }, [bundle, slice]);

  const contextJson = useMemo(() => {
    if (!bundle || bundle.source === "none") return "{}";
    return contextToJson(buildAnalysisContext(bundle, slice));
  }, [bundle, slice]);

  const run = async () => {
    const q = question.trim();
    if (!q || busy || !bundle || bundle.source === "none") return;
    const roster = analysisEffective(team);
    try {
      await runJob({
        kind: "analysis",
        task: "comics_collection_analysis",
        question: q,
        roles: roster.roles,
        mode: roster.roles.length === 1 ? "single" : roster.mode,
        council: roster.councilId,
        contextJson,
      });
    } catch {
      /* session.error */
    }
  };

  const cost = session.result?.usage?.costUsd;
  const sourceLabel =
    bundle?.source === "comics"
      ? "Comics API :5200"
      : bundle?.source === "vip"
        ? "VIP sample :8787"
        : "none";

  return (
    <div className="panel">
      <h2>Collection Analysis</h2>
      <p className="sub">
        Inventory → compact context → <code>comics_collection_analysis</code>. Progress stays in the
        dock if you switch tabs.
      </p>

      <div className="meta-row">
        <span className="pill">
          source <strong>{sourceLabel}</strong>
        </span>
        <span className="pill">
          vault <strong>{bundle?.meta.recordCount ?? "—"}</strong>
        </span>
        <span className="pill">
          slice <strong>{filteredCount}</strong>
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
          Reload inventory
        </button>
      </div>

      {bundle?.meta.note && <p className="sub">{bundle.meta.note}</p>}
      {loadError && <div className="banner warn">{loadError}</div>}

      <label className="field">
        <span>Slice</span>
        <select
          value={slice}
          onChange={(e) => setSlice(e.target.value as SliceId)}
          disabled={loading || !bundle || bundle.source === "none"}
        >
          {SLICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Question</span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask for sell / hold / grade / lot decisions…"
          disabled={loading}
        />
      </label>

      <div className="chip-row">
        {ANALYSIS_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            className="chip"
            disabled={loading}
            onClick={() => setQuestion(p)}
          >
            {p.length > 56 ? `${p.slice(0, 56)}…` : p}
          </button>
        ))}
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !question.trim() || !bundle || bundle.source === "none"}
          onClick={() => void run()}
        >
          {loading ? "Running analysis…" : "Run Collection Analysis"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!bundle || bundle.source === "none"}
          onClick={() => setShowContext((v) => !v)}
        >
          {showContext ? "Hide context" : "Preview context JSON"}
        </button>
        {busy && liveKind !== "analysis" && (
          <span className="dim">Another council is running ({liveKind}).</span>
        )}
      </div>

      {showContext && (
        <pre className="trace-body context-preview">{contextJson.slice(0, 8000)}</pre>
      )}

      {session.error && <div className="banner error">{session.error}</div>}

      {session.result?.paused && session.result.pause && (
        <CreditPauseAlert
          pause={session.result.pause}
          runId={session.result.runId}
          resuming={loading}
          onResume={() => {
            const pausedId = session.result?.runId;
            if (!pausedId || busy) return;
            void runJob({
              kind: "analysis",
              task: "comics_collection_analysis",
              question: session.question || question,
              roles: session.roles,
              mode: session.mode,
              council: session.council,
              resumeFromRunId: pausedId,
            });
          }}
        />
      )}

      {loading && (
        <p className="dim">Council running — see Progress dock below (safe to open other tabs).</p>
      )}

      {session.result && !session.result.paused && (
        <div className={`banner ${session.result.vote?.vetoed ? "error" : "ok"}`}>
          <div>
            <strong>{session.result.vote?.vetoed ? "VETOED" : "done"}</strong>
            {session.result.runId ? ` · ${session.result.runId}` : ""}
            {typeof cost === "number" ? ` · $${cost.toFixed(4)}` : ""}
            {session.result.council ? ` · council ${session.result.council}` : ""}
          </div>
          {session.result.vote?.summary && (
            <div style={{ marginTop: 6 }}>{session.result.vote.summary}</div>
          )}
          {session.result.text && (
            <div className="trace-body" style={{ marginTop: 10 }}>
              {session.result.text.slice(0, 4000)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
