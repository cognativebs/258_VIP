/**
 * Era audit: all confirmed comic maps, not just Vol. N / n≥5.
 * Vendor year more than 10 years before series.year_began → reprint/original.
 * Does not overwrite confirmed identities; flags the map. Phase 2 off.
 */
import { classifyEraGap, ERA_AUDIT_RULE, ERA_GAP_YEARS } from "@vip/core-model";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { extractComicYear } from "./normalize.js";

export type EraAuditRow = {
  assetId: string;
  vendorProductId: string;
  canonicalName: string | null;
  seriesTitle: string;
  yearBegan: number | null;
  vendorProductName: string;
  vendorYear: number | null;
  clzValue: number;
  confirmedAt: string | null;
  verdict: ReturnType<typeof classifyEraGap>["verdict"];
  gap: number | null;
  direction: ReturnType<typeof classifyEraGap>["direction"];
  reason: string;
};

export type EraAuditReport = {
  version: typeof ERA_AUDIT_RULE;
  confirmedMaps: number;
  scored: number;
  unscored: number;
  trips: number;
  longRunningNotDemoted: number;
  mapsDemoted: number;
  mapsConfirmedBlocked: number;
  observationsIneligible: number;
  valueConfirmed: number;
  valueTripped: number;
  valueWeightedImpact: number;
  vendorYearMissing: number;
  samples: Array<{
    canonicalName: string | null;
    yearBegan: number | null;
    vendorYear: number | null;
    vendorProductName: string;
    clzValue: number;
  }>;
};

export type VendorYearCoverage = {
  confirmedMaps: number;
  vendorYearPresent: number;
  vendorYearMissing: number;
  seriesYearMissing: number;
  bothMissing: number;
  samples: Array<{
    canonicalName: string | null;
    vendorProductName: string;
    yearBegan: number | null;
    clzValue: number;
  }>;
};

export function vendorYearOf(name: string, consoleName: string | null): number | null {
  return extractComicYear(name) ?? extractComicYear(consoleName);
}

export async function loadConfirmedEraMaps(): Promise<EraAuditRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      m.asset_id::text,
      m.vendor_product_id,
      a.canonical_name,
      s.title AS series_title,
      s.year_began,
      m.vendor_product_name,
      m.vendor_console_name,
      m.confirmed_at,
      COALESCE(MAX(h.current_price_snapshot), 0)::float AS clz_value
    FROM vault_market.vendor_product_map m
    JOIN vault_core.asset a ON a.id = m.asset_id
    JOIN vault_comic.variant v ON v.asset_id = a.id
    JOIN vault_comic.issue i ON i.id = v.issue_id
    JOIN vault_comic.series s ON s.id = i.series_id
    LEFT JOIN vault_collection.holding h
      ON h.asset_id = a.id AND h.dropped_at IS NULL
    WHERE m.needs_review = false
    GROUP BY m.asset_id, m.vendor_product_id, a.canonical_name, s.title,
             s.year_began, m.vendor_product_name, m.vendor_console_name, m.confirmed_at
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const yearBegan = row.year_began == null ? null : Number(row.year_began);
    const vendorProductName = String(row.vendor_product_name ?? "");
    const vendorYear = vendorYearOf(
      vendorProductName,
      row.vendor_console_name == null ? null : String(row.vendor_console_name),
    );
    const classified = classifyEraGap(yearBegan, vendorYear);
    return {
      assetId: String(row.asset_id),
      vendorProductId: String(row.vendor_product_id),
      canonicalName: row.canonical_name == null ? null : String(row.canonical_name),
      seriesTitle: String(row.series_title ?? ""),
      yearBegan,
      vendorProductName,
      vendorYear,
      clzValue: Number(row.clz_value ?? 0),
      confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
      verdict: classified.verdict,
      gap: classified.gap,
      direction: classified.direction,
      reason: classified.reason,
    };
  });
}

