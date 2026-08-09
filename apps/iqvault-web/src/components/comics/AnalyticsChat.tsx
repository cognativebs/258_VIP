"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAnalyticsContext,
  contextToJson,
  SUGGESTED_PROMPTS,
} from "@/lib/analyticsContext";
import {
  fetchOrchestr8Health,
  streamOrchestr8Job,
  type JobStep,
  type Orchestr8Health,
} from "@/lib/orchestr8Api";
import type { ComicFilters, ComicRow, ComicsMeta } from "@/lib/comicTypes";

/** Analysis Council — matches the Orchestr8 Console "council_analysis" preset. */
const ANALYSIS_ROLES = [
  "investment_analyst",
  "pricing_agent",
  "liquidity_analyst",
  "portfolio_manager",
  "analyst",
  "prediction_engine",
];

type Message = {
  role: "user" | "assistant";
  content: string;
  trace?: JobStep[];
  usage?: { costUsd?: number; total?: number; errors?: number } | null;
  vote?: { vetoed?: boolean; dissent?: boolean; summary?: string } | null;
};

const SECS_PER_STEP = 18;

function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtUsd(v: number) {
  return v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(4)}` : "$0.00";
}

export function AnalyticsChat({
  meta,
  filtered,
  dashboardStats,
  filters,
  workspace,
  selectedComic,
  filteredValue,
  source,
}: {
  meta: ComicsMeta | null;
  filtered: ComicRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dashboardStats: any;
  filters: ComicFilters;
  workspace: string;
  selectedComic: ComicRow | null;
  filteredValue: number;
  source: "comics-api" | "vip-api" | null;
}) {
  const [health, setHealth] = useState<Orchestr8Health | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<JobStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = health?.ok === true;

  const contextJson = useMemo(
    () =>
      contextToJson(
        buildAnalyticsContext({
          meta,
          filtered,
          dashboardStats,
          filters,
          workspace,
          selectedComic,
          filteredValue,
          source,
        }),
      ),
    [meta, filtered, dashboardStats, filters, workspace, selectedComic, filteredValue, source],
  );

  useEffect(() => {
    void fetchOrchestr8Health().then(setHealth);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [loading]);

  // Cancel any in-flight run if the panel unmounts (tab switch / navigation).
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading || !configured) return;

      setError(null);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setInput("");
      setLoading(true);
      setLiveSteps([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await streamOrchestr8Job(
          {
            task: "comics_collection_analysis",
            roles: ANALYSIS_ROLES,
            mode: "parallel",
            question: trimmed,
            contextJson,
            council: "analysis",
          },
          { onStep: (step) => setLiveSteps((prev) => [...prev, step]) },
          controller.signal,
        );
        if (!result) {
          if (!controller.signal.aborted) throw new Error("No result returned from Orchestr8");
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.text ?? "(empty response)",
            trace: result.trace ?? [],
            usage: result.usage ?? null,
            vote: result.vote ?? null,
          },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
        setLiveSteps([]);
        abortRef.current = null;
      }
    },
    [loading, configured, contextJson],
  );

  const activeStep = Math.min(
    Math.floor(elapsed / SECS_PER_STEP),
    Math.max(ANALYSIS_ROLES.length - 1, 0),
  );
  const estTotal = ANALYSIS_ROLES.length * SECS_PER_STEP;

  return (
    <div className="bb-analytics">
      <div className="bb-analytics-head">
        <span>Conversational analytics</span>
        <div className="bb-analytics-head-right">
          <span className="bb-analytics-provider">
            Analysis Council · {ANALYSIS_ROLES.length} agents
          </span>
        </div>
      </div>

      <div className="bb-analytics-scope">
        Scope: {filtered.length.toLocaleString()} books
        {source === "vip-api" ? " · VIP sample (fallback)" : ""}
      </div>

      {!configured ? (
        <div className="bb-analytics-setup">
          <p>
            Orchestr8 gateway not reachable. Start it with provider keys in{" "}
            <code>orchestr8/.env</code>:
          </p>
          <code>start_orchestr8.bat</code>
          <p className="bb-analytics-setup-note">
            Specialized agents price, rank liquidity, and challenge high-dollar calls before they
            reach you.
          </p>
        </div>
      ) : null}

      <div className="bb-analytics-msgs" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="bb-analytics-welcome">
            <p>
              Ask about your <strong>current filter</strong>. Answers come back as actions with
              confidence and reasons — ranges, never point values as fact.
            </p>
            <div className="bb-prompt-grid">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="bb-prompt-chip"
                  disabled={!configured || loading}
                  onClick={() => void send(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={`bb-msg bb-msg-${m.role}`}>
            <span className="bb-msg-role">{m.role === "user" ? "You" : "IQVault"}</span>
            {m.vote?.vetoed ? (
              <div className="bb-vote-gate veto">
                VETO · {m.vote.summary || "Critical issues must be resolved before acting."}
              </div>
            ) : null}
            {m.vote?.dissent ? (
              <div className="bb-vote-gate dissent">
                DISSENT · {m.vote.summary || "Members disagree — not a consensus recommendation."}
              </div>
            ) : null}
            <div className="bb-msg-body">{m.content}</div>
            {m.trace?.length ? (
              <details className="bb-trace">
                <summary>
                  Team trace ({m.trace.length} steps)
                  {m.usage?.total ? ` · ${m.usage.total.toLocaleString()} tokens` : ""}
                  {typeof m.usage?.costUsd === "number" ? ` · ${fmtUsd(m.usage.costUsd)}` : ""}
                  {m.usage?.errors
                    ? ` · ${m.usage.errors} error${m.usage.errors > 1 ? "s" : ""}`
                    : ""}
                </summary>
                {m.trace.map((step, j) => (
                  <div
                    key={j}
                    className={`bb-trace-step${step.error ? " bb-trace-step-error" : ""}`}
                  >
                    <span className="bb-trace-label">
                      {step.role_label ?? step.role} · {step.provider_label ?? step.provider}
                      {step.model_label || step.model
                        ? ` · ${step.model_label || step.model}`
                        : ""}
                      {step.usage?.total ? ` · ${step.usage.total.toLocaleString()} tok` : ""}
                      {typeof step.costUsd === "number" && step.costUsd > 0
                        ? ` · ${fmtUsd(step.costUsd)}`
                        : ""}
                      {typeof step.confidence === "number" ? (
                        <span className="bb-trace-conf">
                          {Math.round(step.confidence * 100)}% conf
                        </span>
                      ) : null}
                      {step.verdict ? (
                        <span className={`bb-trace-verdict ${step.verdict}`}>{step.verdict}</span>
                      ) : null}
                    </span>
                    <div className="bb-trace-text">{step.text}</div>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        ))}

        {loading ? (
          <div className="bb-msg bb-msg-assistant">
            <span className="bb-msg-role">IQVault</span>
            <div className="bb-msg-body bb-msg-loading">
              <div className="bb-load-head">
                <span className="bb-blink">▮</span> Team analyzing{" "}
                {filtered.length.toLocaleString()} books…
                <span className="bb-load-timer">{fmtTime(elapsed)}</span>
              </div>
              <ol className="bb-load-steps">
                {liveSteps.length > 0
                  ? liveSteps.map((s, i) => (
                      <li key={`live-${i}`} className={s.error ? "error" : "done"}>
                        <span className="bb-load-dot" />
                        {s.role_label ?? s.role}
                        {s.model_label ? ` · ${s.model_label}` : ""}
                        {typeof s.costUsd === "number" && s.costUsd > 0
                          ? ` · ${fmtUsd(s.costUsd)}`
                          : ""}
                      </li>
                    ))
                  : ANALYSIS_ROLES.map((role, i) => (
                      <li
                        key={role}
                        className={
                          i < activeStep ? "done" : i === activeStep ? "active" : "pending"
                        }
                      >
                        <span className="bb-load-dot" />
                        {role.replace(/_/g, " ")}
                      </li>
                    ))}
                {liveSteps.length > 0 ? (
                  <li className="active">
                    <span className="bb-load-dot" />
                    working…
                  </li>
                ) : null}
              </ol>
              <span className="bb-load-hint">
                {liveSteps.length > 0
                  ? `Live · ${liveSteps.length} of ~${ANALYSIS_ROLES.length} agents done · ${fmtUsd(
                      liveSteps.reduce((sum, s) => sum + (s.costUsd || 0), 0),
                    )} so far`
                  : `Estimated progress · multi-agent runs take ~${estTotal}s`}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="bb-analytics-error">{error}</div> : null}

      <form
        className="bb-analytics-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="bb-analytics-input"
          rows={2}
          placeholder={
            configured ? "Ask about this filter…" : "Start Orchestr8 first (start_orchestr8.bat)"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!configured || loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="bb-analytics-actions">
          {loading ? (
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              disabled={!messages.length}
            >
              Clear
            </button>
          )}
          <button
            type="submit"
            className="bb-btn bb-btn-analytics"
            disabled={!configured || loading || !input.trim()}
          >
            Analyze
          </button>
        </div>
      </form>
    </div>
  );
}
