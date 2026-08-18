"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAnalyticsContext,
  contextToJson,
  suggestedPrompts,
  type DashboardStats,
} from "@/lib/analyticsContext";
import type { ComicFilters, ComicRow, ComicsMeta } from "@/lib/comicTypes";
import {
  fetchOrchestr8Agents,
  fetchOrchestr8Health,
  streamOrchestr8Job,
  type Orchestr8Health,
  type Orchestr8JobResult,
  type Orchestr8JobStep,
} from "@/lib/orchestr8/api";
import { FALLBACK_AGENTS, agentMap, teamSummary } from "@/lib/orchestr8/roles";
import { loadTeamSettings, type TeamSettings } from "@/lib/orchestr8/teamSettings";
import { TeamOrchestrationPanel } from "./TeamOrchestrationPanel";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  trace?: Orchestr8JobStep[];
  mode?: string;
  usage?: Orchestr8JobResult["usage"];
  vote?: Orchestr8JobResult["vote"];
};

type Props = {
  meta: ComicsMeta | null;
  filtered: ComicRow[];
  dashboardStats: DashboardStats;
  filters: ComicFilters;
  workspace: string;
  selectedComic: ComicRow | null;
  filteredValue: number;
  vertical?: string;
  unit?: string;
};

export function ComicsAnalyticsChat({
  meta,
  filtered,
  dashboardStats,
  filters,
  workspace,
  selectedComic,
  filteredValue,
  vertical = "comic",
  unit = "books",
}: Props) {
  const [team, setTeam] = useState<TeamSettings>(loadTeamSettings);
  const [agents, setAgents] = useState(FALLBACK_AGENTS);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [gatewayHealth, setGatewayHealth] = useState<Orchestr8Health | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<Orchestr8JobStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const configured = gatewayHealth?.ok === true;
  const teamLabel = teamSummary(team.roles, team.mode, agents);
  const prompts = suggestedPrompts(vertical);

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
          vertical,
          unit,
        }),
      ),
    [meta, filtered, dashboardStats, filters, workspace, selectedComic, filteredValue, vertical, unit],
  );

  useEffect(() => {
    fetchOrchestr8Health().then(setGatewayHealth).catch(() => setGatewayHealth({ ok: false }));
    fetchOrchestr8Agents()
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
      return undefined;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [loading]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading || !configured) return;
      setError(null);
      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);
      setLiveSteps([]);
      try {
        const result = await streamOrchestr8Job(
          {
            task: "comics_collection_analysis",
            roles: team.roles,
            mode: team.roles.length === 1 ? "single" : team.mode,
            messages: nextMessages,
            contextJson,
            modelOverrides: team.modelOverrides,
            council: team.council,
          },
          { onStep: (step) => setLiveSteps((prev) => [...prev, step]) },
        );
        if (!result) throw new Error("No result returned from Orchestr8");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.text ?? "",
            trace: result.trace ?? [],
            mode: result.mode,
            usage: result.usage,
            vote: result.vote,
          },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
        setLiveSteps([]);
      }
    },
    [messages, loading, contextJson, team, configured],
  );

  const progressSteps = useMemo(() => {
    const map = agentMap(agents);
    const steps = team.roles.map((id) => map[id]?.label ?? id);
    if (team.roles.length > 1) steps.push("Synthesis");
    return steps;
  }, [team.roles, agents]);

  const SECS_PER_STEP = 18;
  const activeStep = Math.min(Math.floor(elapsed / SECS_PER_STEP), Math.max(progressSteps.length - 1, 0));
  const estTotal = Math.max(progressSteps.length, 1) * SECS_PER_STEP;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const fmtUsd = (v: number) => (v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toFixed(4)}` : "$0.00");

  return (
    <div className="bb-analytics">
      <div className="bb-analytics-head">
        <span>Conversational analytics</span>
        <div className="bb-analytics-head-right">
          <span className="bb-analytics-provider">{teamLabel}</span>
          <button type="button" className="bb-link-btn" onClick={() => setShowTeamPanel(true)}>
            AI team
          </button>
        </div>
      </div>

      {!configured ? (
        <div className="bb-analytics-setup">
          <p>Start Orchestr8 with provider keys in <code>orchestr8/.env</code>:</p>
          <code>start_orchestr8.bat</code>
          <p className="bb-analytics-setup-note">
            Specialized agents · pick models per role · keys stay in orchestr8/.env
          </p>
        </div>
      ) : null}

      <div className="bb-analytics-msgs" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="bb-analytics-welcome">
            <p>
              Ask about your <strong>current filter</strong> ({filtered.length.toLocaleString()} {unit}).
              Orchestr8 runs specialized agents — open <strong>AI team</strong> to pick roles and models.
            </p>
            <div className="bb-prompt-grid">
              {prompts.map((p) => (
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
            {m.trace && m.trace.length > 0 ? (
              <details className="bb-trace">
                <summary>
                  Team trace ({m.trace.length} steps)
                  {m.usage?.total ? ` · ${m.usage.total.toLocaleString()} tokens` : ""}
                  {typeof m.usage?.costUsd === "number" ? ` · ${fmtUsd(m.usage.costUsd)}` : ""}
                </summary>
                {m.trace.map((step, j) => (
                  <div key={j} className={`bb-trace-step${step.error ? " bb-trace-step-error" : ""}`}>
                    <span className="bb-trace-label">
                      {step.role_label ?? step.role} · {step.provider_label ?? step.provider}
                      {step.model_label || step.model ? ` · ${step.model_label || step.model}` : ""}
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
                <span className="bb-blink">▮</span> Team analyzing {filtered.length.toLocaleString()} {unit} ({teamLabel})…
                <span className="bb-load-timer">{fmtTime(elapsed)}</span>
              </div>
              {liveSteps.length > 0 ? (
                <ol className="bb-load-steps">
                  {liveSteps.map((s, i) => (
                    <li key={`live-${i}`} className={s.error ? "error" : "done"}>
                      <span className="bb-load-dot" />
                      {s.role_label ?? s.role}
                      {s.model_label ? ` · ${s.model_label}` : ""}
                    </li>
                  ))}
                  <li className="active"><span className="bb-load-dot" />working…</li>
                </ol>
              ) : progressSteps.length > 1 ? (
                <ol className="bb-load-steps">
                  {progressSteps.map((label, i) => (
                    <li key={`${label}-${i}`} className={i < activeStep ? "done" : i === activeStep ? "active" : "pending"}>
                      <span className="bb-load-dot" />
                      {label}
                    </li>
                  ))}
                </ol>
              ) : null}
              <span className="bb-load-hint">
                {liveSteps.length > 0
                  ? `Live · ${liveSteps.length} of ~${progressSteps.length} agents done`
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
          placeholder={configured ? "Ask about this filter…" : "Start Orchestr8 first (start_orchestr8.bat)"}
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
          <button type="button" className="bb-btn bb-btn-ghost" onClick={() => { setMessages([]); setError(null); }} disabled={!messages.length}>
            Clear
          </button>
          <button type="submit" className="bb-btn bb-btn-analytics" disabled={!configured || loading || !input.trim()}>
            Analyze
          </button>
        </div>
      </form>

      {showTeamPanel ? (
        <TeamOrchestrationPanel
          settings={team}
          onChange={setTeam}
          onClose={() => setShowTeamPanel(false)}
          gatewayHealth={gatewayHealth}
        />
      ) : null}
    </div>
  );
}
