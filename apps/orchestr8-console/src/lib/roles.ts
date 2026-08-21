/** Orchestr8 UI helpers — agents/models from gateway; fallback + presets. */

export type ProviderId = "openai" | "anthropic" | "grok" | string;

export type AllowedModel = {
  id: string;
  label: string;
  provider?: string;
  tier?: string;
  cost?: string;
  context?: number;
  /** On the agent's curated short list. Selection is not restricted to these. */
  recommended?: boolean;
  /** This model's provider has an API key set on the gateway. */
  configured?: boolean;
};

export type Agent = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel?: string;
  description?: string;
  defaultModel: string;
  /** Every catalog model — any model can be assigned to any role. */
  allowedModels: AllowedModel[];
  recommendedModels?: string[];
  councils?: string[];
  tier?: number;
  configured?: boolean;
};

/** Split a model list into the agent's house picks and the rest of the catalog. */
export function groupModelChoices(models: AllowedModel[], defaultModel: string) {
  const recommended = models.filter((m) => m.recommended || m.id === defaultModel);
  const rest = models.filter((m) => !recommended.includes(m));
  const byProvider: Record<string, AllowedModel[]> = {};
  for (const m of rest) {
    const key = m.provider || "other";
    (byProvider[key] ||= []).push(m);
  }
  return { recommended, byProvider };
}

/** Dropdown text — flags models whose provider has no key on the gateway. */
export function modelOptionLabel(model: AllowedModel) {
  const name = model.label || model.id;
  return model.configured === false ? `${name} · no key` : name;
}

export type TeamMode = "single" | "pipeline" | "parallel";

export type TeamSettings = {
  presetId: string;
  roles: string[];
  mode: TeamMode;
  modelOverrides: Record<string, string>;
  council: string | null;
};

export type TeamPreset = {
  id: string;
  label: string;
  roles: string[];
  mode: TeamMode;
  description: string;
  council?: string;
};

export const PROVIDERS: Record<string, { id: string; label: string; color: string }> = {
  openai: { id: "openai", label: "OpenAI", color: "#10a37f" },
  anthropic: { id: "anthropic", label: "Anthropic", color: "#d4a853" },
  grok: { id: "grok", label: "Grok (xAI)", color: "#6366f1" },
};

export const LEGACY_ALIASES: Record<string, string> = {
  code_writer: "architect",
  qc_qa: "critic",
  predictor: "prediction_engine",
  re_evaluator: "critic",
};

export function resolveAgentId(id: string, aliases = LEGACY_ALIASES) {
  return aliases[id] ?? id;
}

export function migrateRoleIds(roleIds: string[], aliases = LEGACY_ALIASES) {
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

export const FALLBACK_AGENTS: Agent[] = [
  {
    id: "architect",
    label: "Architect",
    provider: "anthropic",
    providerLabel: "Anthropic",
    description: "Designs system boundaries and build specs",
    defaultModel: "claude-sonnet-4-6",
    allowedModels: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
    ],
    councils: ["build_spec"],
    tier: 1,
  },
  {
    id: "domain_expert",
    label: "Domain Expert",
    provider: "anthropic",
    providerLabel: "Anthropic",
    description: "VIP / collectibles domain authority",
    defaultModel: "claude-sonnet-4-6",
    allowedModels: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
    ],
    councils: ["challenge", "build_spec"],
    tier: 1,
  },
  {
    id: "tester",
    label: "Tester",
    provider: "grok",
    providerLabel: "Grok",
    description: "Edge cases and acceptance tests",
    defaultModel: "grok-4.6",
    allowedModels: [
      { id: "grok-4.6", label: "Grok 4.6", provider: "grok" },
      { id: "grok-4.3", label: "Grok 4.3", provider: "grok" },
    ],
    councils: ["challenge", "build_spec"],
    tier: 1,
  },
  {
    id: "critic",
    label: "Critic",
    provider: "grok",
    providerLabel: "Grok",
    description: "Challenge assumptions, find gaps",
    defaultModel: "grok-4.6",
    allowedModels: [
      { id: "grok-4.6", label: "Grok 4.6", provider: "grok" },
      { id: "grok-4.5", label: "Grok 4.5", provider: "grok" },
    ],
    councils: ["challenge", "build_spec"],
    tier: 1,
  },
];

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: "build_spec",
    label: "Build Spec Council",
    council: "build_spec",
    roles: ["architect", "domain_expert", "tester", "critic"],
    mode: "pipeline",
    description: "Architect → domain → tester → critic veto (ADR 0003)",
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
    description: "Price, ROI, liquidity, forecast — Collection Analysis default",
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
    description: "Research → price/ROI/LIQ → challenge → synthesize",
  },
  {
    id: "solo_pm",
    label: "Solo — Project Manager",
    roles: ["project_manager"],
    mode: "single",
    description: "OpenAI plans and answers alone",
  },
  {
    id: "solo_research",
    label: "Solo — Researcher",
    roles: ["researcher"],
    mode: "single",
    description: "Anthropic analysis only",
  },
  {
    id: "solo_critic",
    label: "Solo — Critic",
    roles: ["critic"],
    mode: "single",
    description: "Grok challenge only",
  },
  {
    id: "duo_pm_research",
    label: "Duo — PM + Research",
    roles: ["project_manager", "researcher"],
    mode: "pipeline",
    description: "Plan then research",
  },
  {
    id: "duo_research_critic",
    label: "Duo — Research + Critic",
    roles: ["researcher", "critic"],
    mode: "pipeline",
    description: "Analyze then challenge",
  },
  {
    id: "full_team",
    label: "Core trio — pipeline",
    roles: ["project_manager", "researcher", "critic"],
    mode: "pipeline",
    description: "PM → Research → Critic → final",
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
    description: "High-stakes review — surfaces dissent",
  },
  {
    id: "custom",
    label: "Custom roles",
    roles: ["architect", "critic"],
    mode: "pipeline",
    description: "Pick any combination below",
  },
];

export function agentsByProvider(agents: Agent[]) {
  const map: Record<string, Agent[]> = { openai: [], anthropic: [], grok: [] };
  for (const agent of agents) {
    const key = agent.provider;
    if (!map[key]) map[key] = [];
    map[key].push(agent);
  }
  return map;
}

export function sortRoleIds(roleIds: string[], pipelineOrder: string[] = []) {
  const rank = Object.fromEntries(
    (pipelineOrder.length ? pipelineOrder : roleIds).map((r, i) => [r, i])
  );
  return [...roleIds].sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99));
}

export function agentMap(agents: Agent[]) {
  return Object.fromEntries((agents || []).map((a) => [a.id, a]));
}

export function teamSummary(roleIds: string[], mode: string, agents: Agent[] = FALLBACK_AGENTS) {
  const map = agentMap(agents);
  if (roleIds.length === 1) return map[roleIds[0]]?.label ?? roleIds[0];
  const providers = [...new Set(roleIds.map((id) => map[id]?.provider).filter(Boolean))];
  const names = providers.map((p) => PROVIDERS[p as string]?.label ?? p);
  return `${names.join(" + ")} · ${roleIds.length} agents · ${mode}`;
}

export function defaultModelOverrides(agents: Agent[], roleIds: string[]) {
  const map = agentMap(agents);
  const out: Record<string, string> = {};
  for (const id of roleIds) {
    const agent = map[id];
    if (agent?.defaultModel) out[id] = agent.defaultModel;
  }
  return out;
}
