"use client";

import { HealthBar } from "@/components/HealthBar";
import { LocalTimestampNote } from "@/components/LocalTimestampNote";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { BuildSpecPanel } from "@/components/BuildSpecPanel";
import { TeamPanel } from "@/components/TeamPanel";
import { RunsPanel } from "@/components/RunsPanel";
import { SpecsPanel } from "@/components/SpecsPanel";
import { CouncilStrip } from "@/components/CouncilStrip";
import { ProgressDock } from "@/components/ProgressDock";
import {
  CouncilSessionProvider,
  useCouncilSession,
  type ConsoleTab,
} from "@/lib/councilSession";
import { FALLBACK_AGENTS, teamSummary } from "@/lib/roles";

function ConsoleShell() {
  const {
    tab,
    setTab,
    team,
    setTeam,
    health,
    showTeam,
    setShowTeam,
    agents,
    liveKind,
    sessions,
  } = useCouncilSession();

  const teamLabel = teamSummary(team.roles, team.mode, agents.length ? agents : FALLBACK_AGENTS);

  const tabMeta: { id: ConsoleTab; label: string }[] = [
    { id: "analysis", label: "Analysis" },
    { id: "build", label: "Build Spec" },
    { id: "runs", label: "Runs" },
    { id: "specs", label: "Specs" },
  ];

  return (
    <div className={`console ${liveKind ? "has-live" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="orange">ORCHESTR8</span>
          <span className="dim">CONSOLE</span>
        </div>
        <div className="health-stack">
          <HealthBar health={health} teamLabel={teamLabel} onOpenTeam={() => setShowTeam(true)} />
          <LocalTimestampNote />
        </div>
      </header>

      <CouncilStrip />

      <nav className="tabs">
        {tabMeta.map(({ id, label }) => {
          const running = liveKind === id || (id === "analysis" && sessions.analysis.loading) || (id === "build" && sessions.build.loading);
          const hasSession =
            (id === "analysis" && (sessions.analysis.steps.length > 0 || sessions.analysis.result)) ||
            (id === "build" && (sessions.build.steps.length > 0 || sessions.build.result));
          return (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
              {running ? <span className="tab-badge live">●</span> : null}
              {!running && hasSession ? <span className="tab-badge">·</span> : null}
            </button>
          );
        })}
      </nav>

      <main className="main">
        <div className={`tab-pane ${tab === "analysis" ? "visible" : ""}`}>
          <AnalysisPanel />
        </div>
        <div className={`tab-pane ${tab === "build" ? "visible" : ""}`}>
          <BuildSpecPanel />
        </div>
        <div className={`tab-pane ${tab === "runs" ? "visible" : ""}`}>
          <RunsPanel />
        </div>
        <div className={`tab-pane ${tab === "specs" ? "visible" : ""}`}>
          <SpecsPanel />
        </div>
      </main>

      <ProgressDock />

      {showTeam && (
        <TeamPanel
          settings={team}
          onChange={setTeam}
          onClose={() => setShowTeam(false)}
          gatewayHealth={health}
        />
      )}
    </div>
  );
}

export default function ConsolePage() {
  return (
    <CouncilSessionProvider>
      <ConsoleShell />
    </CouncilSessionProvider>
  );
}
