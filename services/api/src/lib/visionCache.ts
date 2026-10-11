import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { SCAN_VISION_RULE, VisionExtractSchema, type VisionCache } from "@vip/scan-ingest";
import { getDb } from "../db/client.js";

/**
 * Vision readings are provider responses, so they are kept as immutable raw snapshots
 * (source scan_vision, storage_ref = image-hash key). Re-identify reads the latest reading for the
 * same images instead of paying for another; a database error just means no reuse.
 */
export const VISION_SNAPSHOT_SOURCE = "scan_vision";

export function pgVisionCache(): VisionCache {
  return {
    async get(key) {
      try {
        const res = await getDb().execute(sql`
          SELECT payload FROM vault_evidence.raw_snapshots
           WHERE source = ${VISION_SNAPSHOT_SOURCE} AND storage_ref = ${key}
           ORDER BY ingested_at DESC
           LIMIT 1
        `);
        const row = (res.rows as Array<{ payload?: string }>)[0];
        if (!row?.payload) return null;
        const body = JSON.parse(row.payload) as { model?: string; extract?: unknown };
        const extract = VisionExtractSchema.safeParse(body.extract);
        return extract.success ? { extract: extract.data, model: String(body.model ?? "") } : null;
      } catch {
        return null;
      }
    },
    async put(key, value) {
      const payload = JSON.stringify({ key, model: value.model, estimatedCostUsd: value.estimatedCostUsd, extract: value.extract });
      const hash = createHash("sha256").update(payload).digest("hex");
      try {
        await getDb().execute(sql`
          INSERT INTO vault_evidence.raw_snapshots
            (source, content_hash, content_type, payload, storage_ref, byte_length, record_count,
             prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
          VALUES (
            ${VISION_SNAPSHOT_SOURCE}, ${hash}, 'application/json', ${payload}, ${key},
            ${Buffer.byteLength(payload)}, 1,
            ${value.model || VISION_SNAPSHOT_SOURCE}, 'observed', ${SCAN_VISION_RULE}, 1.0, 'unverified'
          )
          ON CONFLICT (content_hash) DO NOTHING
        `);
      } catch {
        // Saving is best effort; identification already has the reading.
      }
    },
  };
}
