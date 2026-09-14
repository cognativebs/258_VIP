/**
 * Daily PriceCharting guide history. Not a sale. Not a current_price column.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  GUIDE_CONDITION_LOOSE,
  GUIDE_SNAPSHOT_RULE,
  GuidePriceObservationSchema,
  chicagoSnapshotOn,
  type GuidePriceObservation,
} from "@vip/core-model";
import { markInferred } from "@vip/evidence";
import { getDb } from "../../db/client.js";
import type { ListingObservation } from "./listingObservation.js";

export { chicagoSnapshotOn, GUIDE_CONDITION_LOOSE, GUIDE_SNAPSHOT_RULE };

export type GuideSnapshotStore = {
  hasSnapshot(holdingSourceRowId: string, snapshotOn: string): Promise<boolean>;
  upsert(rows: GuidePriceObservation[]): Promise<number>;
};

export function guideRowsFromLiveObservations(input: {
  assetId: string;
  holdingId: string;
  holdingSourceRowId: string;
  observations: ListingObservation[];
  observedAt: Date;
}): GuidePriceObservation[] {
  const snapshotOn = chicagoSnapshotOn(input.observedAt);
  const guides = input.observations.filter(
    (o) => o.observationKind === "guide_quote" || o.observationKind === "guide_empty",
  );
  const pick =
    guides.find((o) => o.observationKind === "guide_quote") ?? guides[0] ?? null;
  if (!pick) return [];

  const quote = pick.observationKind === "guide_quote";
  return [
    GuidePriceObservationSchema.parse({
      id: randomUUID(),
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
      provenance: markInferred({
        source: "pricecharting",
        ruleOrModelVersion: GUIDE_SNAPSHOT_RULE,
        confidence: 0.6,
        notes: quote
          ? "PriceCharting loose/ungraded guide · vendor_derived · unverified — daily snapshot, not a sold"
          : pick.provenance.notes ?? "PriceCharting guide empty · vendor_derived · unverified",
      }),
      assetId: input.assetId,
      holdingId: input.holdingId,
      holdingSourceRowId: input.holdingSourceRowId,
      pricedUnitId: null,
      conditionKey: GUIDE_CONDITION_LOOSE,
      snapshotOn,
      observedAt: input.observedAt,
      observationKind: quote ? "guide_quote" : "guide_empty",
      source: "pricecharting",
      evidenceClass: "vendor_derived",
      guidePrice: quote ? pick.askPrice : null,
      currency: pick.currency ?? "USD",
      rawSnapshotId: pick.rawSnapshotId ?? null,
      providerIds: pick.providerIds ?? {},
    }),
  ];
}

export function memoryGuideSnapshotStore(): GuideSnapshotStore & {
  rows: GuidePriceObservation[];
} {
  const rows: GuidePriceObservation[] = [];
  return {
    rows,
    async hasSnapshot(holdingSourceRowId, snapshotOn) {
      return rows.some(
        (r) => r.holdingSourceRowId === holdingSourceRowId && r.snapshotOn === snapshotOn,
      );
    },
    async upsert(next) {
      let wrote = 0;
      for (const row of next) {
        const idx = rows.findIndex(
          (r) =>
            r.holdingSourceRowId === row.holdingSourceRowId &&
            r.conditionKey === row.conditionKey &&
            r.source === row.source &&
            r.snapshotOn === row.snapshotOn,
        );
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
        wrote += 1;
      }
      return wrote;
    },
  };
}

export function postgresGuideSnapshotStore(): GuideSnapshotStore {
  return {
    async hasSnapshot(holdingSourceRowId, snapshotOn) {
      const db = getDb();
      const result = await db.execute(sql`
        SELECT 1
          FROM vault_market.guide_price_observation
         WHERE holding_source_row_id = ${holdingSourceRowId}
           AND snapshot_on = ${snapshotOn}::date
           AND source = 'pricecharting'
         LIMIT 1
      `);
      return (result.rows as unknown[]).length > 0;
    },

    async upsert(rows) {
      const db = getDb();
      let wrote = 0;
      for (const row of rows) {
        const result = await db.execute(sql`
          INSERT INTO vault_market.guide_price_observation (
            id, asset_id, holding_id, holding_source_row_id, priced_unit_id,
            condition_key, snapshot_on, observed_at, observation_kind, source,
            data_source_id, evidence_class, guide_price, currency, raw_snapshot_id,
            provider_ids, prov_source, prov_method, prov_rule_version,
            prov_confidence, prov_verification, prov_notes
          )
          VALUES (
            ${row.id}::uuid,
            ${row.assetId}::uuid,
            ${row.holdingId}::uuid,
            ${row.holdingSourceRowId},
            ${row.pricedUnitId}::uuid,
            ${row.conditionKey},
            ${row.snapshotOn}::date,
            ${row.observedAt.toISOString()}::timestamptz,
            ${row.observationKind},
            ${row.source},
            (SELECT data_source_id FROM vault_market.data_source WHERE source_key = 'pricecharting'),
            ${row.evidenceClass},
            ${row.guidePrice},
            ${row.currency},
            ${row.rawSnapshotId}::uuid,
            ${JSON.stringify(row.providerIds ?? {})}::jsonb,
            ${row.provenance.source},
            ${row.provenance.method}::vault_evidence.provenance_method,
            ${row.provenance.ruleOrModelVersion},
            ${row.provenance.confidence},
            ${row.provenance.verificationStatus}::vault_evidence.verification_status,
            ${row.provenance.notes ?? null}
          )
          ON CONFLICT (holding_source_row_id, condition_key, source, snapshot_on)
          DO UPDATE SET
            observed_at = EXCLUDED.observed_at,
            observation_kind = EXCLUDED.observation_kind,
            guide_price = EXCLUDED.guide_price,
            raw_snapshot_id = EXCLUDED.raw_snapshot_id,
            provider_ids = EXCLUDED.provider_ids,
            prov_notes = EXCLUDED.prov_notes,
            ingested_at = now()
        `);
        wrote += result.rowCount ?? 0;
      }
      return wrote;
    },
  };
}
