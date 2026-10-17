/**
 * Mirrors a provider channel's circuit into vault_signals.source_fetch_state so the Signal Desk can
 * show each channel's health (B1.15): consecutive_failures 0 = closed, 1 = degraded, 2+ = open;
 * next_attempt_at = the next probe; last_status = the HTTP status that tripped it. The job's own
 * cursor file stays authoritative; this row is for reading.
 */
import type { Circuit } from "@vip/signals";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function saveCircuitState(db: Queryable, sourceId: string, url: string, c: Circuit, status: number | null, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO vault_signals.source_fetch_state
       (source_id, url, last_status, last_fetched_at, last_success_at, consecutive_failures, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_id, url) DO UPDATE SET
       last_status = coalesce(EXCLUDED.last_status, vault_signals.source_fetch_state.last_status),
       last_fetched_at = EXCLUDED.last_fetched_at,
       last_success_at = coalesce(EXCLUDED.last_success_at, vault_signals.source_fetch_state.last_success_at),
       consecutive_failures = EXCLUDED.consecutive_failures,
       next_attempt_at = EXCLUDED.next_attempt_at`,
    [sourceId, url, status, now.toISOString(), c.lastSuccessAt, c.consecutiveFailures, c.nextProbeAt],
  );
}
