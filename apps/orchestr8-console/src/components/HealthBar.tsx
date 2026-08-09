"use client";

import type { Health } from "@/lib/orchestr8Api";

export function HealthBar({
  health,
  teamLabel,
  onOpenTeam,
}: {
  health: Health | null;
  teamLabel: string;
  onOpenTeam: () => void;
}) {
  const providers = health?.providers || {};
  const status =
    health == null ? "checking" : health.ok ? "online" : "offline";
  return (
    <div className="health">
      <span className={`pill ${status === "online" ? "ok" : status === "checking" ? "" : "bad"}`}>
        gateway {status}
      </span>
      {Object.entries(providers).map(([id, ok]) => (
        <span key={id} className={`pill ${ok ? "ok" : "bad"}`}>
          {id}: {ok ? "key" : "no key"}
        </span>
      ))}
      <span className="pill">{teamLabel}</span>
      <button type="button" className="btn btn-ghost" onClick={onOpenTeam}>
        AI team
      </button>
    </div>
  );
}