export async function runEraGapAudit(): Promise<{ report: EraAuditReport; trips: EraAuditRow[]; all: EraAuditRow[] }> {
  const rows = await loadConfirmedEraMaps();
  const trips = rows.filter((row) => row.verdict === "era_gap");
  const scored = rows.filter((row) => row.verdict !== "unscored");
  const longRunning = rows.filter((row) => row.direction === "vendor_newer" && Math.abs(row.gap ?? 0) > ERA_GAP_YEARS);
  const valueConfirmed = rows.reduce((sum, row) => sum + row.clzValue, 0);
  const valueTripped = trips.reduce((sum, row) => sum + row.clzValue, 0);

  const db = getDb();
  let mapsDemoted = 0;
  let mapsConfirmedBlocked = 0;
  let observationsIneligible = 0;
  const note = `${ERA_AUDIT_RULE} · series.year_began − vendor year > ${ERA_GAP_YEARS} · reprint/original · flag map`;

  for (const row of trips) {
    if (row.confirmedAt) {
      mapsConfirmedBlocked += 1;
    } else {
      const mapResult = await db.execute(sql`
        UPDATE vault_market.vendor_product_map
           SET needs_review = true,
               last_seen_at = now(),
               prov_notes = trim(both ' · ' from concat_ws(' · ', prov_notes, ${note}::text))
         WHERE vendor_product_id = ${row.vendorProductId}
           AND asset_id = ${row.assetId}::uuid
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
      version: ERA_AUDIT_RULE,
      confirmedMaps: rows.length,
      scored: scored.length,
      unscored: rows.length - scored.length,
      trips: trips.length,
      vendorYearMissing: rows.filter((row) => row.vendorYear == null).length,
      longRunningNotDemoted: longRunning.length,
      mapsDemoted,
      mapsConfirmedBlocked,
      observationsIneligible,
      valueConfirmed,
      valueTripped,
      valueWeightedImpact: valueConfirmed > 0 ? valueTripped / valueConfirmed : 0,
      samples: trips.map((row) => ({
        canonicalName: row.canonicalName,
        yearBegan: row.yearBegan,
        vendorYear: row.vendorYear,
        vendorProductName: row.vendorProductName,
        clzValue: row.clzValue,
      })),
    },
    trips,
    all: rows,
  };
}

export function formatEraAuditReport(report: EraAuditReport): string {
  const samples = report.samples
    .map(
      (s) =>
        `${s.canonicalName ?? "?"} year_began=${s.yearBegan ?? "?"} vendor=${s.vendorYear ?? "?"} ← ${s.vendorProductName} clz=$${s.clzValue.toFixed(2)}`,
    )
    .join("\n  ");
  return [
    report.version,
    `confirmedMaps=${report.confirmedMaps} scored=${report.scored} unscored=${report.unscored}`,
    `trips=${report.trips} (vendor older >${ERA_GAP_YEARS}y) longRunningNotDemoted=${report.longRunningNotDemoted}`,
    `vendorYearMissing=${report.vendorYearMissing} (uncovered era-rule gap)`,
    `mapsDemoted=${report.mapsDemoted} mapsConfirmedBlocked=${report.mapsConfirmedBlocked} observationsIneligible=${report.observationsIneligible}`,
    `valueConfirmed=$${report.valueConfirmed.toFixed(2)} valueTripped=$${report.valueTripped.toFixed(2)} valueWeightedImpact=${(report.valueWeightedImpact * 100).toFixed(1)}%`,
    samples ? `samples:\n  ${samples}` : "samples: none",
  ].join("\n");
}

export function summarizeVendorYearCoverage(rows: EraAuditRow[]): VendorYearCoverage {
  const vendorYearMissing = rows.filter((row) => row.vendorYear == null);
  const seriesYearMissing = rows.filter((row) => row.yearBegan == null);
  const both = rows.filter((row) => row.vendorYear == null && row.yearBegan == null);
  return {
    confirmedMaps: rows.length,
    vendorYearPresent: rows.length - vendorYearMissing.length,
    vendorYearMissing: vendorYearMissing.length,
    seriesYearMissing: seriesYearMissing.length,
    bothMissing: both.length,
    samples: vendorYearMissing.slice(0, 12).map((row) => ({
      canonicalName: row.canonicalName,
      vendorProductName: row.vendorProductName,
      yearBegan: row.yearBegan,
      clzValue: row.clzValue,
    })),
  };
}

export function formatVendorYearCoverage(row: VendorYearCoverage): string {
  const samples = row.samples
    .map((s) => `${s.canonicalName ?? "?"} ← ${s.vendorProductName} year_began=${s.yearBegan ?? "?"} clz=$${s.clzValue.toFixed(2)}`)
    .join("\n  ");
  return [
    `${ERA_AUDIT_RULE} vendor-year coverage (confirmed maps, no writes)`,
    `confirmedMaps=${row.confirmedMaps} vendorYearPresent=${row.vendorYearPresent} vendorYearMissing=${row.vendorYearMissing}`,
    `seriesYearMissing=${row.seriesYearMissing} bothMissing=${row.bothMissing}`,
    samples ? `no-year samples:\n  ${samples}` : "no-year samples: none",
  ].join("\n");
}
