/**
 * Ask/guide extremes flag the vendor map, not the listing price.
 * Confirmed maps are never overwritten. Phase 2 stays off.
 */
import {
  classifyMapIntegrity,
  MAP_INTEGRITY_ASK_MIN,
  MAP_INTEGRITY_RATIO_HIGH,
  MAP_INTEGRITY_RATIO_LOW,
  MAP_INTEGRITY_RULE,
  type MapIntegrityVerdict,
} from "@vip/core-model";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";

export type MapIntegrityRow = {
  assetId: string;
  canonicalName: string | null;
  listingCount: number;
  medianAsk: number | null;
  guideRaw: number | null;
  ratio: number | null;
  verdict: MapIntegrityVerdict;
  reason: string;
  clzValue: number;
  vendorProductId: string | null;
  vendorProductName: string | null;
  vendorConsoleName: string | null;
  needsReview: boolean | null;
  confirmedAt: string | null;
  matchMethod: string | null;
  seriesTitle: string | null;
  publisher: string | null;
  seriesVolume: number | null;
  yearBegan: number | null;
  issueNumber: string | null;
  coverLabel: string | null;
};

export type MapIntegrityReport = {
  version: typeof MAP_INTEGRITY_RULE;
  baselineAssets: number;
  scoredN5: number;
  trips: number;
  tripsLow: number;
  tripsHigh: number;
  mapsDemoted: number;
  mapsConfirmedBlocked: number;
  observationsIneligible: number;
  comicBaselineAssets: number;
  valueBaseline: number;
  valueComicBaseline: number;
  valueTripped: number;
  valueWeightedImpact: number;
  samples: Array<{
    canonicalName: string | null;
    ratio: number | null;
    medianAsk: number | null;
    guideRaw: number | null;
    vendorProductName: string | null;
    clzValue: number;
  }>;
};

export type SuspectIdentity = {
  assetId: string;
  canonicalName: string | null;
  medianAsk: number | null;
  guideRaw: number | null;
  dollarGap: number | null;
  ratio: number | null;
  listingCount: number;
  vendorProductId: string | null;
  vendorProductName: string | null;
  vendorConsoleName: string | null;
  matchMethod: string | null;
  matchConfidence: number | null;
  needsReview: boolean | null;
  confirmedAt: string | null;
  seriesTitle: string | null;
  publisher: string | null;
  seriesVolume: number | null;
  yearBegan: number | null;
  issueNumber: string | null;
  coverLabel: string | null;
  verdict: string;
};

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadMapIntegrityRows(): Promise<MapIntegrityRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH baseline_assets AS (
      SELECT DISTINCT asset_id
        FROM vault_market.v_guide_price_baseline
    ),
    raw AS (
      SELECT DISTINCT ON (g.asset_id)
             g.asset_id, g.guide_price
        FROM vault_market.v_guide_price_baseline g
       WHERE g.condition_key = 'raw_ungraded'
       ORDER BY g.asset_id, g.snapshot_on DESC
    ),
    asks AS (
      SELECT l.asset_id,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY l.ask_price::float) AS median_ask,
             count(*)::int AS listing_count
        FROM vault_market.listing_observation l
       WHERE l.observation_kind = 'browse_listing'
         AND l.ask_price IS NOT NULL
         AND l.ask_price > 0
       GROUP BY l.asset_id
    ),
    maps AS (
      SELECT DISTINCT ON (m.asset_id)
             m.asset_id, m.vendor_product_id, m.vendor_product_name, m.vendor_console_name,
             m.needs_review, m.confirmed_at, m.match_method, m.match_confidence
        FROM vault_market.vendor_product_map m
       ORDER BY m.asset_id, m.confirmed_at DESC NULLS LAST, m.last_seen_at DESC NULLS LAST
    ),
    clz AS (
      SELECT h.asset_id, MAX(h.current_price_snapshot)::float AS clz_value
        FROM vault_collection.holding h
       WHERE h.dropped_at IS NULL
       GROUP BY h.asset_id
    )
    SELECT
      b.asset_id::text,
      a.canonical_name,
      COALESCE(asks.listing_count, 0)::int AS listing_count,
      asks.median_ask,
      raw.guide_price,
      clz.clz_value,
      maps.vendor_product_id,
      maps.vendor_product_name,
      maps.vendor_console_name,
      maps.needs_review,
      maps.confirmed_at,
      maps.match_method,
      s.title AS series_title,
      s.publisher,
      s.volume AS series_volume,
      s.year_began,
      i.issue_number,
      v.cover_label
    FROM baseline_assets b
    JOIN vault_core.asset a ON a.id = b.asset_id
    LEFT JOIN raw ON raw.asset_id = b.asset_id
    LEFT JOIN asks ON asks.asset_id = b.asset_id
    LEFT JOIN maps ON maps.asset_id = b.asset_id
    LEFT JOIN clz ON clz.asset_id = b.asset_id
    LEFT JOIN vault_comic.variant v ON v.asset_id = b.asset_id
    LEFT JOIN vault_comic.issue i ON i.id = v.issue_id
    LEFT JOIN vault_comic.series s ON s.id = i.series_id
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const listingCount = Number(row.listing_count ?? 0);
    const medianAsk = num(row.median_ask) ?? 0;
    const guideRaw = num(row.guide_price) ?? 0;
    const classified = classifyMapIntegrity({ listingCount, medianAsk, guideRaw });
    return {
      assetId: String(row.asset_id),
      canonicalName: row.canonical_name == null ? null : String(row.canonical_name),
      listingCount,
      medianAsk: num(row.median_ask),
      guideRaw: num(row.guide_price),
      ratio: classified.ratio,
      verdict: classified.verdict,
      reason: classified.reason,
      clzValue: num(row.clz_value) ?? 0,
      vendorProductId: row.vendor_product_id == null ? null : String(row.vendor_product_id),
      vendorProductName: row.vendor_product_name == null ? null : String(row.vendor_product_name),
      vendorConsoleName: row.vendor_console_name == null ? null : String(row.vendor_console_name),
      needsReview: row.needs_review == null ? null : Boolean(row.needs_review),
      confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
      matchMethod: row.match_method == null ? null : String(row.match_method),
      seriesTitle: row.series_title == null ? null : String(row.series_title),
      publisher: row.publisher == null ? null : String(row.publisher),
      seriesVolume: num(row.series_volume),
      yearBegan: num(row.year_began),
      issueNumber: row.issue_number == null ? null : String(row.issue_number),
      coverLabel: row.cover_label == null ? null : String(row.cover_label),
    };
  });
}

