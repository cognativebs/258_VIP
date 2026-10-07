/**
 * Comics PriceCharting matcher dry-run (ADR 0012).
 * Does not write vendor_product_map, guide_price_observation, or Phase 2 scores.
 */
import {
  PriceChartingProductSchema,
  verticalFromConsoleName,
  type PriceChartingProduct,
  type VendorMatchMethod,
  type VendorProductMap,
} from "@vip/core-model";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  matchVendorProduct,
  normalizeMatchText,
  type MatchCandidate,
  type VendorProductInput,
} from "./matcher.js";

export const COMICS_DRY_RUN_VERSION = "pricecharting-comics-dry-run@0.1.0";
export const CONFIRMED_AUTO_FLOOR = 0.9;

export type ComicsDryRunRow = Omit<VendorProductMap, "confirmedBy"> & {
  confirmedBelowFloor: boolean;
};

export type ComicsDryRunReport = {
  version: typeof COMICS_DRY_RUN_VERSION;
  vendorProducts: number;
  comicAssets: number;
  matched: number;
  matchedAssets: number;
  unmatched: number;
  needsReview: number;
  matchRate: number;
  byMethod: Record<VendorMatchMethod, number>;
  confirmedBelowFloor: ComicsDryRunRow[];
  existingConfirmedBelowFloor: number;
  wroteMaps: false;
  phase2Enabled: false;
};

function tokenDice(a: string, b: string): number {
  const left = new Set(normalizeMatchText(a).split(" ").filter(Boolean));
  const right = new Set(normalizeMatchText(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  return (2 * inter) / (left.size + right.size);
}

export function similarityForCandidate(vendorName: string, candidateName: string): number {
  return Number(tokenDice(vendorName, candidateName).toFixed(2));
}

export function dryRunMatchVendorProduct(
  vendor: VendorProductInput,
  assets: MatchCandidate[],
): ComicsDryRunRow {
  const first = matchVendorProduct(vendor, assets);
  const row =
    first.matchMethod === "unmatched"
      ? matchVendorProduct(
          vendor,
          assets.map((c) => ({
            ...c,
            similarity: c.similarity ?? similarityForCandidate(vendor.vendorProductName, c.canonicalName),
          })),
        )
      : first;
  const confirmedBelowFloor = Boolean(
    row.confirmedAt && row.matchConfidence != null && row.matchConfidence < CONFIRMED_AUTO_FLOOR,
  );
  return { ...row, confirmedBelowFloor };
}

export function summarizeComicsDryRun(
  rows: ComicsDryRunRow[],
  comicAssets: number,
  existingConfirmedBelowFloor = 0,
): ComicsDryRunReport {
  const byMethod: Record<VendorMatchMethod, number> = {
    upc: 0,
    exact_name: 0,
    trgm: 0,
    manual: 0,
    unmatched: 0,
  };
  let matched = 0;
  let needsReview = 0;
  const matchedAssetIds = new Set<string>();
  const confirmedBelowFloor: ComicsDryRunRow[] = [];
  for (const row of rows) {
    byMethod[row.matchMethod] += 1;
    if (row.assetId) {
      matched += 1;
      matchedAssetIds.add(row.assetId);
    }
    if (row.needsReview) needsReview += 1;
    if (row.confirmedBelowFloor) confirmedBelowFloor.push(row);
  }
  return {
    version: COMICS_DRY_RUN_VERSION,
    vendorProducts: rows.length,
    comicAssets,
    matched,
    matchedAssets: matchedAssetIds.size,
    unmatched: rows.length - matched,
    needsReview,
    matchRate: rows.length ? matched / rows.length : 0,
    byMethod,
    confirmedBelowFloor,
    existingConfirmedBelowFloor,
    wroteMaps: false,
    phase2Enabled: false,
  };
}

export function formatComicsDryRunReport(report: ComicsDryRunReport): string {
  const pct = (report.matchRate * 100).toFixed(1);
  const confirmed = report.confirmedBelowFloor.length + report.existingConfirmedBelowFloor;
  return [
    `${report.version}`,
    `vendorProducts=${report.vendorProducts} comicAssets=${report.comicAssets}`,
    `matched=${report.matched} matchedAssets=${report.matchedAssets} unmatched=${report.unmatched} matchRate=${pct}%`,
    `needs_review=${report.needsReview}`,
    `byMethod upc=${report.byMethod.upc} exact_name=${report.byMethod.exact_name} trgm=${report.byMethod.trgm} unmatched=${report.byMethod.unmatched}`,
    `confirmed_below_0.90=${confirmed}`,
    `wroteMaps=${report.wroteMaps} phase2Enabled=${report.phase2Enabled}`,
  ].join("\n");
}

export function productsFromSnapshotPayload(payload: string): PriceChartingProduct[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { products?: unknown }).products)
        ? (parsed as { products: unknown[] }).products
        : [parsed];
    const out: PriceChartingProduct[] = [];
    for (const item of rawItems) {
      const product = PriceChartingProductSchema.safeParse(item);
      if (product.success) out.push(product.data);
    }
    return out;
  } catch {
    return [];
  }
}

/** @deprecated use productsFromSnapshotPayload — snapshots are often search arrays */
export function productFromSnapshotPayload(payload: string): PriceChartingProduct | null {
  return productsFromSnapshotPayload(payload)[0] ?? null;
}

export async function loadComicMatchCandidates(): Promise<MatchCandidate[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT DISTINCT
      a.id::text AS asset_id,
      a.canonical_name,
      s.title AS series_title,
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
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    canonicalName: String(row.canonical_name ?? ""),
    seriesTitle: row.series_title == null ? null : String(row.series_title),
    upc: row.upc == null ? null : String(row.upc),
  }));
}

export async function loadPriceChartingProductsFromSnapshots(): Promise<VendorProductInput[]> {
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
      if (verticalFromConsoleName(product["console-name"]) !== "comic") continue;
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

export async function loadExistingConfirmedBelowFloor(): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM vault_market.vendor_product_map
     WHERE confirmed_at IS NOT NULL
       AND match_confidence IS NOT NULL
       AND match_confidence < 0.90
  `);
  return Number((result.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

export async function runComicsPriceChartingDryRun(input?: {
  vendors?: VendorProductInput[];
}): Promise<{ report: ComicsDryRunReport; rows: ComicsDryRunRow[] }> {
  const [assets, vendors, existingConfirmedBelowFloor] = await Promise.all([
    loadComicMatchCandidates(),
    input?.vendors ?? loadPriceChartingProductsFromSnapshots(),
    loadExistingConfirmedBelowFloor(),
  ]);
  const rows = vendors.map((vendor) => dryRunMatchVendorProduct(vendor, assets));
  return {
    report: summarizeComicsDryRun(rows, assets.length, existingConfirmedBelowFloor),
    rows,
  };
}
