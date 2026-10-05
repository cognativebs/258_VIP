/**
 * Is a running council healthy? The gateway sends a heartbeat every ~5s while
 * a job runs (what is in flight, what finished, spend so far). Health is read
 * from how long ago the last one arrived — a slow model call keeps beating, a
 * dead gateway or dropped connection goes silent.
 */

export type HeartbeatCall = {
  role: string;
  label: string;
  provider: string;
  model: string;
  attempt: number;
  timeoutS: number;
  seconds: number;
};

export type Heartbeat = {
  elapsedS: number;
  inFlight: HeartbeatCall[];
  done: { role: string; label: string; seconds: number; costUsd: number; outputTokens: number; error: boolean }[];
  modelCalls: number;
  spentUsd: number;
  cancelled: boolean;
};

export type JobHealthLevel = "connecting" | "ok" | "slow" | "silent" | "no_heartbeat";

/** Heartbeats every 5s: 15s without one is late, 30s is silent. */
export const HEARTBEAT_LATE_MS = 15_000;
export const HEARTBEAT_SILENT_MS = 30_000;

export function jobHealth(args: {
  now: number;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
}): { level: JobHealthLevel; text: string } {
  const { now, startedAt, lastHeartbeatAt } = args;
  if (lastHeartbeatAt == null) {
    const waited = startedAt == null ? 0 : now - startedAt;
    if (waited < HEARTBEAT_LATE_MS) return { level: "connecting", text: "Connecting — waiting for the gateway's first heartbeat…" };
    return {
      level: "no_heartbeat",
      text: `No heartbeat after ${Math.round(waited / 1000)}s. If the gateway was started before this update, restart it; otherwise it is not responding — Stop.`,
    };
  }
  const ago = now - lastHeartbeatAt;
  const s = Math.round(ago / 1000);
  if (ago >= HEARTBEAT_SILENT_MS) {
    return { level: "silent", text: `Gateway silent for ${s}s — it may have crashed or the connection dropped. Stop, then retry.` };
  }
  if (ago >= HEARTBEAT_LATE_MS) return { level: "slow", text: `Heartbeat late (${s}s ago) — watching…` };
  return { level: "ok", text: `Healthy · gateway heartbeat ${s}s ago` };
}

/** "Researcher · Anthropic Claude Sonnet · waiting on the model 42s (times out at 192s)". */
export function describeCall(c: HeartbeatCall, extraS = 0): string {
  const secs = Math.round(c.seconds + extraS);
  const retry = c.attempt > 1 ? ` · retry ${c.attempt - 1}` : "";
  return `${c.label} · ${c.provider} ${c.model} · waiting on the model ${secs}s (times out at ${c.timeoutS}s)${retry}`;
}
