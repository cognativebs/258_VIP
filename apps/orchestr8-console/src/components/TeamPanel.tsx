"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TEAM_PRESETS,
  PROVIDERS,
  FALLBACK_AGENTS,
  agentsByProvider,
  sortRoleIds,
  teamSummary,
  agentMap,
  defaultModelOverrides,
  type Agent,
  type TeamSettings,
} from "@/lib/roles";
import { applyPreset, saveTeamSettings } from "@/lib/teamSettings";
import { fetchAgents, fetchCouncils, type Health } from "@/lib/orchestr8Api";

type Council = {
  id: string;
  label: string;
  purpose?: string;
  mode?: string;
  agents?: string[];
  voting?: string;
};

export function TeamPanel({
  settings,
  onChange,
  onClose,
  gatewayHealth,
}: {
  settings: TeamSettings;
  onChange: (s: TeamSettings) => void;
  onClose: () => void;
  gatewayHealth: Health | null;
}) {
  const [draft, setDraft] = useState<TeamSettings>(() => ({
    ...settings,
    roles: [...settings.roles],
    modelOverrides: { ...(settings.modelOverrides || {}) },
  }));
  const [agents, setAgents] = useState<Agent[]>(FALLBACK_AGENTS);
  const [pipelineOrder, setPipelineOrder] = useState<string[]>([]);
  const [councils, setCouncils] = useState<Council[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [agentsRes, councilsRes] = await Promise.all([
          fetchAgents(),
          fetchCouncils().catch(() => ({ councils: [] as Council[] })),
        ]);
        if (cancelled) return;
        const list: Agent[] = (agentsRes.agents?.length ? agentsRes.agents : FALLBACK_AGENTS).map(
          (a) => ({
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
          })
        );
        setAgents(list);
        setPipelineOrder(agentsRes.pipelineOrder || list.map((a) => a.id));
        setCouncils(councilsRes.councils || []);
        setRegistryError(null);
        setDraft((d) => ({
          ...d,
          modelOverrides: { ...defaultModelOverrides(list, d.roles), ...d.modelOverrides },
        }));
      } catch (e) {
        if (!cancelled) {
          setAgents(FALLBACK_AGENTS);
          setRegistryError(e instanceof Error ? e.message : "Registry unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => agentMap(agents), [agents]);
  const grouped = useMemo(() => agentsByProvider(agents), [agents]);
  const summary = teamSummary(draft.roles, draft.mode, agents);

  const pickPreset = (presetId: string) => {
    const next = applyPreset(presetId);
    setDraft({ ...next, modelOverrides: defaultModelOverrides(agents, next.roles) });
  };

  const pickCouncil = (council: Council) => {
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>AI team — Orchestr8</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="sub">
          Keys stay in <code>orchestr8/.env</code>. Pick solo / duo / committee and models per role.
        </p>

        {gatewayHealth && !gatewayHealth.ok && (
          <div className="banner warn">Orchestr8 offline — run start_orchestr8.bat</div>
        )}
        {registryError && <div className="banner warn">Registry fallback: {registryError}</div>}
        {loading && <p className="dim">Loading agent registry…</p>}

        <p className="dim" style={{ marginBottom: 8 }}>
          Quick team
        </p>
        <div className="preset-grid">
          {TEAM_PRESETS.filter((p) => p.id !== "custom").map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-btn ${draft.presetId === p.id ? "active" : ""}`}
              onClick={() => pickPreset(p.id)}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>

        {councils.length > 0 && (
          <>
            <p className="dim" style={{ marginBottom: 8 }}>
              Councils
            </p>
            <div className="preset-grid">
              {councils.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`preset-btn ${draft.presetId === `council_${c.id}` || draft.council === c.id ? "active" : ""}`}
                  onClick={() => pickCouncil(c)}
                  title={c.purpose}
                >
                  {c.label}
                  {c.voting && c.voting !== "none" ? ` · ${c.voting}` : ""}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="field" style={{ maxWidth: 280 }}>
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
            <option value="pipeline">Pipeline</option>
            <option value="parallel">Parallel</option>
          </select>
        </label>

        <p className="dim" style={{ marginBottom: 8 }}>
          Agents · {draft.roles.length} selected
        </p>
        {Object.entries(grouped).map(([provId, list]) =>
          list.length ? (
            <div key={provId} style={{ marginBottom: 16 }}>
              <div
                style={{
                  borderLeft: `3px solid ${PROVIDERS[provId]?.color || "#888"}`,
                  paddingLeft: 8,
                  marginBottom: 8,
                }}
              >
                <strong>{PROVIDERS[provId]?.label ?? provId}</strong>
                <span className="dim"> · {list.length}</span>
              </div>
              <div className="role-grid">
                {list.map((agent) => {
                  const active = draft.roles.includes(agent.id);
                  const modelId = draft.modelOverrides?.[agent.id] || agent.defaultModel;
                  const models =
                    agent.allowedModels?.length > 0
                      ? agent.allowedModels
                      : [{ id: agent.defaultModel, label: agent.defaultModel }];
                  return (
                    <div key={agent.id} className={`role-card ${active ? "active" : ""}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleRole(agent.id)}
                        />
                        <span>
                          <strong>{agent.label}</strong>
                          <small>{agent.description}</small>
                        </span>
                      </label>
                      {active && (
                        <label className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                          <span>Model</span>
                          <select value={modelId} onChange={(e) => setModel(agent.id, e.target.value)}>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label || m.id}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null
        )}

        <p className="mono dim">
          Active: {summary}
          {draft.council ? ` · council ${draft.council}` : ""}
        </p>

        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save team
          </button>
        </div>
      </div>
    </div>
  );
}
