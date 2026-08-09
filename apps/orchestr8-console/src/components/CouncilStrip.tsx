"use client";

import { useState } from "react";
import {
  resolveRoleModel,
  useAgentLookup,
  useCouncilSession,
} from "@/lib/councilSession";

export function CouncilStrip() {
  const { effectiveRoster, team, liveKind } = useCouncilSession();
  const agents = useAgentLookup();
  const [skillRole, setSkillRole] = useState<string | null>(null);

  const skillAgent = skillRole ? agents[skillRole] : null;

  return (
    <section className="council-strip">
      <div className="council-strip-head">
        <div>
          <span className="council-kicker">
            {liveKind ? `LIVE · ${liveKind}` : "ACTIVE ROSTER"}
          </span>
          <strong className="council-name">{effectiveRoster.councilLabel}</strong>
          <span className="dim">
            {" "}
            · {effectiveRoster.mode}
            {effectiveRoster.voting ? ` · ${effectiveRoster.voting}` : ""}
            {effectiveRoster.source !== "team" && effectiveRoster.source !== "live"
              ? ` · ${effectiveRoster.source}`
              : ""}
          </span>
        </div>
        {effectiveRoster.purpose && (
          <p className="council-purpose">{effectiveRoster.purpose}</p>
        )}
      </div>

      <div className="role-chips">
        {effectiveRoster.roles.map((roleId) => {
          const agent = agents[roleId];
          const { modelId, modelLabel } = resolveRoleModel(agent, team.modelOverrides);
          const active = skillRole === roleId;
          return (
            <button
              key={roleId}
              type="button"
              className={`role-chip ${active ? "on" : ""}`}
              onClick={() => setSkillRole(active ? null : roleId)}
              title={agent?.description || roleId}
            >
              <span className="role-chip-name">{agent?.label || roleId}</span>
              <span className="role-chip-meta">
                {agent?.providerLabel || agent?.provider || "?"} · {modelLabel}
              </span>
              <span className="role-chip-model mono">{modelId}</span>
            </button>
          );
        })}
        {!effectiveRoster.roles.length && (
          <span className="dim">No roles selected — open AI team</span>
        )}
      </div>

      {skillAgent && (
        <div className="skill-panel">
          <div className="skill-panel-head">
            <strong>{skillAgent.label}</strong>
            <span className="dim">
              {" "}
              · skill / mission · {skillAgent.providerLabel || skillAgent.provider}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setSkillRole(null)}>
              Close
            </button>
          </div>
          <p>{skillAgent.description || "No skill description from gateway."}</p>
          {skillAgent.councils?.length ? (
            <p className="dim mono">councils: {skillAgent.councils.join(", ")}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
