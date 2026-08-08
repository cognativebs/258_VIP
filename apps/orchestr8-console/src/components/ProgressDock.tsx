"use client";

import { useEffect, useMemo, useState } from "react";
import {
  resolveRoleModel,
  useAgentLookup,
  useCouncilSession,
  type SessionKind,
} from "@/lib/councilSession";

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function ProgressDock() {
  const { sessions, liveKind, team, stopJob, clearSession, setTab } = useCouncilSession();
  const agents = useAgentLookup();
  const [now, setNow] = useState(Date.now());
  const [collapsed, setCollapsed] = useState(false);

  const kind: SessionKind | null =
    liveKind ||
    (sessions.build.steps.length || sessions.build.result || sessions.build.error
      ? "build"
      : sessions.analysis.steps.length || sessions.analysis.result || sessions.analysis.error
        ? "analysis"
        : null);

  const session = kind ? sessions[kind] : null;

  useEffect(() => {
    if (!session?.loading) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.loading]);

  const roleStates = useMemo(() => {
    if (!session) return [];
    const done = new Set(session.steps.map((s) => s.role).filter(Boolean) as string[]);
    return session.roles.map((roleId) => {
      const agent = agents[roleId];
      const { modelLabel } = resolveRoleModel(agent, team.modelOverrides);
      const step = [...session.steps].reverse().find((s) => s.role === roleId);
      let status: "queued" | "active" | "done" | "error" = "queued";
      if (step?.error) status = "error";
      else if (done.has(roleId)) status = "done";
      else if (session.loading && !done.has(roleId)) {
        if (session.mode === "parallel") {
          status = session.activeRole ? "active" : "queued";
        } else if (session.activeRole === roleId) {
          status = "active";
        } else {
          const firstOpen = session.roles.find((r) => !done.has(r));
          status = firstOpen === roleId ? "active" : "queued";
        }
      }
      return {
        roleId,
        label: agent?.label || roleId,
        modelLabel,
        status,
        verdict: step?.verdict,
        cost: step?.costUsd,
      };
    });
  }, [session, agents, team.modelOverrides]);

  if (!session || (!session.loading && !session.steps.length && !session.result && !session.error)) {
    return null;
  }

  const planned = Math.max(session.roles.length, 1);
  const completed = session.steps.filter((s) => s.role).length;
  // For parallel, unique roles completed
  const uniqueDone = new Set(session.steps.map((s) => s.role).filter(Boolean)).size;
  const progress = session.loading
    ? Math.min(0.95, uniqueDone / planned)
    : 1;
  const pct = Math.round(progress * 100);
  const elapsed =
    session.startedAt != null ? formatElapsed(now - session.startedAt) : "—";
  const vetoed =
    Boolean(session.result?.vote?.vetoed) ||
    session.steps.some((s) => s.verdict === "reject");

  return (
    <aside className={`progress-dock ${collapsed ? "collapsed" : ""}`}>
      <div className="progress-dock-bar">
        <button type="button" className="dock-toggle" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "▲" : "▼"}
        </button>
        <div className="dock-title">
          <strong>{kind === "build" ? "Build Spec" : "Analysis"}</strong>
          <span className="dim">
            {" "}
            · {session.loading ? "running" : vetoed ? "vetoed" : session.error ? "error" : "done"}
            {" · "}
            {elapsed}
            {typeof session.result?.usage?.costUsd === "number"
              ? ` · $${session.result.usage.costUsd.toFixed(4)}`
              : ""}
          </span>
        </div>
        <div className="dock-actions">
          {session.loading && (
            <button type="button" className="btn btn-ghost" onClick={stopJob}>
              Stop / unstick
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => kind && clearSession(kind)}
            title="Clear this session from the dock"
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setTab(kind === "build" ? "build" : "analysis")}
          >
            Open tab
          </button>
        </div>
      </div>

      {session.loading && session.progressMessage && (
        <div className="banner ok" style={{ margin: "8px 12px 0" }}>
          <strong>Now:</strong> {session.progressMessage}
          {session.steps.length === 0 ? (
            <span className="dim">
              {" "}
              (Build Spec gathers repo context before Architect replies — can take 1–3 min.)
            </span>
          ) : null}
        </div>
      )}

      <div className="progress-track" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`progress-fill ${session.loading ? "live" : vetoed ? "bad" : "ok"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="progress-meta dim mono">
        {uniqueDone}/{planned} roles · {completed} step events · {pct}%
        {session.loading && session.steps.length === 0 ? " · awaiting first SSE step" : ""}
      </div>

      {!collapsed && (
        <div className="progress-dock-body">
          <ul className="role-progress">
            {roleStates.map((r) => (
              <li key={r.roleId} className={`rp-${r.status}`}>
                <span className="rp-dot" />
                <span className="rp-label">{r.label}</span>
                <span className="rp-model dim">{r.modelLabel}</span>
                <span className="rp-status">
                  {r.status}
                  {r.verdict ? ` · ${r.verdict}` : ""}
                  {typeof r.cost === "number" ? ` · $${r.cost.toFixed(4)}` : ""}
                </span>
              </li>
            ))}
          </ul>

          <div className="highlights">
            <div className="highlights-title">Live highlights</div>
            {session.highlights.length === 0 && session.loading && (
              <p className="dim">Waiting for first role response…</p>
            )}
            {[...session.highlights].reverse().slice(0, 8).map((h) => (
              <article
                key={h.id}
                className={`highlight-card ${h.verdict === "reject" ? "reject" : ""}`}
              >
                <header>
                  <strong>{h.label}</strong>
                  {h.verdict ? <span className="pill">{h.verdict}</span> : null}
                </header>
                <p>{h.text}</p>
              </article>
            ))}
          </div>

          {session.error && <div className="banner error">{session.error}</div>}
          {session.result?.vote?.summary && (
            <div className={`banner ${vetoed ? "error" : "ok"}`}>{session.result.vote.summary}</div>
          )}
          {session.question && (
            <p className="dim dock-q">
              Q: {session.question.length > 140 ? `${session.question.slice(0, 140)}…` : session.question}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
