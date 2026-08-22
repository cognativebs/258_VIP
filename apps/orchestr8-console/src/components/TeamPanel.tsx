"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TEAM_PRESETS,
  PROVIDERS,
  FALLBACK_AGENTS,
  agentsByProvider,
  groupModelChoices,
  modelOptionLabel,
  sortRoleIds,
  teamSummary,
  agentMap,
  defaultModelOverrides,
  type Agent,
  type TeamSettings,
} from "@/lib/roles";
import { applyPreset, saveTeamSettings } from "@/lib/teamSettings";
import { createAgent, fetchAgent, fetchAgents, fetchCouncils, updateAgent, type Health } from "@/lib/orchestr8Api";

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
  const [newRole, setNewRole] = useState({ name: "", description: "", skill: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", description: "", skill: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsRes, councilsRes] = await Promise.all([
        fetchAgents(),
        fetchCouncils().catch(() => ({ councils: [] as Council[] })),
      ]);
      const list: Agent[] = (agentsRes.agents?.length ? agentsRes.agents : FALLBACK_AGENTS).map(
        (a) => ({
          id: a.id,
          label: a.label,
          provider: a.provider,
          providerLabel: a.providerLabel,
          description: a.description,
          defaultModel: a.defaultModel,
          allowedModels: a.allowedModels || [],
          recommendedModels: a.recommendedModels,
          councils: a.councils,
          tier: a.tier,
          configured: a.configured,
          custom: a.custom,
          edited: a.edited,
          verificationStatus: a.verificationStatus,
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
      return list;
    } catch (e) {
      setAgents(FALLBACK_AGENTS);
      setRegistryError(e instanceof Error ? e.message : "Registry unavailable");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

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

  const canCreate =
    newRole.name.trim().length >= 2 &&
    newRole.description.trim().length >= 10 &&
    newRole.skill.trim().length >= 20;

  /** Create the role, then reload the registry so its card renders immediately. */
  const saveNewRole = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await createAgent({
        name: newRole.name.trim(),
        description: newRole.description.trim(),
        skill: newRole.skill.trim(),
      });
      setNewRole({ name: "", description: "", skill: "" });
      setCreatedId(id);
      const list = await loadRegistry();
      const created = list?.find((a) => a.id === id);
      if (created) {
        setDraft((d) => ({
          ...d,
          presetId: "custom",
          council: null,
          roles: sortRoleIds([...d.roles, id], pipelineOrder),
          modelOverrides: { ...d.modelOverrides, [id]: created.defaultModel },
          mode: d.mode === "single" ? "pipeline" : d.mode,
        }));
      }
    } catch (e) {
      setCreatedId(null);
      setCreateError(e instanceof Error ? e.message : "Could not create the role");
    } finally {
      setCreating(false);
    }
  };

  const setModel = (roleId: string, modelId: string) => {
    setDraft((d) => ({
      ...d,
      presetId: "custom",
      modelOverrides: { ...d.modelOverrides, [roleId]: modelId },
    }));
  };

  const openEdit = async (agent: Agent) => {
    setEditingId(agent.id);
    setEditError(null);
    setEditDraft({
      name: agent.label,
      description: agent.description || "",
      skill: "",
    });
    try {
      const detail = await fetchAgent(agent.id);
      setEditDraft({
        name: detail.label,
        description: detail.description || "",
        skill: detail.skill || "",
      });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Could not load this role");
    }
  };

  const canSaveEdit =
    editDraft.name.trim().length >= 2 &&
    editDraft.description.trim().length >= 10 &&
    editDraft.skill.trim().length >= 20;

  const saveEdit = async () => {
    if (!editingId) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await updateAgent(editingId, {
        name: editDraft.name.trim(),
        description: editDraft.description.trim(),
        skill: editDraft.skill.trim(),
      });
      await loadRegistry();
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Could not save this role");
    } finally {
      setSavingEdit(false);
    }
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
                  const { recommended, byProvider } = groupModelChoices(
                    models,
                    agent.defaultModel
                  );
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
                          {agent.custom && (
                            <em
                              className="dim"
                              style={{ marginLeft: 6, fontStyle: "normal" }}
                              title="Operator-authored from this panel; not reviewed by a Build Spec council"
                            >
                              custom · {agent.verificationStatus ?? "unverified"}
                            </em>
                          )}
                          {agent.edited && (
                            <em
                              className="dim"
                              style={{ marginLeft: 6, fontStyle: "normal" }}
                              title="Local overlay of a shipped role. Git-tracked source is unchanged."
                            >
                              edited locally · {agent.verificationStatus ?? "unverified"}
                            </em>
                          )}
                          <small>{agent.description}</small>
                        </span>
                      </label>
                      <div className="role-card-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            editingId === agent.id ? setEditingId(null) : openEdit(agent)
                          }
                        >
                          {editingId === agent.id ? "Close" : "Edit"}
                        </button>
                      </div>
                      {editingId === agent.id && (
                        <div className="role-edit">
                          <label className="field">
                            <span>Name</span>
                            <input
                              type="text"
                              value={editDraft.name}
                              maxLength={60}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, name: e.target.value }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Short description</span>
                            <input
                              type="text"
                              value={editDraft.description}
                              maxLength={280}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  description: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Skills</span>
                            <textarea
                              rows={8}
                              value={editDraft.skill}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, skill: e.target.value }))
                              }
                            />
                          </label>
                          <p className="dim">
                            Id stays <code>{agent.id}</code>. Saved as a local overlay
                            under <code>orchestr8/custom_agents/</code> — shipped files
                            are not rewritten.
                          </p>
                          {editError && <div className="banner warn">{editError}</div>}
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!canSaveEdit || savingEdit}
                            onClick={saveEdit}
                          >
                            {savingEdit ? "Saving…" : "Save role"}
                          </button>
                        </div>
                      )}
                      {active && (
                        <label className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                          <span>Model</span>
                          <select value={modelId} onChange={(e) => setModel(agent.id, e.target.value)}>
                            <optgroup label="Recommended">
                              {recommended.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {modelOptionLabel(m)}
                                </option>
                              ))}
                            </optgroup>
                            {Object.entries(byProvider).map(([provId, choices]) => (
                              <optgroup
                                key={provId}
                                label={PROVIDERS[provId]?.label ?? provId}
                              >
                                {choices.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {modelOptionLabel(m)}
                                  </option>
                                ))}
                              </optgroup>
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

        <p className="dim" style={{ marginBottom: 8 }}>
          New role
        </p>
        <div style={{ marginBottom: 16 }}>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={newRole.name}
              placeholder="Reprint Scout"
              maxLength={60}
              onChange={(e) => setNewRole((r) => ({ ...r, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Short description</span>
            <input
              type="text"
              value={newRole.description}
              placeholder="Flags reprint risk before a grading spend"
              maxLength={280}
              onChange={(e) =>
                setNewRole((r) => ({ ...r, description: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Skills</span>
            <textarea
              rows={6}
              value={newRole.skill}
              placeholder="How this role thinks: mission, what it looks at, what it must never do, how it states confidence."
              onChange={(e) => setNewRole((r) => ({ ...r, skill: e.target.value }))}
            />
          </label>
          <p className="dim">
            Saved to <code>orchestr8/custom_agents/</code> with a conservative
            contract and no tools. It runs under <strong>Custom roles</strong>; pick
            its model on the new card.
          </p>
          {createError && <div className="banner warn">{createError}</div>}
          {createdId && !createError && (
            <p className="dim">
              Created <code>{createdId}</code> — its card is in the list above.
            </p>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canCreate || creating}
            onClick={saveNewRole}
          >
            {creating ? "Creating…" : "Create role"}
          </button>
        </div>

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
