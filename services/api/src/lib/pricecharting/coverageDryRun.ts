/**
 * Inverted PriceCharting dry-run: one best vendor product per our asset.
 * Does not write vendor_product_map, observations, or Phase 2 scores.
 */
import {
  verticalFromConsoleName,
  type PriceChartingProduct,
  type VendorMatchMethod,
} from "@vip/core-model";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { fetchPriceChartingProduct } from "./client.js";
import {
  indexVendorsBySeries,
  matchAssetToVendorProducts,
  type AssetMatchResult,
  type MatchCandidate,
  type VendorProductInput,
} from "./matcher.js";
import { productsFromSnapshotPayload } from "./comicsDryRun.js";

export const COVERAGE_DRY_RUN_VERSION = "pricecharting-asset-coverage@0.2.0";

export type CandidateBucket = "0" | "1" | "2-5" | "6-20" | "21+";

export type AssetCoverageReport = {
  version: typeof COVERAGE_DRY_RUN_VERSION;
  vertical: "comic" | "pokemon";
  slice: string;
  assets: number;
  vendorProducts: number;
  matchedAssets: number;
  assetCoverage: number;
  valueMatched: number;
  valueTotal: number;
  valueCoverage: number;
  top100Assets: number;
  top100Matched: number;
  top100Coverage: number;
  byMethod: Record<VendorMatchMethod, number>;
  needsReview: number;
  candidatesAfterSeries: Record<CandidateBucket, number>;
  candidatesAfterIssue: Record<CandidateBucket, number>;
  wroteObservations: false;
  phase2Enabled: false;
};

function bucket(n: number): CandidateBucket {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "21+";
}

function emptyBuckets(): Record<CandidateBucket, number> {
  return { "0": 0, "1": 0, "2-5": 0, "6-20": 0, "21+": 0 };
}

function emptyMethods(): Record<VendorMatchMethod, number> {
  return { upc: 0, exact_name: 0, trgm: 0, manual: 0, unmatched: 0 };
}

export function summarizeAssetCoverage(
  matches: AssetMatchResult[],
  assets: MatchCandidate[],
  vendorCount: number,
  vertical: "comic" | "pokemon",
  slice: string,
): AssetCoverageReport {
  const valueByAsset = new Map(assets.map((a) => [a.assetId, a.clzValue ?? 0]));
  const ranked = [...assets].sort((a, b) => (b.clzValue ?? 0) - (a.clzValue ?? 0));
  const top100 = ranked.slice(0, Math.min(100, ranked.length));
  const top100Ids = new Set(top100.map((a) => a.assetId));
  const byMethod = emptyMethods();
  const afterSeries = emptyBuckets();
  const afterIssue = emptyBuckets();
  let matchedAssets = 0;
  let needsReview = 0;
  let valueMatched = 0;
  let top100Matched = 0;
  for (const row of matches) {
    byMethod[row.matchMethod] += 1;
    afterSeries[bucket(row.candidatesAfterSeries)] += 1;
    afterIssue[bucket(row.candidatesAfterIssue)] += 1;
    if (row.needsReview) needsReview += 1;
    if (row.vendor && row.matchMethod !== "unmatched") {
      matchedAssets += 1;
      valueMatched += valueByAsset.get(row.assetId) ?? 0;
      if (top100Ids.has(row.assetId)) top100Matched += 1;
    }
  }
  const valueTotal = assets.reduce((sum, a) => sum + (a.clzValue ?? 0), 0);
  return {
    version: COVERAGE_DRY_RUN_VERSION,
    vertical,
    slice,
    assets: assets.length,
    vendorProducts: vendorCount,
    matchedAssets,
    assetCoverage: assets.length ? matchedAssets / assets.length : 0,
    valueMatched,
    valueTotal,
    valueCoverage: valueTotal > 0 ? valueMatched / valueTotal : 0,
    top100Assets: top100.length,
    top100Matched,
    top100Coverage: top100.length ? top100Matched / top100.length : 0,
    byMethod,
    needsReview,
    candidatesAfterSeries: afterSeries,
    candidatesAfterIssue: afterIssue,
    wroteObservations: false,
    phase2Enabled: false,
  };
}

