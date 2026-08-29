import { sql } from "drizzle-orm";
import { comicsDsn, getDb, redactDsn } from "../db/client.js";
import { mapInventoryRow, type ApiHolding, type ExternalIdRef } from "./holdings.js";
import { loadAllLiveRanges } from "./liveRange.js";

/**
 * The real comics collection, read from Postgres.
 *
 * `holding.clz_metadata` stores the full CLZ row as imported, and the holding
 * columns carry anything edited since. We overlay the columns onto the stored
 * row and hand the result to the same mapper the seed files use, so there is
 * one holding shape in the platform rather than one per data source.
 */

export type SnapshotInfo = {
  id: string;
  contentHash: string;
  shortHash: string;
  ingestedAt: string;
  recordCount: number | null;
  ageDays: number;
  label: string;
};

export type ComicsPayload = {
  available: boolean;
  holdings: ApiHolding[];
  snapshot: SnapshotInfo | null;
  error: string | null;
  dsn: string;
};

const HOLDINGS_SQL = sql`
  SELECT
      h.source_row_id,
      h.quantity,
      h.purchase_price,
      h.location,
      h.slab_status,
      h.assumed_grade,
      h.grade_rating,
      h.collection_pillar,
      h.inventory_bucket,
      h.inventory_bucket_source,
      h.museum_score,
      h.investment_score,
      h.liquidity_score,
      h.recommendation,
      h.sell_priority,
      h.upgrade_candidate,
      h.needs_grading,
      h.needs_photo,
      h.needs_verification,
      h.verification_notes,
      h.current_price_snapshot,
      h.clz_metadata,
      h.raw_snapshot_id,
      a.canonical_name,
      a.primary_image_url,
      s.title       AS series_title,
      s.publisher,
      i.issue_number,
      i.is_key_issue,
      i.key_reason,
      v.cover_label,
      COALESCE(
        (
          SELECT json_agg(json_build_object('source', e.source, 'externalValue', e.external_value))
          FROM vault_core.external_id e
          WHERE e.asset_id = a.id
        ),
        '[]'::json
      ) AS external_ids
  FROM vault_collection.holding h
  JOIN vault_core.asset a   ON a.id = h.asset_id
  JOIN vault_comic.variant v ON v.asset_id = a.id
  JOIN vault_comic.issue i   ON i.id = v.issue_id
  JOIN vault_comic.series s  ON s.id = i.series_id
  WHERE h.source = 'clz_import'
  ORDER BY s.title, i.issue_number, v.cover_label
`;

const SNAPSHOT_SQL = sql`
  SELECT id, content_hash, ingested_at, record_count, storage_ref
  FROM vault_evidence.raw_snapshots
  WHERE source = 'clz_xml'
  ORDER BY ingested_at DESC
  LIMIT 1
`;

