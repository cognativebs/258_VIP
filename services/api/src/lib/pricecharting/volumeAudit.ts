/**
 * Volume-collapse audit: confirmed maps whose series has Vol. N must
 * match the vendor product year/era. Mismatches go to review.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { volumeEraMismatch } from "./normalize.js";

export const VOLUME_AUDIT_VERSION = "pricecharting-volume-audit@0.1.0";

export type VolumeAuditRow = {
  vendorProductId: string;
  assetId: string;
  seriesTitle: string;
  seriesVolume: number | null;
  yearBegan: number | null;
  vendorProductName: string;
  vendorConsoleName: string | null;
  mismatch: boolean;
};

export type VolumeAuditReport = {
  version: typeof VOLUME_AUDIT_VERSION;
  confirmedWithVolume: number;
  mismatches: number;
  mapsDemoted: number;
  observationsIneligible: number;
  samples: Array<{ seriesTitle: string; yearBegan: number | null; vendorProductName: string }>;
};

export function classifyVolumeMap(row: Omit<VolumeAuditRow, "mismatch">): VolumeAuditRow {
  return {
    ...row,
    mismatch: volumeEraMismatch({
      seriesTitle: row.seriesTitle,
      seriesVolume: row.seriesVolume,
      yearBegan: row.yearBegan,
      vendorProductName: row.vendorProductName,
      vendorConsoleName: row.vendorConsoleName,
    }),
  };
}

export async function loadConfirmedVolumeMaps(): Promise<VolumeAuditRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      m.vendor_product_id,
      m.asset_id::text AS asset_id,
      s.title AS series_title,
      s.volume AS series_volume,
      s.year_began,
      m.vendor_product_name,
      m.vendor_console_name
    FROM vault_market.vendor_product_map m
    JOIN vault_core.asset a ON a.id = m.asset_id
    JOIN vault_comic.variant v ON v.asset_id = a.id
    JOIN vault_comic.issue i ON i.id = v.issue_id
    JOIN vault_comic.series s ON s.id = i.series_id
    WHERE m.needs_review = false
      AND m.confirmed_at IS NULL
      AND (
        s.volume > 1
        OR s.title ~* 'vol(?:ume)?\\.?\\s*\\d+'
      )
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) =>
    classifyVolumeMap({
      vendorProductId: String(row.vendor_product_id),
      assetId: String(row.asset_id),
      seriesTitle: String(row.series_title ?? ""),
      seriesVolume: row.series_volume == null ? null : Number(row.series_volume),
      yearBegan: row.year_began == null ? null : Number(row.year_began),
      vendorProductName: String(row.vendor_product_name ?? ""),
      vendorConsoleName: row.vendor_console_name == null ? null : String(row.vendor_console_name),
    }),
  );
}

export async function runVolumeCollapseAudit(): Promise<VolumeAuditReport> {
  const rows = await loadConfirmedVolumeMaps();
  const mismatches = rows.filter((r) => r.mismatch);
  const db = getDb();
  let mapsDemoted = 0;
  let observationsIneligible = 0;
  for (const row of mismatches) {
    const mapResult = await db.execute(sql`
      UPDATE vault_market.vendor_product_map
         SET needs_review = true,
             last_seen_at = now(),
             prov_notes = 'volume-era mismatch · unverified · demoted from confirmed'
       WHERE vendor_product_id = ${row.vendorProductId}
         AND asset_id = ${row.assetId}::uuid
         AND needs_review = false
         AND confirmed_at IS NULL
    `);
    mapsDemoted += mapResult.rowCount ?? 0;
    const obs = await db.execute(sql`
      UPDATE vault_market.guide_price_observation
         SET baseline_eligible = false,
             prov_notes = trim(both ' · ' from concat_ws(' · ', prov_notes, 'volume-era mismatch · baseline_eligible=false'))
       WHERE asset_id = ${row.assetId}::uuid
         AND ingest_batch = 'phase_b_csv'
         AND baseline_eligible = true
    `);
    observationsIneligible += obs.rowCount ?? 0;
  }
  return {
    version: VOLUME_AUDIT_VERSION,
    confirmedWithVolume: rows.length,
    mismatches: mismatches.length,
    mapsDemoted,
    observationsIneligible,
    samples: mismatches.slice(0, 8).map((r) => ({
      seriesTitle: r.seriesTitle,
      yearBegan: r.yearBegan,
      vendorProductName: r.vendorProductName,
    })),
  };
}

export function formatVolumeAuditReport(report: VolumeAuditReport): string {
  const samples = report.samples
    .map((s) => `${s.seriesTitle} (${s.yearBegan ?? "?"}) ← ${s.vendorProductName}`)
    .join("\n  ");
  return [
    `${report.version}`,
    `confirmedWithVolume=${report.confirmedWithVolume} mismatches=${report.mismatches}`,
    `mapsDemoted=${report.mapsDemoted} observationsIneligible=${report.observationsIneligible}`,
    samples ? `samples:\n  ${samples}` : "samples: none",
  ].join("\n");
}
