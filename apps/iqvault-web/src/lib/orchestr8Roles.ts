/** Orchestr8 UI helpers — agents/models come from the gateway; this is fallback + presets. */

export const PROVIDERS: Record<string, { id: string; label: string; color: string }> = {
  openai: { id: "openai", label: "OpenAI", color: "#10a37f" },
  anthropic: { id: "anthropic", label: "Anthropic", color: "#d4a853" },
  grok: { id: "grok", label: "Grok (xAI)", color: "#6366f1" },
};

export type AllowedModel = { id: string; label: string; provider?: string };

export type AgentInfo = {
  id: string;
  label: string;
  provider: string;
  providerLabel?: string;
  description?: string;
  defaultModel?: string;
  allowedModels?: AllowedModel[];
  councils?: string[];
  tier?: number;
  configured?: boolean;
};

export type TeamPreset = {
  id: string;
  label: string;
  roles: string[];
  mode: "single" | "pipeline" | "parallel";
  description: string;
  council?: string | null;
};

/** Map old localStorage role ids → registry agents */
export const LEGACY_ALIASES: Record<string, string> = {
  code_writer: "architect",
  qc_qa: "critic",
  predictor: "prediction_engine",
  re_evaluator: "critic",
};

export function resolveAgentId(id: string, aliases: Record<string, string> = LEGACY_ALIASES): string {
  return aliases[id] ?? id;
}

export function migrateRoleIds(
  roleIds: string[],
  aliases: Record<string, string> = LEGACY_ALIASES,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of roleIds || []) {
    const resolved = resolveAgentId(id, aliases);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

/** Offline fallback if Orchestr8 is down — mirrors agents/registry.yaml core set */
export const FALLBACK_AGENTS: AgentInfo[] = [
  {
    id: "project_manager",
    label: "Project Manager",
    provider: "openai",
    providerLabel: "OpenAI",
    description: "Plans work and synthesizes final answer",
    defaultModel: "gpt-4.1",
    allowedModels: [
      { id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
      { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
    ],
    councils: ["execution"],
    tier: 1,
  },
  {
    id: "researcher",
    label: "Researcher",
    provider: "anthropic",
    providerLabel: "Anthropic",
    description: "Deep collection analysis grounded in data",
    defaultModel: "claude-sonnet-4-6",
    allowedModels: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
    ],
    councils: ["discovery"],
    tier: 1,
  },
  {
    id: "critic",
    label: "Critic",
    provider: "grok",
    providerLabel: "Grok",
    description: "Challenge assumptions, find gaps",
    defaultModel: "grok-3",
    allowedModels: [
      { id: "grok-3", label: "Grok 3", provider: "grok" },
      { id: "grok-4", label: "Grok 4", provider: "grok" },
    ],
    councils: ["challenge"],
    tier: 1,
  },
];

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: "solo_pm",
    label: "Solo - Project Manager",
    roles: ["project_manager"],
    mode: "single",
    description: "OpenAI plans and answers alone",
  },
  {
    id: "solo_research",
    label: "Solo - Researcher",
    roles: ["researcher"],
    mode: "single",
    description: "Anthropic analysis only",
  },
  {
    id: "solo_critic",
    label: "Solo - Critic",
    roles: ["critic"],
    mode: "single",
    description: "Grok challenge only",
  },
  {
    id: "duo_pm_research",
    label: "Duo - PM + Research",
    roles: ["project_manager", "researcher"],
    mode: "pipeline",
    description: "Plan then research",
  },
  {
    id: "duo_research_critic",
    label: "Duo - Research + Critic",
    roles: ["researcher", "critic"],
    mode: "pipeline",
    description: "Analyze then challenge",
  },
  {
    id: "full_team",
    label: "Core trio - pipeline",
    roles: ["project_manager", "researcher", "critic"],
    mode: "pipeline",
    description: "PM -> Research -> Critic -> final",
  },
  {
    id: "full_parallel",
    label: "Core trio - parallel",
    roles: ["project_manager", "researcher", "critic"],
    mode: "parallel",
    description: "Research + Critic parallel, PM synthesizes",
  },
  {
    id: "council_discovery",
    label: "Discovery Council",
    council: "discovery",
    roles: ["researcher", "signal_hunter", "market_intelligence_agent", "acquisition_scout"],
    mode: "parallel",
    description: "Signals, market, acquisition leads",
  },
  {
    id: "council_analysis",
    label: "Analysis Council",
    council: "analysis",
    roles: [
      "investment_analyst",
      "pricing_agent",
      "liquidity_analyst",
      "portfolio_manager",
      "analyst",
      "prediction_engine",
    ],
    mode: "parallel",
    description: "Price, ROI, liquidity, forecast",
  },
  {
    id: "council_challenge",
    label: "Challenge Council",
    council: "challenge",
    roles: ["critic", "tester", "domain_expert"],
    mode: "pipeline",
    description: "Stress-test before acting (veto on critical)",
  },
  {
    id: "council_execution",
    label: "Execution Council",
    council: "execution",
    roles: ["orchestrator", "project_manager", "synthesizer"],
    mode: "pipeline",
    description: "Plan, track, final narrative",
  },
  {
    id: "council_board",
    label: "Executive Board",
    council: "board",
    roles: [
      "orchestrator",
      "investment_analyst",
      "critic",
      "portfolio_manager",
      "domain_expert",
      "synthesizer",
    ],
    mode: "parallel",
    description: "High-stakes review - surfaces dissent",
  },
  {
    id: "comics_vip",
    label: "Comics VIP slice",
    roles: [
      "researcher",
      "investment_analyst",
      "pricing_agent",
      "liquidity_analyst",
      "critic",
      "synthesizer",
    ],
    mode: "pipeline",
    description: "Research -> price/ROI/LIQ -> challenge -> synthesize",
  },
  {
    id: "custom",
    label: "Custom roles",
    roles: ["project_manager", "researcher", "critic"],
    mode: "pipeline",
    description: "Pick any combination below",
  },
];

