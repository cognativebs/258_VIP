/** Shapes the Signals Desk reads from the VIP API (services/api/src/lib/signalsDesk.ts). */

export type DeskArticle = {
  signalId: string;
  group: string;
  domain: string;
  title: string;
  summary: string;
  type: string;
  typeName: string;
  direction: string;
  band: string | null;
  proposal: string | null;
  reporting: string | null;
  imageUrl: string | null;
  attribution: string;
  sourceKey: string;
  url: string | null;
  firstSeenAt: string;
  influence: number;
  confidence: number;
  independentSources: number;
  method: string;
  verification: string;
  thesisCount: number;
};

export type DeskBrief = {
  runId: string;
  createdAt: string;
  costUsd: number;
  vetoed: boolean;
  headline: string | null;
  summary: string | null;
  sections: { group: string; points: string[] }[];
  thesesProposed: number;
  verdicts: { thesisId: string; verdict: string; reason: string }[];
  models: string[];
  parsed: boolean;
};

export type DeskThesis = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  claim: string;
  domain: string;
  subjects: string[];
  horizonDays: number;
  expiresAt: string;
  action: string;
  withheld: { action: string; reason: string }[];
  confidence: number;
  reasons: string[];
  status: "draft" | "active" | "retired" | "invalidated";
  statusChangedAt: string | null;
  statusNote: string | null;
  orchestr8RunId: string | null;
  lastReview: { runId: string; verdict: string; reason: string; at: string } | null;
  provenance: { method: string; verification: string; ruleVersion: string };
  signals: { signalId: string; title: string; domain: string; url: string | null; firstSeenAt: string }[];
};

export type DeskSource = {
  sourceKey: string;
  name: string;
  enabled: boolean;
  /** false: SIGNALS runs without it (shown by circuit state, never counted as failing). */
  required: boolean;
  requiredNote: string | null;
  circuit: "closed" | "degraded" | "open";
  state: "ok" | "stale" | "failing" | "blocked" | "degraded" | "off";
  blockedReason: string | null;
  lastSuccessAt: string | null;
  hoursSinceSuccess: number | null;
  consecutiveFailures: number;
  failingStatus: number | null;
  nextAttemptAt: string | null;
  lastSignalAt: string | null;
};

export type DeskHealth = {
  at: string;
  summary: { enabled: number; ok: number; stale: number; failing: number; degradedOptional: number; lastIngestAt: string | null };
  sources: DeskSource[];
};

export type DeskPredictions = {
  due: { measurementId: string; predictionId: string; claim: string; confidence: number; dueAt: string }[];
  calibration: { resolved: number; pending: number; hits: number; brier: number | null; coinFlipBrier: number; note: string };
  predictions: { id: string; claim: string; confidence: number; expiresAt: string; thesisId: string | null }[];
};

export const GROUPS = ["Pokémon", "Sports", "Collectibles", "Headlines", "Markets"] as const;
/** Radar is a filter by source (GDELT 5 Web NGrams), across the domain groups. */
export const RADAR_SOURCE = "gdelt_v5_ngrams";

export function ago(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Browser calls go through the same-origin /api/vip rewrite (next.config.ts). */
export async function vipSend(path: string, method: "PATCH" | "POST", body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/vip${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