export async function runMapIntegrityAudit(): Promise<{ report: MapIntegrityReport; trips: MapIntegrityRow[] }> {
  const rows = await loadMapIntegrityRows();
  const trips = rows.filter((row) => row.verdict === "map_suspect");
  const scoredN5 = rows.filter((row) => row.listingCount >= MAP_INTEGRITY_ASK_MIN && (row.guideRaw ?? 0) > 0);
  const tripsLow = trips.filter((row) => (row.ratio ?? 1) < MAP_INTEGRITY_RATIO_LOW);
  const tripsHigh = trips.filter((row) => (row.ratio ?? 0) > MAP_INTEGRITY_RATIO_HIGH);
  const comicRows = rows.filter((row) => row.seriesTitle != null);
  const valueBaseline = rows.reduce((sum, row) => sum + row.clzValue, 0);
  const valueComicBaseline = comicRows.reduce((sum, row) => sum + row.clzValue, 0);
  const valueTripped = trips.reduce((sum, row) => sum + row.clzValue, 0);

  const db = getDb();
  let mapsDemoted = 0;
  let mapsConfirmedBlocked = 0;
  let observationsIneligible = 0;
  const note = `${MAP_INTEGRITY_RULE} · ask/guide outside [${MAP_INTEGRITY_RATIO_LOW}, ${MAP_INTEGRITY_RATIO_HIGH}] · flag map`;

  for (const row of trips) {
    if (row.confirmedAt) {
      mapsConfirmedBlocked += 1;
    } else {
      const mapResult = await db.execute(sql`
        UPDATE vault_market.vendor_product_map
           SET needs_review = true,
               last_seen_at = now(),
               prov_notes = trim(both ' · ' from concat_ws(' · ', prov_notes, ${note}::text))
         WHERE asset_id = ${row.assetId}::uuid
           AND needs_review = false
           AND confirmed_at IS NULL
      `);
      mapsDemoted += mapResult.rowCount ?? 0;
    }
    const obs = await db.execute(sql`
      UPDATE vault_market.guide_price_observation
         SET baseline_eligible = false,
             prov_notes = trim(both ' · ' from concat_ws(' · ', prov_notes, ${`${note} · baseline_eligible=false`}::text))
       WHERE asset_id = ${row.assetId}::uuid
         AND baseline_eligible = true
    `);
    observationsIneligible += obs.rowCount ?? 0;
  }

  return {
    report: {
      version: MAP_INTEGRITY_RULE,
      baselineAssets: rows.length,
      comicBaselineAssets: comicRows.length,
      scoredN5: scoredN5.length,
      trips: trips.length,
      tripsLow: tripsLow.length,
      tripsHigh: tripsHigh.length,
      mapsDemoted,
      mapsConfirmedBlocked,
      observationsIneligible,
      valueBaseline,
      valueComicBaseline,
      valueTripped,
      valueWeightedImpact: valueComicBaseline > 0 ? valueTripped / valueComicBaseline : 0,
      samples: trips
        .slice()
        .sort((a, b) => Math.abs((a.medianAsk ?? 0) - (a.guideRaw ?? 0)) - Math.abs((b.medianAsk ?? 0) - (b.guideRaw ?? 0)))
        .reverse()
        .slice(0, 8)
        .map((row) => ({
          canonicalName: row.canonicalName,
          ratio: row.ratio,
          medianAsk: row.medianAsk,
          guideRaw: row.guideRaw,
          vendorProductName: row.vendorProductName,
          clzValue: row.clzValue,
        })),
    },
    trips,
  };
}

