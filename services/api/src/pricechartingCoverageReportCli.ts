import { PHASE_D_PREMIUM_TIGHT } from "@vip/core-model";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./db/client.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import { classifyComicMatches } from "./lib/pricecharting/phaseBWrite.js";
import {
  formatAssetCoverageReport,
  loadComicAssets,
  loadVendorProducts,
  runAssetCoverageDryRun,
} from "./lib/pricecharting/coverageDryRun.js";
import { formatPersistedComicCoverage, loadPersistedComicCoverage } from "./lib/pricecharting/persistedCoverage.js";

loadLocalEnv();

async function ebayDiagnosis() {
  const db = getDb();
  const kinds = await db.execute(sql`
    SELECT observation_kind, source, count(*)::int, count(DISTINCT asset_id)::int AS assets,
           min(observed_at) AS first_seen, max(observed_at) AS last_seen
      FROM vault_market.listing_observation
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);
  const browse = await db.execute(sql`
    SELECT a.canonical_name, count(*)::int AS rows, min(l.ask_price) AS lo, max(l.ask_price) AS hi
      FROM vault_market.listing_observation l
      JOIN vault_core.asset a ON a.id = l.asset_id
     WHERE l.observation_kind = 'browse_listing'
     GROUP BY a.canonical_name
     ORDER BY rows DESC
  `);
  const guideOnListing = await db.execute(sql`
    SELECT count(*)::int
      FROM vault_market.listing_observation
     WHERE observation_kind IN ('guide_quote', 'guide_empty')
  `);
  return { kinds: kinds.rows, browse: browse.rows, guideOnListing: Number((guideOnListing.rows[0] as { count: number }).count) };
}

async function premiumDistribution() {
  const db = getDb();
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT asset_id, condition_key, guide_price,
             row_number() OVER (PARTITION BY asset_id, condition_key ORDER BY snapshot_on DESC) AS rn
        FROM vault_market.v_guide_price_baseline
    ),
    assets AS (
      SELECT DISTINCT asset_id FROM vault_market.v_guide_price_baseline
    ),
    paired AS (
      SELECT
        a.asset_id,
        raw.guide_price::float AS raw,
        high.guide_price::float AS high,
        high.condition_key AS high_key
      FROM assets a
      LEFT JOIN latest raw
        ON raw.asset_id = a.asset_id AND raw.condition_key = 'raw_ungraded' AND raw.rn = 1
      LEFT JOIN latest high
        ON high.asset_id = a.asset_id AND high.condition_key IN ('graded_9_8', 'graded_psa_10') AND high.rn = 1
    )
    SELECT
      count(*)::int AS baseline_assets,
      count(*) FILTER (WHERE raw IS NOT NULL AND high IS NOT NULL)::int AS with_both_rungs,
      count(*) FILTER (WHERE raw IS NULL OR high IS NULL)::int AS missing_rung,
      min(high/raw) FILTER (WHERE raw > 0 AND high > 0) AS min_ratio,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY high/raw) FILTER (WHERE raw > 0 AND high > 0) AS p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY high/raw) FILTER (WHERE raw > 0 AND high > 0) AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY high/raw) FILTER (WHERE raw > 0 AND high > 0) AS p75,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY high/raw) FILTER (WHERE raw > 0 AND high > 0) AS p90,
      max(high/raw) FILTER (WHERE raw > 0 AND high > 0) AS max_ratio,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw < ${PHASE_D_PREMIUM_TIGHT})::int AS below_threshold,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw >= ${PHASE_D_PREMIUM_TIGHT} AND high/raw < 2)::int AS r14_2,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw >= 2 AND high/raw < 3)::int AS r2_3,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw >= 3 AND high/raw < 5)::int AS r3_5,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw >= 5 AND high/raw < 10)::int AS r5_10,
      count(*) FILTER (WHERE raw > 0 AND high > 0 AND high/raw >= 10)::int AS r10p
    FROM paired
  `);
  return result.rows[0];
}

async function main() {
  const comicAssets = await loadComicAssets();
  const comicVendors = await loadVendorProducts("comic");
  const comics = await runAssetCoverageDryRun({
    vertical: "comic",
    slice: "comics-directional-variant",
    assets: comicAssets,
    vendors: comicVendors,
  });
  const split = classifyComicMatches(comics.matches);
  console.log(formatAssetCoverageReport(comics.report));
  console.log(
    `variantSplit unambiguous=${split.unambiguous.length} ambiguous=${split.ambiguous.length} unmatched=${split.unmatched.length}`,
  );
  console.log("");

  const ebay = await ebayDiagnosis();
  console.log("ebay listing_observation by kind/source:");
  for (const row of ebay.kinds) console.log(" ", JSON.stringify(row));
  console.log("browse_listing by title:");
  for (const row of ebay.browse) console.log(" ", JSON.stringify(row));
  console.log(`guide_* rows in listing_observation=${ebay.guideOnListing}`);
  console.log("");

  const prem = await premiumDistribution();
  console.log(`grade_premium threshold=${PHASE_D_PREMIUM_TIGHT}`);
  console.log(JSON.stringify(prem, null, 2));
  console.log("");

  const persisted = await loadPersistedComicCoverage();
  console.log(formatPersistedComicCoverage(persisted, "persistedAfterAudit"));
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
