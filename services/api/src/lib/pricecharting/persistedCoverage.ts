import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";

export type PersistedComicCoverage = {
  comicAssets: number;
  mapped: number;
  mappedConfirmed: number;
  baselineEligible: number;
  valueTotal: number;
  valueBaseline: number;
  valueWeighted: number;
  top100: number;
  top100Baseline: number;
};

export async function loadPersistedComicCoverage(): Promise<PersistedComicCoverage> {
  const result = await getDb().execute(sql`
    WITH assets AS (
      SELECT a.id AS asset_id, MAX(h.current_price_snapshot)::float AS clz_value
        FROM vault_core.asset a
        JOIN vault_comic.variant v ON v.asset_id = a.id
        JOIN vault_collection.holding h ON h.asset_id = a.id AND h.dropped_at IS NULL
       GROUP BY a.id
    ),
    ranked AS (
      SELECT asset_id, clz_value, row_number() OVER (ORDER BY clz_value DESC NULLS LAST) AS rk
        FROM assets
    ),
    maps AS (
      SELECT DISTINCT ON (m.asset_id) m.asset_id, m.needs_review
        FROM vault_market.vendor_product_map m
        JOIN vault_comic.variant v ON v.asset_id = m.asset_id
       ORDER BY m.asset_id, m.needs_review ASC
    ),
    baseline AS (
      SELECT DISTINCT asset_id FROM vault_market.v_guide_price_baseline
    )
    SELECT
      count(*)::int AS comic_assets,
      count(*) FILTER (WHERE m.asset_id IS NOT NULL)::int AS mapped,
      count(*) FILTER (WHERE m.needs_review = false)::int AS mapped_confirmed,
      count(*) FILTER (WHERE b.asset_id IS NOT NULL)::int AS baseline_eligible,
      coalesce(sum(r.clz_value), 0) AS value_total,
      coalesce(sum(r.clz_value) FILTER (WHERE b.asset_id IS NOT NULL), 0) AS value_baseline,
      count(*) FILTER (WHERE r.rk <= 100)::int AS top100,
      count(*) FILTER (WHERE r.rk <= 100 AND b.asset_id IS NOT NULL)::int AS top100_baseline
    FROM ranked r
    LEFT JOIN maps m ON m.asset_id = r.asset_id
    LEFT JOIN baseline b ON b.asset_id = r.asset_id
  `);
  const row = result.rows[0] as Record<string, unknown>;
  const valueTotal = Number(row.value_total ?? 0);
  const valueBaseline = Number(row.value_baseline ?? 0);
  return {
    comicAssets: Number(row.comic_assets ?? 0),
    mapped: Number(row.mapped ?? 0),
    mappedConfirmed: Number(row.mapped_confirmed ?? 0),
    baselineEligible: Number(row.baseline_eligible ?? 0),
    valueTotal,
    valueBaseline,
    valueWeighted: valueTotal > 0 ? valueBaseline / valueTotal : 0,
    top100: Number(row.top100 ?? 0),
    top100Baseline: Number(row.top100_baseline ?? 0),
  };
}

export function formatPersistedComicCoverage(row: PersistedComicCoverage, label = "persisted"): string {
  return [
    `${label} comicAssets=${row.comicAssets} mapped=${row.mapped} mappedConfirmed=${row.mappedConfirmed} baselineEligible=${row.baselineEligible}`,
    `  value $${row.valueBaseline.toFixed(2)} / $${row.valueTotal.toFixed(2)} = ${(row.valueWeighted * 100).toFixed(1)}%`,
    `  top-100-by-value ${row.top100Baseline}/${row.top100}`,
  ].join("\n");
}