export function formatAssetCoverageReport(report: AssetCoverageReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const dist = (d: Record<CandidateBucket, number>) =>
    `0=${d["0"]} 1=${d["1"]} 2-5=${d["2-5"]} 6-20=${d["6-20"]} 21+=${d["21+"]}`;
  return [
    `${report.version} vertical=${report.vertical} slice=${report.slice}`,
    `assets=${report.assets} vendorProducts=${report.vendorProducts}`,
    `assetCoverage=${report.matchedAssets}/${report.assets} ${pct(report.assetCoverage)}`,
    `valueCoverage=${report.valueMatched.toFixed(2)}/${report.valueTotal.toFixed(2)} ${pct(report.valueCoverage)}`,
    `top100Coverage=${report.top100Matched}/${report.top100Assets} ${pct(report.top100Coverage)}`,
    `byMethod upc=${report.byMethod.upc} exact_name=${report.byMethod.exact_name} trgm=${report.byMethod.trgm} unmatched=${report.byMethod.unmatched}`,
    `needs_review=${report.needsReview}`,
    `candidatesAfterSeries ${dist(report.candidatesAfterSeries)}`,
    `candidatesAfterIssue ${dist(report.candidatesAfterIssue)}`,
    `wroteObservations=${report.wroteObservations} phase2Enabled=${report.phase2Enabled}`,
  ].join("\n");
}

export async function loadComicAssets(): Promise<MatchCandidate[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      a.id::text AS asset_id,
      a.canonical_name,
      s.title AS series_title,
      i.issue_number,
      v.cover_label,
      MAX(h.current_price_snapshot)::float AS clz_value,
      (
        SELECT e.external_value
          FROM vault_core.external_id e
         WHERE e.asset_id = a.id
           AND e.source IN ('upc', 'ean', 'gtin')
         LIMIT 1
      ) AS upc
    FROM vault_core.asset a
    JOIN vault_comic.variant v ON v.asset_id = a.id
    JOIN vault_comic.issue i ON i.id = v.issue_id
    JOIN vault_comic.series s ON s.id = i.series_id
    LEFT JOIN vault_collection.holding h
      ON h.asset_id = a.id AND h.source = 'clz_import'
    GROUP BY a.id, a.canonical_name, s.title, i.issue_number, v.cover_label
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    canonicalName: String(row.canonical_name ?? ""),
    seriesTitle: row.series_title == null ? null : String(row.series_title),
    issueNumber: row.issue_number == null ? null : String(row.issue_number),
    coverLabel: row.cover_label == null ? null : String(row.cover_label),
    clzValue: row.clz_value == null ? 0 : Number(row.clz_value),
    upc: row.upc == null ? null : String(row.upc),
  }));
}

export async function loadPokemonSingles(): Promise<MatchCandidate[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      a.id::text AS asset_id,
      a.canonical_name,
      MAX(h.clz_metadata->>'setName') AS set_name,
      MAX(h.clz_metadata->>'cardName') AS card_name,
      MAX(h.clz_metadata->>'number') AS collector_number,
      MAX(h.current_price_snapshot)::float AS clz_value
    FROM vault_collection.holding h
    JOIN vault_core.asset a ON a.id = h.asset_id
    JOIN vault_core.categories c ON c.id = a.category_id
    WHERE c.kind = 'pokemon' AND a.format = 'single'
    GROUP BY a.id, a.canonical_name
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    canonicalName: String(row.canonical_name ?? ""),
    seriesTitle: row.set_name == null ? null : String(row.set_name),
    setName: row.set_name == null ? null : String(row.set_name),
    cardName: row.card_name == null ? null : String(row.card_name),
    collectorNumber: row.collector_number == null ? null : String(row.collector_number),
    clzValue: row.clz_value == null ? 0 : Number(row.clz_value),
  }));
}

