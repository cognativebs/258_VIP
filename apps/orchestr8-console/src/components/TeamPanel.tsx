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
import {
  createAgent,
  createCouncil,
  deleteCouncil,
  fetchAgent,
  fetchAgents,
  fetchCouncils,
  updateAgent,
  updateCouncil,
  type Council,
  type Health,
} from "@/lib/orchestr8Api";

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
  const [savedCouncilId, setSavedCouncilId] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [councilName, setCouncilName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingTeam, setSavingTeam] = useState(false);

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
      const nextCouncils = councilsRes.councils || [];
      setCouncils(nextCouncils);
      setRegistryError(null);
      const match = nextCouncils.find((c) => c.custom && c.id === settings.council);
      if (match) {
        setSavedCouncilId(match.id);
        setCouncilName(match.label);
      }
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

  const applyLive = (next: TeamSettings) => {
    setDraft(next);
    saveTeamSettings(next);
    onChange(next);
  };

  const pickPreset = (presetId: string) => {
    const next = applyPreset(presetId);
    setSavedCouncilId(null);
    setAskName(false);
    setCouncilName("");
    setSaveError(null);
    applyLive({ ...next, modelOverrides: defaultModelOverrides(agents, next.roles) });
  };

  const pickCouncil = (council: Council) => {
    const roles = sortRoleIds(council.agents || [], pipelineOrder);
    const mode = council.mode === "pipeline" ? "pipeline" : "parallel";
    setSavedCouncilId(council.custom ? council.id : null);
    setAskName(Boolean(council.custom));
    setCouncilName(council.custom ? council.label : "");
    setSaveError(null);
    applyLive({
      presetId: `council_${council.id}`,
      roles,
      mode: roles.length <= 1 ? "single" : mode,
      modelOverrides: defaultModelOverrides(agents, roles),
      council: council.id,
    });
  };

  const editCouncil = (council: Council) => {
    pickCouncil(council);
    setAskName(true);
    setCouncilName(council.label);
  };

  const removeCouncil = async (council: Council) => {
    if (!council.custom) return;
    if (!window.confirm(`Delete “${council.label}”? Roles stay; only this saved team is removed.`)) {
      return;
    }
    setSaveError(null);
    try {
      await deleteCouncil(council.id);
      await loadRegistry();
      if (draft.council === council.id || savedCouncilId === council.id) {
        setSavedCouncilId(null);
        setAskName(false);
        setCouncilName("");
        setDraft((d) => ({ ...d, presetId: "custom", council: null }));
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not delete this council");
    }
  };

  const toggleRole = (roleId: string) => {
    const has = draft.roles.includes(roleId);
    let roles = has ? draft.roles.filter((r) => r !== roleId) : [...draft.roles, roleId];
    if (!roles.length) roles = [roleId];
    roles = sortRoleIds(roles, pipelineOrder);
    const mode = roles.length === 1 ? "single" : draft.mode === "single" ? "pipeline" : draft.mode;
    const modelOverrides = { ...draft.modelOverrides };
    if (!has) {
      const agent = byId[roleId];
      if (agent?.defaultModel) modelOverrides[roleId] = agent.defaultModel;
    } else {
      delete modelOverrides[roleId];
    }
    applyLive({ presetId: "custom", roles, mode, modelOverrides, council: null });
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
        applyLive({
          ...draft,
          presetId: "custom",
          council: null,
          roles: sortRoleIds([...draft.roles, id], pipelineOrder),
          modelOverrides: { ...draft.modelOverrides, [id]: created.defaultModel },
          mode: draft.mode === "single" ? "pipeline" : draft.mode,
        });
      }
    } catch (e) {
      setCreatedId(null);
      setCreateError(e instanceof Error ? e.message : "Could not create the role");
    } finally {
      setCreating(false);
    }
  };

  const setModel = (roleId: string, modelId: string) => {
    applyLive({
      ...draft,
      presetId: draft.presetId === "custom" ? "custom" : draft.presetId,
      modelOverrides: { ...draft.modelOverrides, [roleId]: modelId },
    });
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

  const persistTeam = (payload: TeamSettings) => {
    saveTeamSettings(payload);
    onChange(payload);
    onClose();
  };

  const save = async () => {
    const roles = sortRoleIds(draft.roles, pipelineOrder);
    const modelOverrides: Record<string, string> = {};
    for (const id of roles) {
      const agent = byId[id];
      const chosen = draft.modelOverrides?.[id] || agent?.defaultModel;
      if (chosen) modelOverrides[id] = chosen;
    }
    const mode: TeamSettings["mode"] = roles.length === 1 ? "single" : draft.mode;
    const persist = (councilId: string | null, presetId: string) =>
      persistTeam({
        presetId,
        roles,
        mode,
        modelOverrides,
        council: councilId,
      });

    if (savedCouncilId) {
      const name = councilName.trim();
      if (name.length < 2) {
        setAskName(true);
        setSaveError("Name the council (at least 2 characters).");
        return;
      }
      setSavingTeam(true);
      setSaveError(null);
      try {
        await updateCouncil(savedCouncilId, { name, agents: roles, mode });
        await loadRegistry();
        persist(savedCouncilId, `council_${savedCouncilId}`);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not update this council");
      } finally {
        setSavingTeam(false);
      }
      return;
    }

    if (draft.presetId === "custom") {
      const name = councilName.trim();
      if (!askName || name.length < 2) {
        setAskName(true);
        setSaveError(name.length < 2 && askName ? "Name the council (at least 2 characters)." : null);
        return;
      }
      setSavingTeam(true);
      setSaveError(null);
      try {
        const created = await createCouncil({ name, agents: roles, mode });
        await loadRegistry();
        persist(created.id, `council_${created.id}`);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not save this council");
      } finally {
        setSavingTeam(false);
      }
      return;
    }

    persist(draft.council ?? null, draft.presetId);
  };

  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="team-panel-title">
        <div className="modal-head">
          <h3 id="team-panel-title">AI team — Orchestr8</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="sub">
          Keys stay in <code>orchestr8/.env</code>. Pick a council or tick roles — the console
          roster updates immediately. Clicking the dim background does not close this panel.
          <strong> Save team</strong> only if you want a named council for later.
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
                <div key={c.id} className="council-chip">
                  <button
                    type="button"
                    className={`preset-btn ${draft.presetId === `council_${c.id}` || draft.council === c.id ? "active" : ""}`}
                    onClick={() => pickCouncil(c)}
                    title={c.purpose}
                  >
                    {c.label}
                    {c.custom ? " · custom" : ""}
                    {c.voting && c.voting !== "none" ? ` · ${c.voting}` : ""}
                  </button>
                  {c.custom ? (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={() => editCouncil(c)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => void removeCouncil(c)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
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

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <p className="dim" style={{ marginBottom: 0 }}>
            Agents · {draft.roles.length} selected
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const all = sortRoleIds(
                agents.map((a) => a.id),
                pipelineOrder
              );
              setDraft((d) => ({
                ...d,
                presetId: "council_full",
                council: "full",
                roles: all,
                mode: "pipeline",
                modelOverrides: { ...defaultModelOverrides(agents, all), ...d.modelOverrides },
              }));
            }}
          >
            Select all ({agents.length})
          </button>
        </div>
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

        {askName ? (
          <label className="field" style={{ maxWidth: 360 }}>
            <span>Council name</span>
            <input
              type="text"
              value={councilName}
              maxLength={60}
              placeholder="Grading Board"
              onChange={(e) => setCouncilName(e.target.value)}
            />
          </label>
        ) : null}
        {saveError ? <div className="banner warn">{saveError}</div> : null}

        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingTeam}
            onClick={() => void save()}
          >
            {savingTeam ? "Saving…" : askName || savedCouncilId ? "Save council" : "Save team"}
          </button>
        </div>
      </div>
    </div>
  );
}
