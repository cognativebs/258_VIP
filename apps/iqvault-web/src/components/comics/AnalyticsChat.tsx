"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAnalyticsContext,
  contextToJson,
  SUGGESTED_PROMPTS,
} from "@/lib/analyticsContext";
import {
  fetchOrchestr8Agents,
  fetchOrchestr8Health,
  streamOrchestr8Job,
  type JobStep,
  type Orchestr8Health,
} from "@/lib/orchestr8Api";
import {
  FALLBACK_AGENTS,
  agentMap,
  teamSummary,
  type AgentInfo,
} from "@/lib/orchestr8Roles";
import { loadTeamSettings, type TeamSettings } from "@/lib/orchestr8TeamSettings";
import type { ComicFilters, ComicRow, ComicsMeta } from "@/lib/comicTypes";
import { TeamOrchestrationPanel } from "./TeamOrchestrationPanel";

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
  const [team, setTeam] = useState<TeamSettings>(() => loadTeamSettings());
  const [agents, setAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [health, setHealth] = useState<Orchestr8Health | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<JobStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = health?.ok === true;
  const teamLabel = teamSummary(team.roles, team.mode, agents);

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
    void fetchOrchestr8Agents()
      .then((data) => {
        if (data.agents?.length) setAgents(data.agents);
      })
      .catch(() => {});
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

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const fillPrompt = useCallback((text: string) => {
    setInput(text);
    setError(null);
    // Next tick so the value is in the DOM before focus/select.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(text.length, text.length);
    });
  }, []);

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
            roles: team.roles,
            mode: team.roles.length === 1 ? "single" : team.mode,
            question: trimmed,
            contextJson,
            council: team.council,
            modelOverrides: team.modelOverrides,
          },
          { onStep: (step) => setLiveSteps((prev) => [...prev, step]) },
          controller.signal,
        );
        if (!result) {
          if (controller.signal.aborted) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: "Stopped. Partial provider usage before the abort may still be billed.",
              },
            ]);
            return;
          }
          throw new Error("No result returned from Orchestr8");
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
        if (controller.signal.aborted) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "Stopped. Partial provider usage before the abort may still be billed.",
            },
          ]);
        } else {
          setError(e instanceof Error ? e.message : "Request failed");
        }
      } finally {
        setLoading(false);
        setLiveSteps([]);
        abortRef.current = null;
      }
    },
    [loading, configured, contextJson, team],
  );

  const progressSteps = useMemo(() => {
    const map = agentMap(agents);
    const steps = team.roles.map((id) => map[id]?.label ?? id);
    if (team.roles.length > 1) steps.push("Synthesis");
    return steps;
  }, [team.roles, agents]);

  const activeStep = Math.min(
    Math.floor(elapsed / SECS_PER_STEP),
    Math.max(progressSteps.length - 1, 0),
  );
  const estTotal = Math.max(progressSteps.length, 1) * SECS_PER_STEP;

  return (
    <div className="bb-analytics">
      <div className="bb-analytics-head">
        <span>Conversational analytics</span>
        <div className="bb-analytics-head-right">
          {loading ? (
            <button
              type="button"
              className="bb-btn bb-btn-stop"
              onClick={stopRun}
              title="Abort the running Orchestr8 job"
            >
              Stop
            </button>
          ) : null}
          <span className="bb-analytics-provider">{teamLabel}</span>
          <button
            type="button"
            className="bb-link-btn"
            onClick={() => setShowTeamPanel(true)}
            title="Pick Orchestr8 council, roles, and models"
            disabled={loading}
          >
            AI team
          </button>
        </div>
      </div>

      <div className="bb-analytics-scope">
        Scope: {filtered.length.toLocaleString()} books
        {selectedComic
          ? ` · selected ${selectedComic.Series ?? ""} #${selectedComic["Issue Full"] || selectedComic.Issue || ""}`
          : ""}
        {source === "vip-api"
          ? " · VIP → Postgres"
          : source === "comics-api"
            ? " · Comics API (live)"
            : ""}
      </div>

      {!configured ? (
        <div className="bb-analytics-setup">
          <p>
            Orchestr8 gateway not reachable at <code>:5210</code>. Start it with provider keys in{" "}
            <code>orchestr8/.env</code>:
          </p>
          <code>python orchestr8/api/server.py</code>
          <p className="bb-analytics-setup-note">
            Open <strong>AI team</strong> to pick councils and models once the gateway is up.
          </p>
        </div>
      ) : null}

      <div className="bb-analytics-msgs" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="bb-analytics-welcome">
            <p>
              Type your own question below, or tap a suggestion to <strong>fill</strong> the box
              (suggestions do not start a run until you hit Analyze). Open <strong>AI team</strong>{" "}
              for council / roles / models.
            </p>
            <div className="bb-prompt-grid">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="bb-prompt-chip"
                  disabled={!configured || loading}
                  onClick={() => fillPrompt(p)}
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
                {filtered.length.toLocaleString()} books ({teamLabel})…
                <span className="bb-load-timer">{fmtTime(elapsed)}</span>
                <button
                  type="button"
                  className="bb-btn bb-btn-stop"
                  onClick={stopRun}
                  title="Abort the running Orchestr8 job"
                >
                  Stop
                </button>
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
                  : progressSteps.map((label, i) => (
                      <li
                        key={`${label}-${i}`}
                        className={
                          i < activeStep ? "done" : i === activeStep ? "active" : "pending"
                        }
                      >
                        <span className="bb-load-dot" />
                        {label}
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
                  ? `Live · ${liveSteps.length} of ~${team.roles.length} agents done · ${fmtUsd(
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
        <label className="bb-analytics-input-label" htmlFor="bb-analytics-question">
          Your question
        </label>
        <textarea
          id="bb-analytics-question"
          ref={inputRef}
          className="bb-analytics-input"
          rows={3}
          placeholder={
            configured
              ? "Type your own question about this filter…"
              : "Start Orchestr8 first (Launch IQVault.bat)"
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
            <button type="button" className="bb-btn bb-btn-stop" onClick={stopRun}>
              Stop run
            </button>
          ) : (
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => {
                setMessages([]);
                setError(null);
                setInput("");
                inputRef.current?.focus();
              }}
              disabled={!messages.length && !input.trim()}
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

      {showTeamPanel ? (
        <TeamOrchestrationPanel
          settings={team}
          onChange={setTeam}
          onClose={() => setShowTeamPanel(false)}
          gatewayHealth={health}
        />
      ) : null}
    </div>
  );
}
