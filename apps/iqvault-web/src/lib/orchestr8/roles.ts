import type { Orchestr8Agent } from "./api";

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

export function migrateRoleIds(roleIds: string[], aliases = LEGACY_ALIASES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of roleIds) {
    const resolved = aliases[id] ?? id;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

export const FALLBACK_AGENTS: Orchestr8Agent[] = [
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
    defaultModel: "grok-4.6",
    allowedModels: [
      { id: "grok-4.6", label: "Grok 4.6", provider: "grok" },
      { id: "grok-4.5", label: "Grok 4.5", provider: "grok" },
    ],
    councils: ["challenge"],
    tier: 1,
  },
  {
    id: "synthesizer",
    label: "Synthesizer",
    provider: "openai",
    providerLabel: "OpenAI",
    description: "Final narrative and action list",
    defaultModel: "gpt-4.1",
    allowedModels: [{ id: "gpt-4.1", label: "GPT-4.1", provider: "openai" }],
    councils: ["execution"],
    tier: 1,
  },
];

export const TEAM_PRESETS = [
  {
    id: "comics_vip",
    label: "Comics VIP slice",
    roles: ["researcher", "investment_analyst", "pricing_agent", "liquidity_analyst", "critic", "synthesizer"],
    mode: "pipeline",
    council: null as string | null,
    description: "Research → price/ROI/LIQ → challenge → synthesize",
  },
  {
    id: "solo_research",
    label: "Solo — Researcher",
    roles: ["researcher"],
    mode: "single",
    council: null,
    description: "Anthropic analysis only",
  },
  {
    id: "duo_research_critic",
    label: "Duo — Research + Critic",
    roles: ["researcher", "critic"],
    mode: "pipeline",
    council: null,
    description: "Analyze then challenge",
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
    id: "custom",
    label: "Custom roles",
    roles: ["researcher", "critic", "synthesizer"],
    mode: "pipeline",
    council: null,
    description: "Pick any combination below",
  },
];

export function agentMap(agents: Orchestr8Agent[]): Record<string, Orchestr8Agent> {
  return Object.fromEntries(agents.map((a) => [a.id, a]));
}

export function agentsByProvider(agents: Orchestr8Agent[]): Record<string, Orchestr8Agent[]> {
  const map: Record<string, Orchestr8Agent[]> = {};
  for (const agent of agents) {
    if (!map[agent.provider]) map[agent.provider] = [];
    map[agent.provider].push(agent);
  }
  return map;
}

export function agentsByTier(agents: Orchestr8Agent[]) {
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

export function teamSummary(roleIds: string[], mode: string, agents: Orchestr8Agent[] = FALLBACK_AGENTS): string {
  const map = agentMap(agents);
  if (roleIds.length === 1) return map[roleIds[0]]?.label ?? roleIds[0];
  const providers = [...new Set(roleIds.map((id) => map[id]?.provider).filter(Boolean))];
  const names = providers.map((p) => PROVIDERS[p]?.label ?? p);
  return `${names.join(" + ")} · ${roleIds.length} agents · ${mode}`;
}

export function defaultModelOverrides(agents: Orchestr8Agent[], roleIds: string[]): Record<string, string> {
  const map = agentMap(agents);
  const out: Record<string, string> = {};
  for (const id of roleIds) {
    const agent = map[id];
    if (agent?.defaultModel) out[id] = agent.defaultModel;
  }
  return out;
}