function yn(value: unknown): string {
  return value ? "Yes" : "No";
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rebuild the CLZ-shaped row: stored import first, live columns on top. */
function toClzRow(row: Record<string, unknown>): Record<string, unknown> {
  const stored = (row.clz_metadata ?? {}) as Record<string, unknown>;
  const base: Record<string, unknown> = { ...stored };

  base["Series"] = row.series_title ?? base["Series"] ?? "";
  base["Publisher"] = row.publisher ?? base["Publisher"] ?? "";
  base["Issue"] = row.issue_number ?? base["Issue"] ?? "";
  base["Issue Full"] = base["Issue Full"] ?? row.issue_number ?? "";
  base["Edition / Variant"] = row.cover_label ?? base["Edition / Variant"] ?? "";
  base["Cover Image URL"] = row.primary_image_url ?? base["Cover Image URL"] ?? "";

  base["Quantity"] = num(row.quantity) ?? base["Quantity"] ?? 1;
  base["Location"] = row.location ?? base["Location"] ?? "";
  base["Purchase Price"] = num(row.purchase_price) ?? base["Purchase Price"] ?? 0;
  base["Current Price"] = num(row.current_price_snapshot) ?? base["Current Price"] ?? 0;
  base["Slab Status"] = row.slab_status ?? base["Slab Status"] ?? "";
  base["Assumed Grade"] = row.assumed_grade ?? base["Assumed Grade"] ?? "";
  base["Grade Rating"] = num(row.grade_rating) ?? base["Grade Rating"] ?? 0;

  base["Collection Pillar"] = row.collection_pillar ?? base["Collection Pillar"] ?? "";
  base["Inventory Bucket"] = row.inventory_bucket ?? base["Inventory Bucket"] ?? "";
  base["Inventory Bucket Source"] = row.inventory_bucket_source ?? base["Inventory Bucket Source"] ?? "";
  base["Museum Score"] = num(row.museum_score) ?? base["Museum Score"] ?? 0;
  base["Investment Score"] = num(row.investment_score) ?? base["Investment Score"] ?? 0;
  base["Liquidity Score"] = num(row.liquidity_score) ?? base["Liquidity Score"] ?? 0;
  base["Recommendation"] = row.recommendation ?? base["Recommendation"] ?? "";
  base["Sell Priority"] = row.sell_priority ?? base["Sell Priority"] ?? "";

  base["Upgrade Candidate"] = yn(row.upgrade_candidate);
  base["Needs Grading"] = yn(row.needs_grading);
  base["Needs Photo"] = yn(row.needs_photo);
  base["Needs Verification"] = yn(row.needs_verification);
  base["Verification Notes"] = row.verification_notes ?? base["Verification Notes"] ?? "";

  if (row.is_key_issue && !base["Is Key Comic"]) {
    base["Is Key Comic"] = "Minor";
    base["Key Comic Reason"] = row.key_reason ?? base["Key Comic Reason"] ?? "";
  }

  base["CLZ Hash"] = row.source_row_id ?? base["CLZ Hash"] ?? "";
  base["ExternalIds"] = (row.external_ids as ExternalIdRef[]) ?? [];
  return base;
}

function toSnapshot(row: Record<string, unknown> | undefined): SnapshotInfo | null {
  if (!row) return null;
  const ingestedAt = new Date(String(row.ingested_at));
  const contentHash = String(row.content_hash);
  const storageRef = row.storage_ref ? String(row.storage_ref).split(/[\\/]/).pop() : null;
  const ageMs = Date.now() - ingestedAt.getTime();

  return {
    id: String(row.id),
    contentHash,
    shortHash: contentHash.slice(0, 12),
    ingestedAt: ingestedAt.toISOString(),
    recordCount: num(row.record_count),
    ageDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
    label: storageRef ? `CLZ export ${storageRef}` : "CLZ export",
  };
}

export async function loadComicsHoldings(): Promise<ComicsPayload> {
  const dsn = redactDsn(comicsDsn());
  try {
    const db = getDb();
    const [holdingRows, snapshotRows] = await Promise.all([
      db.execute(HOLDINGS_SQL),
      db.execute(SNAPSHOT_SQL),
    ]);

    const ranges = await loadAllLiveRanges().catch(() => new Map());
    const holdings = (holdingRows.rows as Record<string, unknown>[]).map((row, index) => {
      const clz = toClzRow(row);
      const id = String(clz["CLZ Hash"] ?? row.source_row_id ?? "");
      const chip = ranges.get(id);
      if (chip) {
        clz["Live Range"] = chip.label;
        clz["Live Low"] = chip.low;
        clz["Live High"] = chip.high;
        clz["Live Listings"] = chip.listingCount;
      }
      return mapInventoryRow(clz, index);
    });

    return {
      available: true,
      holdings,
      snapshot: toSnapshot((snapshotRows.rows as Record<string, unknown>[])[0]),
      error: null,
      dsn,
    };
  } catch (error) {
    return {
      available: false,
      holdings: [],
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
      dsn,
    };
  }
}