export async function loadPokemonSealed(): Promise<MatchCandidate[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      a.id::text AS asset_id,
      a.canonical_name,
      sp.set_name,
      sp.product_name,
      sp.upc,
      MAX(h.current_price_snapshot)::float AS clz_value
    FROM vault_market.sealed_product sp
    JOIN vault_core.asset a ON a.id = sp.asset_id
    JOIN vault_core.categories c ON c.id = a.category_id
    LEFT JOIN vault_collection.holding h ON h.asset_id = a.id
    WHERE c.kind = 'pokemon'
    GROUP BY a.id, a.canonical_name, sp.set_name, sp.product_name, sp.upc
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    canonicalName: String(row.canonical_name ?? row.product_name ?? ""),
    seriesTitle: row.set_name == null ? null : String(row.set_name),
    setName: row.set_name == null ? null : String(row.set_name),
    cardName: row.product_name == null ? null : String(row.product_name),
    upc: row.upc == null ? null : String(row.upc),
    clzValue: row.clz_value == null ? 0 : Number(row.clz_value),
  }));
}

export async function loadVendorProducts(
  vertical: "comic" | "pokemon",
): Promise<VendorProductInput[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT payload
      FROM vault_evidence.raw_snapshots
     WHERE source = 'pricecharting'
       AND payload IS NOT NULL
  `);
  const seen = new Set<string>();
  const out: VendorProductInput[] = [];
  for (const raw of result.rows as Array<{ payload: string }>) {
    for (const product of productsFromSnapshotPayload(raw.payload)) {
      if (verticalFromConsoleName(product["console-name"]) !== vertical) continue;
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      out.push({
        vendorProductId: product.id,
        vendorProductName: product["product-name"],
        vendorConsoleName: product["console-name"] ?? null,
        vendorUpc: product.upc ?? null,
      });
    }
  }
  return out;
}

export type LiveVendorFetch = {
  vendors: VendorProductInput[];
  products: Map<string, PriceChartingProduct>;
};

export async function fetchPokemonVendorsAndProducts(
  assets: MatchCandidate[],
): Promise<LiveVendorFetch> {
  const seen = new Set<string>();
  const vendors: VendorProductInput[] = [];
  const products = new Map<string, PriceChartingProduct>();
  for (const asset of assets) {
    const queries = [
      asset.upc ? { upc: asset.upc } : null,
      { q: [asset.setName, asset.cardName, asset.collectorNumber].filter(Boolean).join(" ") },
      { q: [asset.cardName, asset.collectorNumber, asset.setName].filter(Boolean).join(" ") },
      { q: [asset.cardName, asset.collectorNumber ? `#${asset.collectorNumber}` : ""].filter(Boolean).join(" ") },
    ].filter((row): row is { upc: string } | { q: string } => {
      if (!row) return false;
      if ("upc" in row) return Boolean(row.upc);
      return Boolean(row.q);
    });
    for (const query of queries) {
      const result = await fetchPriceChartingProduct(query);
      if (!result.ok) continue;
      if (seen.has(result.product.id)) break;
      seen.add(result.product.id);
      products.set(result.product.id, result.product);
      vendors.push({
        vendorProductId: result.product.id,
        vendorProductName: result.product["product-name"],
        vendorConsoleName: result.product["console-name"] ?? null,
        vendorUpc: result.product.upc ?? null,
      });
      break;
    }
  }
  return { vendors, products };
}

export async function fetchPokemonVendorsLive(
  assets: MatchCandidate[],
): Promise<VendorProductInput[]> {
  const { vendors } = await fetchPokemonVendorsAndProducts(assets);
  return vendors;
}

export async function runAssetCoverageDryRun(input: {
  vertical: "comic" | "pokemon";
  slice: string;
  assets: MatchCandidate[];
  vendors: VendorProductInput[];
}): Promise<{ report: AssetCoverageReport; matches: AssetMatchResult[] }> {
  const index = indexVendorsBySeries(input.vendors, input.vertical);
  const matches = input.assets.map((asset) => matchAssetToVendorProducts(asset, input.vendors, index));
  return {
    report: summarizeAssetCoverage(matches, input.assets, input.vendors.length, input.vertical, input.slice),
    matches,
  };
}
