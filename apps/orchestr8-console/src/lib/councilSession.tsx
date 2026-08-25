"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAgents,
  fetchCouncils,
  fetchHealth,
  streamJob,
  type Health,
  type JobResult,
  type JobStep,
} from "@/lib/orchestr8Api";
import {
  FALLBACK_AGENTS,
  TEAM_PRESETS,
  agentMap,
  type Agent,
  type TeamSettings,
} from "@/lib/roles";
import { defaultTeamSettings, loadTeamSettings, saveTeamSettings } from "@/lib/teamSettings";

export type ConsoleTab = "analysis" | "build" | "runs" | "specs";
export type SessionKind = "analysis" | "build";

export type Highlight = {
  id: string;
  role: string;
  label: string;
  text: string;
  verdict?: string;
  at: number;
};

export type LiveSession = {
  kind: SessionKind;
  question: string;
  roles: string[];
  mode: string;
  council: string | null;
  loading: boolean;
  startedAt: number | null;
  steps: JobStep[];
  highlights: Highlight[];
  result: JobResult | null;
  error: string | null;
  /** Latest gateway progress frame (repo context / role_start). */
  progressMessage: string | null;
  activeRole: string | null;
  /** Bumped on start / progress / step — stall watchdog must not ignore SSE progress. */
  lastActivityAt: number | null;
};

export type CouncilInfo = {
  id: string;
  label: string;
  purpose?: string;
  mode?: string;
  agents?: string[];
  voting?: string;
};

export type EffectiveRoster = {
  label: string;
  councilId: string | null;
  councilLabel: string;
  purpose?: string;
  mode: string;
  voting?: string;
  roles: string[];
  source: "team" | "analysis-default" | "build-default" | "live";
};

type RunJobArgs = {
  kind: SessionKind;
  task: string;
  question: string;
  roles: string[];
  mode: string;
  council: string | null;
  contextJson?: string;
  resumeFromRunId?: string;
};

type CouncilSessionValue = {
  tab: ConsoleTab;
  setTab: (t: ConsoleTab) => void;
  team: TeamSettings;
  setTeam: (t: TeamSettings) => void;
  agents: Agent[];
  councils: CouncilInfo[];
  health: Health | null;
  showTeam: boolean;
  setShowTeam: (v: boolean) => void;
  sessions: Record<SessionKind, LiveSession>;
  liveKind: SessionKind | null;
  effectiveRoster: EffectiveRoster;
  runJob: (args: RunJobArgs) => Promise<JobResult | null>;
  stopJob: () => void;
  clearSession: (kind: SessionKind) => void;
  /** Bumped when a council stream finishes with a persisted runId. */
  runsRefreshCount: number;
};

const emptySession = (kind: SessionKind): LiveSession => ({
  kind,
  question: "",
  roles: [],
  mode: "pipeline",
  council: null,
  loading: false,
  startedAt: null,
  steps: [],
  highlights: [],
  result: null,
  error: null,
  progressMessage: null,
  activeRole: null,
  lastActivityAt: null,
});

const CouncilSessionContext = createContext<CouncilSessionValue | null>(null);

function highlightFromStep(step: JobStep, index: number): Highlight {
  const raw = (step.text || step.error || "").replace(/\s+/g, " ").trim();
  const text = raw.slice(0, 220) || "(no text)";
  return {
    id: `${step.role || "step"}-${index}-${Date.now()}`,
    role: step.role || "unknown",
    label: step.role_label || step.role || "Role",
    text,
    verdict: step.verdict || undefined,
    at: Date.now(),
  };
}

function rosterFromTeam(team: TeamSettings, fallbackLabel: string): EffectiveRoster {
  const preset = TEAM_PRESETS.find((p) => p.id === team.presetId);
  return {
    label: preset?.label || fallbackLabel,
    councilId: team.council,
    councilLabel: team.council || preset?.label || "Custom",
    purpose: preset?.description,
    mode: team.roles.length === 1 ? "single" : team.mode,
    voting: team.council === "full" || team.presetId === "council_full" ? "veto_on_critical" : undefined,
    roles: team.roles,
    source: "team",
  };
}

