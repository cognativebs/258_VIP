/**
 * Persist Browse listing observations (plan 0003 P1).
 * Never writes vault_market.sale or vault_collection.holding.current_price_snapshot.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CONDITION_KEY_ANY,
  ListingObservationSchema,
  type ListingObservation,
} from "@vip/core-model";
import { markInferred } from "@vip/evidence";
import { getDb } from "../../db/client.js";
import type { CompSale, CompsAdapterResult } from "./types.js";

export const LISTING_OBSERVATION_RULE = "listing-observation@0.1.0";
export const LISTING_OBSERVATION_SOURCE = "ebay_browse" as const;

export const FORBIDDEN_PERSIST_SQL =
  /\bvault_market\.sale\b|\bcurrent_price_snapshot\b|\bUPDATE\s+vault_collection\.holding\b/i;

export type SqlExec = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

export type ListingObservationStore = {
  insertSnapshot(input: {
    source: string;
    contentType: string;
    payload: string;
    recordCount: number;
    ruleVersion: string;
  }): Promise<string | null>;
  insertObservations(rows: ListingObservation[]): Promise<number>;
  latestObservedAt(holdingSourceRowId: string): Promise<Date | null>;
};

export function assertSafePersistSql(text: string): void {
  if (FORBIDDEN_PERSIST_SQL.test(text)) {
    throw new Error(`listing_observation persist refused forbidden SQL: ${text.slice(0, 160)}`);
  }
}

export function listingIdFromSale(sale: CompSale, holdingSourceRowId: string): string {
  if (sale.listingId?.trim()) return sale.listingId.trim();
  if (sale.id.startsWith("ebay:")) return sale.id.slice("ebay:".length);
  return `${holdingSourceRowId}:${sale.id}`;
}

export function observationsFromAdapterResult(input: {
  assetId: string;
  holdingId: string | null;
  holdingSourceRowId: string;
  adapter: CompsAdapterResult;
  observedAt: Date;
  rawSnapshotId: string | null;
}): ListingObservation[] {
  const { assetId, holdingId, holdingSourceRowId, adapter, observedAt, rawSnapshotId } = input;
  const listings = adapter.sales.filter((s) => Number.isFinite(s.price) && s.price > 0);
  if (!listings.length) {
    return [
      ListingObservationSchema.parse({
        id: randomUUID(),
        createdAt: observedAt,
        updatedAt: observedAt,
        provenance: markInferred({
          source: LISTING_OBSERVATION_SOURCE,
          ruleOrModelVersion: LISTING_OBSERVATION_RULE,
          confidence: 0.2,
          notes: adapter.emptyReason ?? "no Browse listings matched",
        }),
        assetId,
        holdingId,
        holdingSourceRowId,
        conditionKey: CONDITION_KEY_ANY,
        observationKind: "browse_empty",
        source: LISTING_OBSERVATION_SOURCE,
        listingId: `empty:${holdingSourceRowId}`,
        askPrice: null,
        currency: "USD",
        observedAt,
        rawSnapshotId,
        providerIds: {},
      }),
    ];
  }
  return listings.map((sale) => {
    const listingId = listingIdFromSale(sale, holdingSourceRowId);
    return ListingObservationSchema.parse({
      id: randomUUID(),
      createdAt: observedAt,
      updatedAt: observedAt,
      provenance: markInferred({
        source: LISTING_OBSERVATION_SOURCE,
        ruleOrModelVersion: sale.provenance.ruleOrModelVersion,
        confidence: sale.provenance.confidence,
        notes: "eBay Browse listing · unverified — not a sold ledger row",
      }),
      assetId,
      holdingId,
      holdingSourceRowId,
      conditionKey: CONDITION_KEY_ANY,
      observationKind: "browse_listing",
      source: LISTING_OBSERVATION_SOURCE,
      listingId,
      askPrice: sale.price,
      currency: "USD",
      listingTitle: sale.title ?? null,
      listingUrl: sale.url ?? null,
      observedAt,
      listingCreatedAt: sale.saleDate,
      rawSnapshotId,
      providerIds: { ebay_item_id: listingId },
    });
  });
}

export function memoryListingObservationStore(): ListingObservationStore & {
  snapshots: Array<{ id: string; payload: string }>;
  observations: ListingObservation[];
  sqlLog: string[];
} {
  const snapshots: Array<{ id: string; payload: string }> = [];
  const observations: ListingObservation[] = [];
  const sqlLog: string[] = [];
  return {
    snapshots,
    observations,
    sqlLog,
    async insertSnapshot(input) {
      const id = randomUUID();
      snapshots.push({ id, payload: input.payload });
      sqlLog.push("INSERT INTO vault_evidence.raw_snapshots");
      return id;
    },
    async insertObservations(rows) {
      observations.push(...rows);
      sqlLog.push("INSERT INTO vault_market.listing_observation");
      return rows.length;
    },
    async latestObservedAt(holdingSourceRowId) {
      const hits = observations.filter((o) => o.holdingSourceRowId === holdingSourceRowId);
      if (!hits.length) return null;
      return hits.reduce((a, b) => (a.observedAt > b.observedAt ? a : b)).observedAt;
    },
  };
}

export function postgresListingObservationStore(): ListingObservationStore {
  return {
    async insertSnapshot(input) {
      const db = getDb();
      const hash = createHash("sha256").update(input.payload).digest("hex");
      const existing = await db.execute(sql`
        SELECT id FROM vault_evidence.raw_snapshots
        WHERE content_hash = ${hash}
        LIMIT 1
      `);
      const found = (existing.rows as Array<Record<string, unknown>>)[0];
      if (found) return String(found.id);

      const inserted = await db.execute(sql`
        INSERT INTO vault_evidence.raw_snapshots
          (source, content_hash, content_type, payload, byte_length, record_count,
           prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
        VALUES (
          ${input.source}, ${hash}, ${input.contentType}, ${input.payload},
          ${Buffer.byteLength(input.payload)}, ${input.recordCount},
          ${input.source}, 'observed', ${input.ruleVersion}, 1.0, 'verified'
        )
        ON CONFLICT (content_hash) DO NOTHING
        RETURNING id
      `);
      const row = (inserted.rows as Array<Record<string, unknown>>)[0];
      if (row) return String(row.id);
      const again = await db.execute(sql`
        SELECT id FROM vault_evidence.raw_snapshots
        WHERE content_hash = ${hash}
        LIMIT 1
      `);
      const reused = (again.rows as Array<Record<string, unknown>>)[0];
      return reused ? String(reused.id) : null;
    },

    async insertObservations(rows) {
      const db = getDb();
      let wrote = 0;
      for (const row of rows) {
        const result = await db.execute(sql`
          INSERT INTO vault_market.listing_observation
            (id, asset_id, holding_id, holding_source_row_id, condition_key, observation_kind,
             source, listing_id, ask_price, currency, listing_title, listing_url,
             observed_at, listing_created_at, raw_snapshot_id, provider_ids,
             prov_source, prov_method, prov_rule_version, prov_confidence,
             prov_verification, prov_notes)
          VALUES (
            ${row.id}::uuid,
            ${row.assetId}::uuid,
            ${row.holdingId}::uuid,
            ${row.holdingSourceRowId},
            ${row.conditionKey},
            ${row.observationKind},
            ${row.source},
            ${row.listingId},
            ${row.askPrice},
            ${row.currency},
            ${row.listingTitle ?? null},
            ${row.listingUrl ?? null},
            ${row.observedAt.toISOString()}::timestamptz,
            ${row.listingCreatedAt ? row.listingCreatedAt.toISOString() : null}::timestamptz,
            ${row.rawSnapshotId}::uuid,
            ${JSON.stringify(row.providerIds ?? {})}::jsonb,
            ${row.provenance.source},
            ${row.provenance.method}::vault_evidence.provenance_method,
            ${row.provenance.ruleOrModelVersion},
            ${row.provenance.confidence},
            ${row.provenance.verificationStatus}::vault_evidence.verification_status,
            ${row.provenance.notes ?? null}
          )
          ON CONFLICT (source, listing_id, observed_at) DO NOTHING
        `);
        wrote += result.rowCount ?? 0;
      }
      return wrote;
    },

    async latestObservedAt(holdingSourceRowId) {
      const db = getDb();
      const result = await db.execute(sql`
        SELECT MAX(observed_at) AS latest
        FROM vault_market.listing_observation
        WHERE holding_source_row_id = ${holdingSourceRowId}
      `);
      const raw = (result.rows as Array<Record<string, unknown>>)[0]?.latest;
      if (!raw) return null;
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? null : date;
    },
  };
}
