"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ANALYSIS_COMPS_CAP,
  ANALYSIS_PROMPTS,
  applySlice,
  buildAnalysisContext,
  contextToJson,
  highlightIdsForComps,
  liquidationGateFromMarket,
  MIN_SALES_FOR_MARKET_EVIDENCE,
  type SliceId,
} from "@/lib/analysisContext";
import { loadInventory, type InventoryBundle } from "@/lib/inventoryApi";
import { loadMarketEvidence } from "@/lib/marketEvidence";
import type { MarketEvidenceBundle } from "@/types/analysis";
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
  const [market, setMarket] = useState<MarketEvidenceBundle | null>(null);
  const [marketStatus, setMarketStatus] = useState<"idle" | "loading" | "ready">("idle");

  const loading = session.loading;
  const busy = Boolean(liveKind);
  const compsPending = marketStatus === "loading";

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

  useEffect(() => {
    if (!bundle || bundle.source === "none") {
      setMarket(null);
      setMarketStatus("idle");
      return;
    }
    const ac = new AbortController();
    const ids = highlightIdsForComps(bundle, slice);
    setMarketStatus("loading");
    void loadMarketEvidence(ids, fetch, ac.signal).then((next) => {
      if (ac.signal.aborted) return;
      setMarket(next);
      setMarketStatus("ready");
    });
    return () => ac.abort();
  }, [bundle, slice]);

  const filteredCount = useMemo(() => {
    if (!bundle) return 0;
    return applySlice(bundle.rows, slice).length;
  }, [bundle, slice]);

  const contextJson = useMemo(() => {
    if (!bundle || bundle.source === "none") return "{}";
    return contextToJson(buildAnalysisContext(bundle, slice, market));
  }, [bundle, slice, market]);

  const gate = useMemo(() => liquidationGateFromMarket(market), [market]);

  const run = async () => {
    const q = question.trim();
    if (!q || busy || compsPending || !bundle || bundle.source === "none") return;
    const roster = analysisEffective(team);
    const ids = highlightIdsForComps(bundle, slice);
    setMarketStatus("loading");
    const fresh = await loadMarketEvidence(ids);
    setMarket(fresh);
    setMarketStatus("ready");
    const task =
      roster.councilId === "challenge" ? "collection_challenge" : "comics_collection_analysis";
    try {
      await runJob({
        kind: "analysis",
        task,
        question: q,
        roles: roster.roles,
        mode: roster.roles.length === 1 ? "single" : roster.mode,
        council: roster.councilId,
        contextJson: contextToJson(buildAnalysisContext(bundle, slice, fresh)),
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
        ? "VIP API :8787"
        : "none";
  const compsLabel =
    marketStatus === "loading"
      ? "loading…"
      : market
        ? `${market.holdingsWithSales}/${market.attemptedIds.length || ANALYSIS_COMPS_CAP} with sales`
        : "—";

  const fetchedLabel = bundle?.fetchedAt
    ? bundle.fetchedAt.replace("T", " ").slice(0, 19) + " UTC"
    : "—";

  return (
    <div className="panel">
      <h2>Collection Analysis</h2>
      <p className="sub">
        Inventory → live adapter comps (cap {ANALYSIS_COMPS_CAP}) → Analysis or Challenge.
        Run re-fetches adapters. Liquidation stays blocked until matchedSales ≥{" "}
        {MIN_SALES_FOR_MARKET_EVIDENCE}. Progress stays in the dock if you switch tabs.
      </p>

      <div className="meta-row">
        <span className="pill">
          source <strong>{sourceLabel}</strong>
        </span>
        <span className="pill">
          snapshot rows <strong>{bundle?.meta.recordCount ?? "—"}</strong>
        </span>
        <span className="pill">
          slice <strong>{filteredCount}</strong>
        </span>
        <span className="pill">
          provenance <strong>{bundle?.provenance.verificationStatus ?? "—"}</strong>
        </span>
        <span className="pill">
          comps <strong>{compsLabel}</strong>
        </span>
        <span className="pill">
          eBay <strong>{market?.ebayAuth.configured ? market.ebayAuth.mode : "idle"}</strong>
        </span>
        <span className="pill">
          liquidation <strong>{gate.action}</strong>
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
          Reload inventory
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={compsPending || !bundle || bundle.source === "none"}
          onClick={() => {
            if (!bundle || bundle.source === "none") return;
            const acIds = highlightIdsForComps(bundle, slice);
            setMarketStatus("loading");
            void loadMarketEvidence(acIds).then((next) => {
              setMarket(next);
              setMarketStatus("ready");
            });
          }}
        >
          Re-run comps
        </button>
      </div>

      {bundle && (
        <p className="sub">
          Fetched {fetchedLabel}. {bundle.meta.snapshotTotal.note}. Count is this snapshot&apos;s row
          total, not a live market value.
        </p>
      )}

      {bundle?.meta.note && <p className="sub">{bundle.meta.note}</p>}
      {market?.adapterIdleNotes.length ? (
        <p className="sub">
          Comps adapters idle or empty ({market.adapterIdleNotes.slice(0, 2).join(" · ")}). Sell/Lot
          still needs ≥{MIN_SALES_FOR_MARKET_EVIDENCE} matched sales — critic veto on thin evidence is
          correct.
        </p>
      ) : null}
      {market?.fetchError && <div className="banner warn">Market comps: {market.fetchError}</div>}
      {gate.action === "blocked" && bundle && bundle.source !== "none" && (
        <div className="banner warn">
          Liquidation blocked — {gate.eligibleHoldingIds.length} of{" "}
          {gate.eligibleHoldingIds.length + gate.blocked.length} priced highlights meet ≥
          {gate.minSalesRequired} matched sales
          {market?.ebayAuth.configured
            ? ". Adapters ran; Challenge must reject Sell/Lot until a title clears the gate."
            : ". eBay tokens not loaded (services/api/.env). Challenge veto is correct — do not act."}
        </div>
      )}
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
          disabled={busy || compsPending || !question.trim() || !bundle || bundle.source === "none"}
          onClick={() => void run()}
        >
          {loading ? "Running analysis…" : compsPending ? "Loading comps…" : "Run Collection Analysis"}
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
        <pre className="trace-body context-preview">{contextJson.slice(0, 16000)}</pre>
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
              task:
                session.council === "challenge"
                  ? "collection_challenge"
                  : "comics_collection_analysis",
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