export function analysisEffective(team: TeamSettings): EffectiveRoster {
  const honorTeam =
    team.roles.length > 0 &&
    (team.presetId === "comics_vip" ||
      team.presetId === "custom" ||
      team.presetId === "council_full" ||
      team.council === "analysis" ||
      team.council === "full" ||
      team.roles.length > 6);
  if (honorTeam) {
    return rosterFromTeam(team, "Analysis team");
  }
  return {
    label: "Analysis Council",
    councilId: "analysis",
    councilLabel: "Analysis Council",
    purpose: "Evaluate holdings, price, portfolio fit, and forecasts",
    mode: "parallel",
    voting: "none",
    roles: [
      "investment_analyst",
      "pricing_agent",
      "liquidity_analyst",
      "portfolio_manager",
      "analyst",
      "prediction_engine",
    ],
    source: "analysis-default",
  };
}

export function buildEffective(team: TeamSettings): EffectiveRoster {
  if (team.roles.length) {
    return rosterFromTeam(team, "Build team");
  }
  return {
    label: "Build Spec Council",
    councilId: "build_spec",
    councilLabel: "Build Spec Council",
    purpose: "Produce a critic-passed Cursor work order",
    mode: "pipeline",
    voting: "veto_on_critical",
    roles: ["architect", "domain_expert", "tester", "critic"],
    source: "build-default",
  };
}

function rosterFromSession(s: LiveSession, councils: CouncilInfo[]): EffectiveRoster {
  const c = councils.find((x) => x.id === s.council);
  return {
    label: c?.label || s.council || s.kind,
    councilId: s.council,
    councilLabel: c?.label || s.council || s.kind,
    purpose: c?.purpose,
    mode: s.mode,
    voting: c?.voting,
    roles: s.roles.length ? s.roles : s.steps.map((t) => t.role || "").filter(Boolean),
    source: "live",
  };
}

