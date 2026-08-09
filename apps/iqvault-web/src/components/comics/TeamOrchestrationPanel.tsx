"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TEAM_PRESETS,
  PROVIDERS,
  FALLBACK_AGENTS,
  agentsByProvider,
  agentsByTier,
  sortRoleIds,
  teamSummary,
  agentMap,
  defaultModelOverrides,
  type AgentInfo,
} from "@/lib/orchestr8Roles";
import { applyPreset, saveTeamSettings, type TeamSettings } from "@/lib/orchestr8TeamSettings";
import {
  fetchOrchestr8Agents,
  fetchOrchestr8Councils,
  type CouncilInfo,
  type Orchestr8Health,
} from "@/lib/orchestr8Api";

export function TeamOrchestrationPanel({
  settings,
  onChange,
  onClose,
  gatewayHealth,
}: {
  settings: TeamSettings;
  onChange: (next: TeamSettings) => void;
  onClose: () => void;
  gatewayHealth: Orchestr8Health | null;
}) {
  const [draft, setDraft] = useState<TeamSettings>(() => ({
    ...settings,
    roles: [...settings.roles],
    modelOverrides: { ...(settings.modelOverrides || {}) },
  }));
  const [agents, setAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS);
  const [pipelineOrder, setPipelineOrder] = useState<string[]>([]);
  const [councils, setCouncils] = useState<CouncilInfo[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [loadingRegistry, setLoadingRegistry] = useState(true);
  const [groupBy, setGroupBy] = useState<"provider" | "tier">("provider");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingRegistry(true);
      try {
        const [agentsRes, councilsRes] = await Promise.all([
          fetchOrchestr8Agents(),
          fetchOrchestr8Councils().catch(() => ({ councils: [] as CouncilInfo[] })),
        ]);
        if (cancelled) return;
        const list = agentsRes.agents?.length ? agentsRes.agents : FALLBACK_AGENTS;
        setAgents(list);
        setPipelineOrder(agentsRes.pipelineOrder || list.map((a) => a.id));
        setCouncils(councilsRes.councils || []);
        setRegistryError(null);
        setDraft((d) => {
          const defaults = defaultModelOverrides(list, d.roles);
          return {
            ...d,
            modelOverrides: { ...defaults, ...d.modelOverrides },
          };
        });
      } catch (e) {
        if (!cancelled) {
          setAgents(FALLBACK_AGENTS);
          setRegistryError(e instanceof Error ? e.message : "Could not load agent registry");
        }
      } finally {
        if (!cancelled) setLoadingRegistry(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => agentMap(agents), [agents]);
  const grouped = useMemo(() => agentsByProvider(agents), [agents]);
  const tiers = useMemo(() => agentsByTier(agents), [agents]);
  const summary = teamSummary(draft.roles, draft.mode, agents);
  const providerCount = new Set(draft.roles.map((id) => byId[id]?.provider).filter(Boolean)).size;

  const pickPreset = (presetId: string) => {
    const next = applyPreset(presetId);
    const defaults = defaultModelOverrides(agents, next.roles);
    setDraft({ ...next, modelOverrides: defaults });
  };

  const pickCouncil = (council: CouncilInfo) => {
    const roles = sortRoleIds(council.agents || [], pipelineOrder);
    const mode = council.mode === "pipeline" ? "pipeline" : "parallel";
    setDraft({
      presetId: `council_${council.id}`,
      roles,
      mode: roles.length <= 1 ? "single" : mode,
      modelOverrides: defaultModelOverrides(agents, roles),
      council: council.id,
    });
  };

  const toggleRole = (roleId: string) => {
    setDraft((d) => {
      const has = d.roles.includes(roleId);
      let roles = has ? d.roles.filter((r) => r !== roleId) : [...d.roles, roleId];
      if (!roles.length) roles = [roleId];
      roles = sortRoleIds(roles, pipelineOrder);
      const mode = roles.length === 1 ? "single" : d.mode === "single" ? "pipeline" : d.mode;
      const modelOverrides = { ...d.modelOverrides };
      if (!has) {
        const agent = byId[roleId];
        if (agent?.defaultModel) modelOverrides[roleId] = agent.defaultModel;
      } else {
        delete modelOverrides[roleId];
      }
      return { presetId: "custom", roles, mode, modelOverrides, council: null };
    });
  };

  const setModel = (roleId: string, modelId: string) => {
    setDraft((d) => ({
      ...d,
      presetId: "custom",
      modelOverrides: { ...d.modelOverrides, [roleId]: modelId },
    }));
  };

  const save = () => {
    const roles = sortRoleIds(draft.roles, pipelineOrder);
    const modelOverrides: Record<string, string> = {};
    for (const id of roles) {
      const agent = byId[id];
      const chosen = draft.modelOverrides?.[id] || agent?.defaultModel;
      if (chosen) modelOverrides[id] = chosen;
    }
    const payload: TeamSettings = {
      presetId: draft.presetId,
      roles,
      mode: roles.length === 1 ? "single" : draft.mode,
      modelOverrides,
      council: draft.council ?? null,
    };
    saveTeamSettings(payload);
    onChange(payload);
    onClose();
  };

  const renderAgentChip = (agent: AgentInfo) => {
    const active = draft.roles.includes(agent.id);
    const modelId = draft.modelOverrides?.[agent.id] || agent.defaultModel;
    const models =
      agent.allowedModels?.length
        ? agent.allowedModels
        : [{ id: agent.defaultModel || "", label: agent.defaultModel || agent.id, provider: agent.provider }];

    return (
      <div
        key={agent.id}
        className={`bb-team-role-chip bb-team-role-card ${active ? "active" : ""}`}
      >
        <label className="bb-team-role-toggle">
          <input type="checkbox" checked={active} onChange={() => toggleRole(agent.id)} />
          <span>
            <strong>{agent.label}</strong>
            <small>{agent.description}</small>
          </span>
        </label>
        {active ? (
          <label className="bb-team-model-field">
            <span>Model</span>
            <select value={modelId} onChange={(e) => setModel(agent.id, e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                  {m.provider && m.provider !== agent.provider ? ` (${m.provider})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    );
  };

  return (
    <div className="bb-settings-overlay" onClick={onClose}>
      <div
        className="bb-settings-modal bb-team-modal bb-team-modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bb-settings-head">
          <h3>AI team - Orchestr8</h3>
          <button type="button" className="bb-settings-close" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="bb-settings-intro">
          Agents and models load from Orchestr8. Keys stay in <code>orchestr8/.env</code>. Pick
          roles and which model each one uses.
        </p>

        {gatewayHealth && !gatewayHealth.ok ? (
          <div className="bb-team-warn">
            Orchestr8 offline - run <code>start_orchestr8.bat</code> or Launch IQVault.bat
          </div>
        ) : null}
        {registryError ? <div className="bb-team-warn">Registry fallback: {registryError}</div> : null}
        {loadingRegistry ? <p className="bb-dim">Loading agent registry…</p> : null}

        {gatewayHealth?.providers ? (
          <div className="bb-team-provider-status">
            {Object.entries(gatewayHealth.providers).map(([id, ok]) => (
              <span key={id} className={`bb-team-prov ${ok ? "ok" : "missing"}`}>
                {PROVIDERS[id]?.label ?? id}: {ok ? "ready" : "no key"}
              </span>
            ))}
          </div>
        ) : null}

        <div className="bb-team-presets">
          <p className="bb-settings-keys-title">Quick team</p>
          <div className="bb-preset-grid">
            {TEAM_PRESETS.filter((p) => p.id !== "custom").map((p) => (
              <button
                key={p.id}
                type="button"
                className={`bb-preset-btn ${draft.presetId === p.id ? "active" : ""}`}
                onClick={() => pickPreset(p.id)}
                title={p.description}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {councils.length > 0 ? (
          <div className="bb-team-presets">
            <p className="bb-settings-keys-title">Councils</p>
            <div className="bb-preset-grid">
              {councils.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`bb-preset-btn ${draft.presetId === `council_${c.id}` ? "active" : ""}`}
                  onClick={() => pickCouncil(c)}
                  title={`${c.purpose ?? ""}${c.voting && c.voting !== "none" ? ` · voting: ${c.voting}` : ""}`}
                >
                  {c.label}
                  {c.voting === "veto_on_critical" ? (
                    <span className="bb-vote-badge veto">veto</span>
                  ) : null}
                  {c.voting === "dissent_required" ? (
                    <span className="bb-vote-badge dissent">dissent</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="bb-team-toolbar">
          <label className="bb-settings-field">
            <span>Execution mode</span>
            <select
              value={draft.mode}
              disabled={draft.roles.length <= 1}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  presetId: "custom",
                  mode: e.target.value as TeamSettings["mode"],
                }))
              }
            >
              <option value="single">Single role</option>
              <option value="pipeline">Pipeline (hand off in order)</option>
              <option value="parallel">Parallel (then synthesize)</option>
            </select>
          </label>
          <label className="bb-settings-field">
            <span>Group agents</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as "provider" | "tier")}
            >
              <option value="provider">By provider</option>
              <option value="tier">By tier (core / VIP)</option>
            </select>
          </label>
        </div>

        <div className="bb-team-roles">
          <p className="bb-settings-keys-title">
            Agents · model picker {draft.roles.length ? `(${draft.roles.length} selected)` : ""}
          </p>

          {groupBy === "provider"
            ? Object.entries(grouped).map(([provId, list]) =>
                list.length ? (
                  <div key={provId} className="bb-team-provider-block">
                    <div
                      className="bb-team-provider-head"
                      style={{ borderColor: PROVIDERS[provId]?.color }}
                    >
                      <strong>{PROVIDERS[provId]?.label ?? provId}</strong>
                      <span className="bb-dim">{list.length} agents</span>
                    </div>
                    <div className="bb-team-role-grid bb-team-role-grid-cards">
                      {list.map(renderAgentChip)}
                    </div>
                  </div>
                ) : null,
              )
            : (
              <>
                {tiers.tier1.length > 0 ? (
                  <div className="bb-team-provider-block">
                    <div className="bb-team-provider-head">
                      <strong>Tier 1 - Core</strong>
                      <span className="bb-dim">{tiers.tier1.length}</span>
                    </div>
                    <div className="bb-team-role-grid bb-team-role-grid-cards">
                      {tiers.tier1.map(renderAgentChip)}
                    </div>
                  </div>
                ) : null}
                {tiers.tier9.length > 0 ? (
                  <div className="bb-team-provider-block">
                    <div className="bb-team-provider-head">
                      <strong>Tier 9 - VIP / collectibles</strong>
                      <span className="bb-dim">{tiers.tier9.length}</span>
                    </div>
                    <div className="bb-team-role-grid bb-team-role-grid-cards">
                      {tiers.tier9.map(renderAgentChip)}
                    </div>
                  </div>
                ) : null}
              </>
            )}
        </div>

        <div className="bb-team-summary">
          <span>Active:</span> {summary}
          <span className="bb-dim">
            {" "}
            · {providerCount} provider{providerCount !== 1 ? "s" : ""}
          </span>
          {draft.council ? (
            <span className="bb-dim">
              {" "}
              · council: {draft.council}
              {(() => {
                const c = councils.find((x) => x.id === draft.council);
                return c?.voting && c.voting !== "none" ? ` (${c.voting})` : "";
              })()}
            </span>
          ) : null}
          {draft.roles.length > 0 ? (
            <div className="bb-team-model-summary">
              {draft.roles.map((id) => {
                const agent = byId[id];
                const mid = draft.modelOverrides?.[id] || agent?.defaultModel;
                const mlabel =
                  agent?.allowedModels?.find((m) => m.id === mid)?.label || mid;
                return (
                  <span key={id} className="bb-team-model-pill">
                    {agent?.label ?? id}: {mlabel}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="bb-settings-actions">
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bb-btn bb-btn-analytics" onClick={save}>
            Save team
          </button>
        </div>
      </div>
    </div>
  );
}
