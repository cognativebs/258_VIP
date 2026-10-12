import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";

/**
 * Test-only: the scan tests run against the configured Postgres, which on the operator's machine is
 * the live iqvault database. Before 2026-10-11 they left 473 batches and 157 holdings behind. Each
 * test records the batches it creates and removes exactly those (never "recent" rows: auto-intake
 * may be writing real scans at the same time).
 */
const tracked = new Set<string>();

/** One Postgres array-literal parameter (drizzle expands a JS array into a row, which won't cast). */
function pgArray(values: ReadonlyArray<string | number>): string {
  return `{${values.map((v) => String(v).replace(/[{}",\\]/g, "")).join(",")}}`;
}
let startedAt = new Date();

export function trackScanBatch(batchId: string): string {
  if (tracked.size === 0) startedAt = new Date(Date.now() - 1000);
  tracked.add(batchId);
  return batchId;
}

/** `assetsCreatedSince` overrides the run start, for clearing a run that failed before cleanup. */
export async function cleanupTrackedScanBatches(opts: { assetsCreatedSince?: Date } = {}): Promise<void> {
  if (tracked.size === 0) return;
  if (opts.assetsCreatedSince) startedAt = opts.assetsCreatedSince;
  const ids = [...tracked];
  tracked.clear();
  const db = getDb();
  const units = (
    await db.execute(sql`
      SELECT id::text AS id, holding_id::text AS holding_id, confirmed_asset_id::text AS asset_id, id_observation_ref
        FROM vault_media.scan_unit WHERE batch_id = ANY(${pgArray(ids)}::uuid[])
    `)
  ).rows as Array<{ id: string; holding_id: string | null; asset_id: string | null; id_observation_ref: string | null }>;
  const unitIds = units.map((u) => u.id);
  const holdingIds = units.map((u) => u.holding_id).filter((x): x is string => Boolean(x));
  const assetIds = [...new Set(units.map((u) => u.asset_id).filter((x): x is string => Boolean(x)))];
  const observationIds = units.map((u) => Number(u.id_observation_ref)).filter((n) => Number.isFinite(n) && n > 0);

  if (observationIds.length) {
    await db.execute(sql`DELETE FROM vault_market.id_observation WHERE id = ANY(${pgArray(observationIds)}::bigint[])`);
  }
  await db.execute(sql`
    DELETE FROM vault_collection.holding
     WHERE id = ANY(${pgArray(holdingIds)}::uuid[]) OR source_row_id = ANY(${pgArray(unitIds)}::text[])
  `);
  const sessions = (
    await db.execute(sql`SELECT DISTINCT session_id::text AS id FROM vault_media.scan_batch WHERE id = ANY(${pgArray(ids)}::uuid[])`)
  ).rows as Array<{ id: string }>;
  const sessionIds = sessions.map((s) => s.id);
  await db.execute(sql`DELETE FROM vault_media.capture_image WHERE session_id = ANY(${pgArray(sessionIds)}::uuid[])`);
  await db.execute(sql`DELETE FROM vault_media.scan_batch WHERE id = ANY(${pgArray(ids)}::uuid[])`);
  await db.execute(sql`
    DELETE FROM vault_media.capture_session ss
     WHERE ss.id = ANY(${pgArray(sessionIds)}::uuid[])
       AND NOT EXISTS (SELECT 1 FROM vault_media.scan_batch sb WHERE sb.session_id = ss.id)
  `);
  // Only assets this test run created and nothing else holds.
  for (const assetId of assetIds) {
    try {
      await db.execute(sql`
        DELETE FROM vault_core.asset a
         WHERE a.id = ${assetId}::uuid AND a.created_at >= ${startedAt.toISOString()}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM vault_collection.holding h WHERE h.asset_id = a.id)
      `);
    } catch {
      // Still referenced (e.g. a NO ACTION link): keep it rather than force anything.
    }
  }
}
