/**
 * Circuit breaker for an optional provider channel (B1.14, operator 2026-10-17).
 *
 *   CLOSED ──429/5xx──▶ DEGRADED ──429/5xx──▶ OPEN ──probe due──▶ HALF_OPEN
 *     ▲                    │ ok                                 │ ok    │ fail
 *     └────────────────────┴────────────────────────────────────┘       ▼
 *                                                                      OPEN
 *
 * An open circuit makes no calls until the next probe (default every 6 hours),
 * then exactly one. A channel marked required: false never stops SIGNALS.
 */
import { z } from "zod";

export const CircuitStateSchema = z.enum(["closed", "degraded", "open", "half_open"]);
export type CircuitStateName = z.infer<typeof CircuitStateSchema>;

export const CircuitSchema = z
  .object({
    state: CircuitStateSchema.default("closed"),
    consecutiveFailures: z.number().int().nonnegative().default(0),
    lastSuccessAt: z.string().nullable().default(null),
    lastFailureAt: z.string().nullable().default(null),
    failureType: z.string().nullable().default(null),
    nextProbeAt: z.string().nullable().default(null),
  })
  .strict();
export type Circuit = z.infer<typeof CircuitSchema>;

export const PROBE_EVERY_MS = 6 * 3600_000;

/** Throttling and server errors trip the circuit; anything else (a 404, bad JSON) is the request's problem. */
export function isTripping(failureType: string): boolean {
  return /\b(429|5\d\d)\b/.test(failureType) || /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(failureType);
}

/** Whether a call may go out now; in OPEN only once the probe is due (and that call is the half-open probe). */
export function mayCall(c: Circuit, now: Date): { call: boolean; probe: boolean } {
  if (c.state !== "open") return { call: true, probe: c.state === "half_open" };
  const due = !c.nextProbeAt || now >= new Date(c.nextProbeAt);
  return { call: due, probe: due };
}

export function recordOutcome(c: Circuit, outcome: { ok: true } | { ok: false; failureType: string }, now: Date, probeEveryMs = PROBE_EVERY_MS): Circuit {
  if (outcome.ok) {
    return { state: "closed", consecutiveFailures: 0, lastSuccessAt: now.toISOString(), lastFailureAt: c.lastFailureAt, failureType: null, nextProbeAt: null };
  }
  if (!isTripping(outcome.failureType)) {
    return { ...c, lastFailureAt: now.toISOString(), failureType: outcome.failureType };
  }
  const n = c.consecutiveFailures + 1;
  const open = n >= 2 || c.state === "half_open" || c.state === "open";
  return {
    state: open ? "open" : "degraded",
    consecutiveFailures: n,
    lastSuccessAt: c.lastSuccessAt,
    lastFailureAt: now.toISOString(),
    failureType: outcome.failureType,
    nextProbeAt: open ? new Date(now.getTime() + probeEveryMs).toISOString() : null,
  };
}