export function CouncilSessionProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<ConsoleTab>("analysis");
  const [team, setTeamState] = useState<TeamSettings>(defaultTeamSettings);
  const [agents, setAgents] = useState<Agent[]>(FALLBACK_AGENTS);
  const [councils, setCouncils] = useState<CouncilInfo[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const [sessions, setSessions] = useState<Record<SessionKind, LiveSession>>({
    analysis: emptySession("analysis"),
    build: emptySession("build"),
  });
  const [runsRefreshCount, setRunsRefreshCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const liveKindRef = useRef<SessionKind | null>(null);

  const setTeam = useCallback((t: TeamSettings) => {
    setTeamState(t);
    saveTeamSettings(t);
  }, []);

  useEffect(() => {
    setTeamState(loadTeamSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const [agentsRes, councilsRes, h] = await Promise.all([
          fetchAgents().catch(() => null),
          fetchCouncils().catch(() => ({ councils: [] as CouncilInfo[] })),
          fetchHealth(),
        ]);
        if (cancelled) return;
        if (agentsRes?.agents?.length) {
          setAgents(
            agentsRes.agents.map((a) => ({
              id: a.id,
              label: a.label,
              provider: a.provider,
              providerLabel: a.providerLabel,
              description: a.description,
              defaultModel: a.defaultModel,
              allowedModels: a.allowedModels || [],
              councils: a.councils,
              tier: a.tier,
              configured: a.configured,
            }))
          );
        }
        setCouncils(councilsRes.councils || []);
        setHealth(h);
      } catch {
        /* keep fallbacks */
      }
    }
    void boot();
    const id = setInterval(() => {
      fetchHealth().then(setHealth);
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const liveKind = useMemo(() => {
    if (sessions.analysis.loading) return "analysis" as SessionKind;
    if (sessions.build.loading) return "build" as SessionKind;
    return null;
  }, [sessions]);

  liveKindRef.current = liveKind;

  const effectiveRoster = useMemo(() => {
    if (liveKind) return rosterFromSession(sessions[liveKind], councils);
    if (tab === "analysis") {
      const r = analysisEffective(team);
      const c = councils.find((x) => x.id === r.councilId);
      return { ...r, purpose: c?.purpose || r.purpose, voting: c?.voting || r.voting };
    }
    if (tab === "build") {
      const r = buildEffective(team);
      const c = councils.find((x) => x.id === r.councilId);
      return { ...r, purpose: c?.purpose || r.purpose, voting: c?.voting || r.voting };
    }
    // Runs/Specs: show team as configured
    const preset = TEAM_PRESETS.find((p) => p.id === team.presetId);
    const c = councils.find((x) => x.id === team.council);
    return {
      label: preset?.label || "Configured team",
      councilId: team.council,
      councilLabel: c?.label || team.council || preset?.label || "Team",
      purpose: c?.purpose || preset?.description,
      mode: team.mode,
      voting: c?.voting,
      roles: team.roles,
      source: "team" as const,
    };
  }, [liveKind, sessions, tab, team, councils]);

  const markIdle = useCallback((kind: SessionKind, error: string | null) => {
    setSessions((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        loading: false,
        error: error ?? prev[kind].error,
      },
    }));
  }, []);

  /** Abort fetch and immediately clear stuck "running" UI (gateway may already be idle). */
  const stopJob = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSessions((prev) => {
      let changed = false;
      const next = { ...prev };
      (["analysis", "build"] as SessionKind[]).forEach((k) => {
        if (next[k].loading) {
          changed = true;
          next[k] = {
            ...next[k],
            loading: false,
            error:
              next[k].error ||
              "Stopped — UI cleared. Gateway had no active stream (stale running state).",
          };
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const clearSession = useCallback((kind: SessionKind) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSessions((prev) => ({ ...prev, [kind]: emptySession(kind) }));
  }, []);

  // Stall watchdog: only fire when SSE goes silent (progress counts as activity).
  // Build Spec Architect often needs 2–4+ minutes before the first step lands.
  useEffect(() => {
    const id = setInterval(() => {
      setSessions((prev) => {
        let changed = false;
        const next = { ...prev };
        const now = Date.now();
        (["analysis", "build"] as SessionKind[]).forEach((k) => {
          const s = next[k];
          if (!s.loading || !s.startedAt) return;
          const lastActivity =
            s.lastActivityAt ||
            (s.highlights.length ? s.highlights[s.highlights.length - 1]!.at : s.startedAt);
          const stallMs = now - lastActivity;
          const ageMs = now - s.startedAt;
          const roleCount = Math.max(s.roles.length, 1);
          // Socket timeout for large completions is up to 480s; stall must sit above that.
          const noStepsStuck = s.steps.length === 0 && stallMs > 10 * 60_000;
          const midRunStuck = s.steps.length > 0 && stallMs > 10 * 60_000;
          const hardCap = ageMs > Math.max(20 * 60_000, roleCount * 8 * 60_000);
          if (noStepsStuck || midRunStuck || hardCap) {
            changed = true;
            next[k] = {
              ...s,
              loading: false,
              error:
                s.error ||
                "Timed out — no gateway progress for several minutes. Click Clear, then retry. (UI was stuck; server may already be idle.)",
            };
          }
        });
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const runJob = useCallback(
    async (args: RunJobArgs) => {
      if (liveKindRef.current) {
        throw new Error(
          "UI still shows a council running. Click Stop / Clear in the progress dock, then retry."
        );
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setSessions((prev) => ({
        ...prev,
        [args.kind]: {
          kind: args.kind,
          question: args.question || prev[args.kind].question,
          roles: args.roles.length ? args.roles : prev[args.kind].roles,
          mode: args.mode || prev[args.kind].mode,
          council: args.council ?? prev[args.kind].council,
          loading: true,
          startedAt: args.resumeFromRunId ? prev[args.kind].startedAt || Date.now() : Date.now(),
          lastActivityAt: Date.now(),
          steps: args.resumeFromRunId ? prev[args.kind].steps : [],
          highlights: args.resumeFromRunId ? prev[args.kind].highlights : [],
          result: null,
          error: null,
          progressMessage: args.resumeFromRunId
            ? "Resuming after top-off — retrying the failed role only…"
            : "Connecting to gateway stream…",
          activeRole: args.roles[0] || prev[args.kind].activeRole,
        },
      }));

      try {
        const out = await streamJob(
          {
            task: args.task,
            roles: args.roles,
            mode: args.mode,
            question: args.question,
            contextJson: args.contextJson,
            modelOverrides: team.modelOverrides,
            council: args.council,
            resumeFromRunId: args.resumeFromRunId,
          },
          {
            onStart: () => {
              setSessions((prev) => ({
                ...prev,
                [args.kind]: {
                  ...prev[args.kind],
                  lastActivityAt: Date.now(),
                  progressMessage: "Stream open — waiting for progress…",
                },
              }));
            },
            onProgress: (p) => {
              setSessions((prev) => ({
                ...prev,
                [args.kind]: {
                  ...prev[args.kind],
                  lastActivityAt: Date.now(),
                  progressMessage: p.message || prev[args.kind].progressMessage,
                  activeRole: p.role || prev[args.kind].activeRole,
                },
              }));
            },
            onStep: (step) => {
              setSessions((prev) => {
                const cur = prev[args.kind];
                const steps = [...cur.steps, step];
                return {
                  ...prev,
                  [args.kind]: {
                    ...cur,
                    steps,
                    lastActivityAt: Date.now(),
                    highlights: [...cur.highlights, highlightFromStep(step, steps.length)].slice(-40),
                    progressMessage: `${step.role_label || step.role || "role"} finished`,
                    activeRole: step.role || cur.activeRole,
                  },
                };
              });
            },
          },
          ac.signal
        );
        if (ac.signal.aborted) {
          markIdle(args.kind, "Stopped");
          return null;
        }
        setSessions((prev) => ({
          ...prev,
          [args.kind]: {
            ...prev[args.kind],
            loading: false,
            result: out,
            error: out
              ? null
              : "Stream ended with no result — connection dropped before council finished.",
          },
        }));
        if (out?.runId) setRunsRefreshCount((n) => n + 1);
        return out;
      } catch (e) {
        if (ac.signal.aborted) {
          markIdle(args.kind, "Stopped");
          return null;
        }
        const msg = e instanceof Error ? e.message : "Council run failed";
        markIdle(args.kind, msg);
        throw e;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        // Belt-and-suspenders: never leave loading=true after the promise settles.
        setSessions((prev) => {
          if (!prev[args.kind].loading) return prev;
          return {
            ...prev,
            [args.kind]: { ...prev[args.kind], loading: false },
          };
        });
      }
    },
    [markIdle, team.modelOverrides]
  );

  const value: CouncilSessionValue = {
    tab,
    setTab,
    team,
    setTeam,
    agents,
    councils,
    health,
    showTeam,
    setShowTeam,
    sessions,
    liveKind,
    effectiveRoster,
    runJob,
    stopJob,
    clearSession,
    runsRefreshCount,
  };

  return (
    <CouncilSessionContext.Provider value={value}>{children}</CouncilSessionContext.Provider>
  );
}

export function useCouncilSession() {
  const ctx = useContext(CouncilSessionContext);
  if (!ctx) throw new Error("useCouncilSession requires CouncilSessionProvider");
  return ctx;
}

export function resolveRoleModel(agent: Agent | undefined, overrides: Record<string, string>) {
  if (!agent) return { modelId: "—", modelLabel: "—" };
  const modelId = overrides[agent.id] || agent.defaultModel;
  const hit = agent.allowedModels.find((m) => m.id === modelId);
  return { modelId, modelLabel: hit?.label || modelId };
}

export function useAgentLookup() {
  const { agents } = useCouncilSession();
  return useMemo(() => agentMap(agents), [agents]);
}