export function agentsByProvider(agents: AgentInfo[]): Record<string, AgentInfo[]> {
  const map: Record<string, AgentInfo[]> = { openai: [], anthropic: [], grok: [] };
  for (const agent of agents) {
    const key = agent.provider;
    if (!map[key]) map[key] = [];
    map[key].push(agent);
  }
  return map;
}

export function agentsByTier(agents: AgentInfo[]): {
  tier1: AgentInfo[];
  tier9: AgentInfo[];
  other: AgentInfo[];
} {
  return {
    tier1: agents.filter((a) => a.tier === 1),
    tier9: agents.filter((a) => a.tier === 9),
    other: agents.filter((a) => a.tier !== 1 && a.tier !== 9),
  };
}

export function sortRoleIds(roleIds: string[], pipelineOrder: string[] = []): string[] {
  const order = pipelineOrder.length ? pipelineOrder : roleIds;
  const rank = Object.fromEntries(order.map((r, i) => [r, i]));
  return [...roleIds].sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99));
}

export function agentMap(agents: AgentInfo[]): Record<string, AgentInfo> {
  return Object.fromEntries((agents || []).map((a) => [a.id, a]));
}

export function teamSummary(
  roleIds: string[],
  mode: string,
  agents: AgentInfo[] = FALLBACK_AGENTS,
): string {
  const map = agentMap(agents);
  if (roleIds.length === 1) return map[roleIds[0]]?.label ?? roleIds[0];
  const providers = [...new Set(roleIds.map((id) => map[id]?.provider).filter(Boolean))];
  const names = providers.map((p) => PROVIDERS[p!]?.label ?? p);
  return `${names.join(" + ")} · ${roleIds.length} agents · ${mode}`;
}

export function defaultModelOverrides(
  agents: AgentInfo[],
  roleIds: string[],
): Record<string, string> {
  const map = agentMap(agents);
  const out: Record<string, string> = {};
  for (const id of roleIds) {
    const agent = map[id];
    if (agent?.defaultModel) out[id] = agent.defaultModel;
  }
  return out;
}