export function formatMapIntegrityReport(report: MapIntegrityReport): string {
  const samples = report.samples
    .map(
      (s) =>
        `${s.canonicalName ?? "?"} ask=$${s.medianAsk ?? "?"} guide=$${s.guideRaw ?? "?"} ratio=${s.ratio?.toFixed(4) ?? "?"} ← ${s.vendorProductName ?? "?"} clz=$${s.clzValue.toFixed(2)}`,
    )
    .join("\n  ");
  return [
    report.version,
    `baselineAssets=${report.baselineAssets} comicBaseline=${report.comicBaselineAssets} scoredN>=${MAP_INTEGRITY_ASK_MIN}=${report.scoredN5}`,
    `trips=${report.trips} low(<${MAP_INTEGRITY_RATIO_LOW})=${report.tripsLow} high(>${MAP_INTEGRITY_RATIO_HIGH})=${report.tripsHigh}`,
    `mapsDemoted=${report.mapsDemoted} mapsConfirmedBlocked=${report.mapsConfirmedBlocked} observationsIneligible=${report.observationsIneligible}`,
    `valueComicBaseline=$${report.valueComicBaseline.toFixed(2)} valueTripped=$${report.valueTripped.toFixed(2)} valueWeightedImpact=${(report.valueWeightedImpact * 100).toFixed(1)}%`,
    samples ? `samples:\n  ${samples}` : "samples: none",
  ].join("\n");
}

export function identityFromRow(row: MapIntegrityRow): SuspectIdentity {
  const vendorYear = row.vendorProductName?.match(/\((19|20)\d{2}\)/)?.[0]?.slice(1, 5);
  const vendorYearN = vendorYear == null ? null : Number(vendorYear);
  const wrongEra = vendorYearN != null && row.yearBegan != null && vendorYearN !== row.yearBegan;
  return {
    assetId: row.assetId,
    canonicalName: row.canonicalName,
    medianAsk: row.medianAsk,
    guideRaw: row.guideRaw,
    dollarGap: (row.medianAsk ?? 0) - (row.guideRaw ?? 0),
    ratio: row.ratio,
    listingCount: row.listingCount,
    vendorProductId: row.vendorProductId,
    vendorProductName: row.vendorProductName,
    vendorConsoleName: row.vendorConsoleName,
    matchMethod: row.matchMethod,
    matchConfidence: null,
    needsReview: row.needsReview,
    confirmedAt: row.confirmedAt,
    seriesTitle: row.seriesTitle,
    publisher: row.publisher,
    seriesVolume: row.seriesVolume,
    yearBegan: row.yearBegan,
    issueNumber: row.issueNumber,
    coverLabel: row.coverLabel,
    verdict: wrongEra ? "wrong_era" : "review",
  };
}

export function pickLargestNegativeGap(rows: MapIntegrityRow[]): MapIntegrityRow | undefined {
  return rows
    .filter((row) => (row.guideRaw ?? 0) > 0)
    .slice()
    .sort((a, b) => (a.medianAsk ?? 0) - (a.guideRaw ?? 0) - ((b.medianAsk ?? 0) - (b.guideRaw ?? 0)))[0];
}

export async function loadSuspectIdentity(assetId?: string): Promise<SuspectIdentity | null> {
  const rows = await loadMapIntegrityRows();
  const target = assetId != null ? rows.find((row) => row.assetId === assetId) : pickLargestNegativeGap(rows);
  return target ? identityFromRow(target) : null;
}

export function formatSuspectIdentity(row: SuspectIdentity): string {
  return [
    `suspect ${row.canonicalName ?? row.assetId}`,
    `  asset=${row.assetId} ask=$${row.medianAsk ?? "?"} guide_raw=$${row.guideRaw ?? "?"} gap=$${row.dollarGap?.toFixed(2) ?? "?"} ratio=${row.ratio?.toFixed(4) ?? "?"} n=${row.listingCount}`,
    `  holding: ${row.publisher ?? "?"} / ${row.seriesTitle ?? "?"} vol=${row.seriesVolume ?? "?"} year_began=${row.yearBegan ?? "?"} #${row.issueNumber ?? "?"} cover=${row.coverLabel ?? "plain"}`,
    `  vendor: id=${row.vendorProductId ?? "?"} ${row.vendorProductName ?? "?"} [${row.vendorConsoleName ?? "?"}] method=${row.matchMethod ?? "?"} review=${row.needsReview} confirmed=${row.confirmedAt ?? "no"}`,
    `  verdict=${row.verdict} (map flagged, price left as observed)`,
  ].join("\n");
}
