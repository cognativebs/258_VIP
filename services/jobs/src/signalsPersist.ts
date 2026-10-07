import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const SIGNALS_PERSIST_VERSION = "signals-persist@0.1.0";

export type PersistableSignal = {
  id: string;
  sourceId: string;
  signalType: "news" | "market" | "supply" | "retail" | "reprint" | "auction";
  title?: string;
  body: string;
  signalDate: string;
  noveltyScore: number | null;
  quarantineStatus: "active" | "quarantined" | "rejected";
  sourceUrl?: string | null;
  ruleVersion: string;
};

export type SignalsPersistReport = {
  attempted: number;
  insertedRaw: number;
  duplicates: number;
  normalized: number;
  errors: string[];
};

/**
 * Write job-feed signals into vault_core.signals_raw / signals_normalized.
 * Idempotent on (source_id, payload_sha256). Never overwrites a raw row.
 * Phase 2 scoring stays off even after this writes — confirmation is separate.
 */
export async function persistSignalsToVault(
  pool: Pool,
  signals: PersistableSignal[],
): Promise<SignalsPersistReport> {
  const report: SignalsPersistReport = {
    attempted: signals.length,
    insertedRaw: 0,
    duplicates: 0,
    normalized: 0,
    errors: [],
  };

  for (const signal of signals) {
    const payload = {
      feedId: signal.id,
      sourceId: signal.sourceId,
      signalType: signal.signalType,
      title: signal.title ?? null,
      body: signal.body,
      signalDate: signal.signalDate,
      noveltyScore: signal.noveltyScore,
      quarantineStatus: signal.quarantineStatus,
      sourceUrl: signal.sourceUrl ?? null,
      ruleVersion: signal.ruleVersion,
    };
    const sha = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    try {
      const raw = await pool.query<{ id: string }>(
        `INSERT INTO vault_core.signals_raw
           (source_id, payload_sha256, payload, ingest_status)
         VALUES ($1, $2, $3::jsonb, 'complete')
         ON CONFLICT (source_id, payload_sha256) DO NOTHING
         RETURNING id`,
        [signal.sourceId, sha, JSON.stringify(payload)],
      );
      if (raw.rowCount === 0) {
        report.duplicates += 1;
        continue;
      }
      report.insertedRaw += 1;
      const rawId = raw.rows[0]?.id;
      if (!rawId) continue;

      const evidenceClass =
        signal.signalType === "market" || signal.signalType === "auction"
          ? "inferred"
          : "inferred";

      await pool.query(
        `INSERT INTO vault_core.signals_normalized
           (raw_id, source_id, signal_type, title, body, signal_date,
            novelty_score, quarantine_status, evidence_class, rule_version,
            verification_status, source_url)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, 'unverified', $11)
         ON CONFLICT (raw_id) DO NOTHING`,
        [
          rawId,
          signal.sourceId,
          signal.signalType,
          signal.title ?? null,
          signal.body,
          signal.signalDate,
          signal.noveltyScore,
          signal.quarantineStatus,
          evidenceClass,
          signal.ruleVersion,
          signal.sourceUrl ?? null,
        ],
      );
      report.normalized += 1;
    } catch (err) {
      report.errors.push(
        `${signal.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return report;
}
