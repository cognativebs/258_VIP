/**
 * Phase B persist (ADR 0012). Writes guide_price_observation + vendor_product_map.
 * Does not write listing_observation, sale, or enable Phase 2.
 */
import { createHash } from "node:crypto";
import {
  GUIDE_PRICE_CONFIDENCE_CEILING,
  GUIDE_PRICE_PHASE_B_BATCH,
  GUIDE_PRICE_RULE,
  GUIDE_PRICE_SOURCE,
  GuidePriceObservationSchema,
  PRICECHARTING_PRICE_KEYS,
  mapPriceChartingProduct,
  verticalFromConsoleName,
  type PriceChartingProduct,
} from "@vip/core-model";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { fetchPriceChartingProduct } from "./client.js";
import { productsFromSnapshotPayload } from "./comicsDryRun.js";
import {
  fetchPokemonVendorsAndProducts,
  loadComicAssets,
  loadPokemonSingles,
  loadVendorProducts,
  runAssetCoverageDryRun,
} from "./coverageDryRun.js";
import type { AssetMatchResult, MatchCandidate, VendorProductInput } from "./matcher.js";

export const PHASE_B_WRITE_VERSION = "pricecharting-phase-b-write@0.2.0";

export type PhaseBWriteReport = {
  version: typeof PHASE_B_WRITE_VERSION;
  pokemonWriteAssets: number;
  comicUnambiguousAssets: number;
  comicAmbiguousReview: number;
  mapsInserted: number;
  mapsReview: number;
  observationsBaseline: number;
  observationsReviewOnly: number;
  productsFetched: number;
  productsFromSnapshot: number;
  series21Plus: number;
  series21PlusTop: Array<{ series: string; assets: number; medianCandidates: number }>;
  afterIssue21Plus: number;
  issueParseGaps: number;
  numericIssueInSeries21: number;
  longestOwnedSeriesAssets: number;
  phase2Enabled: false;
};

function chicagoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function classifyComicMatches(matches: AssetMatchResult[]): {
  unambiguous: AssetMatchResult[];
  ambiguous: AssetMatchResult[];
  unmatched: AssetMatchResult[];
  afterIssue21Plus: AssetMatchResult[];
} {
  const exact = matches.filter((m) => m.matchMethod === "exact_name" && m.vendor);
  return {
    unambiguous: exact.filter((m) => !m.needsReview),
    ambiguous: exact.filter((m) => m.needsReview),
    unmatched: matches.filter((m) => m.matchMethod === "unmatched" || !m.vendor),
    afterIssue21Plus: matches.filter((m) => m.candidatesAfterIssue >= 21),
  };
}

export function seriesCandidateReport(
  matches: AssetMatchResult[],
  assets: MatchCandidate[],
): {
  series21Plus: number;
  top: Array<{ series: string; assets: number; medianCandidates: number }>;
  afterIssue21Plus: number;
  issueParseGaps: number;
  numericIssueInSeries21: number;
  longestOwnedSeriesAssets: number;
} {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const ownedBySeries = new Map<string, number>();
  for (const asset of assets) {
    const series = asset.seriesTitle ?? "(unknown)";
    ownedBySeries.set(series, (ownedBySeries.get(series) ?? 0) + 1);
  }
  const hot = matches.filter((m) => m.candidatesAfterSeries >= 21);
  const bySeries = new Map<string, number[]>();
  let numericIssueInSeries21 = 0;
  for (const row of hot) {
    const asset = byId.get(row.assetId);
    const series = asset?.seriesTitle ?? "(unknown)";
    const list = bySeries.get(series) ?? [];
    list.push(row.candidatesAfterSeries);
    bySeries.set(series, list);
    if (/^\d+$/.test((asset?.issueNumber ?? "").trim())) numericIssueInSeries21 += 1;
  }
  const top = [...bySeries.entries()]
    .map(([series, counts]) => {
      const sorted = [...counts].sort((a, b) => a - b);
      return {
        series,
        assets: counts.length,
        medianCandidates: sorted[Math.floor(sorted.length / 2)] ?? 0,
      };
    })
    .sort((a, b) => b.assets - a.assets)
    .slice(0, 8);
  return {
    series21Plus: hot.length,
    top,
    afterIssue21Plus: matches.filter((m) => m.candidatesAfterIssue >= 21).length,
    issueParseGaps: matches.filter((m) => m.candidatesAfterSeries > 0 && m.candidatesAfterIssue === 0).length,
    numericIssueInSeries21,
    longestOwnedSeriesAssets: Math.max(0, ...ownedBySeries.values()),
  };
}

export function productPriceKeyCount(product: PriceChartingProduct): number {
  return PRICECHARTING_PRICE_KEYS.filter((key) => product[key] != null && Number(product[key]) > 0).length;
}

/** Search-array snapshots are usually loose-only. Graded columns require /api/product. */
export function productHasGradedLadder(product: PriceChartingProduct): boolean {
  return Boolean(
    (product["manual-only-price"] && product["manual-only-price"] > 0) ||
      (product["box-only-price"] && product["box-only-price"] > 0) ||
      (product["graded-price"] && product["graded-price"] > 0) ||
      (product["cib-price"] && product["cib-price"] > 0),
  );
}

async function loadComicProductMap(): Promise<Map<string, PriceChartingProduct>> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT payload FROM vault_evidence.raw_snapshots
     WHERE source = 'pricecharting' AND payload IS NOT NULL
  `);
  const map = new Map<string, PriceChartingProduct>();
  for (const raw of result.rows as Array<{ payload: string }>) {
    for (const product of productsFromSnapshotPayload(raw.payload)) {
      const existing = map.get(product.id);
      if (!existing || productPriceKeyCount(product) > productPriceKeyCount(existing)) {
        map.set(product.id, product);
      }
    }
  }
  return map;
}

async function dataSourceId(): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT data_source_id, redistribution_allowed
      FROM vault_market.data_source WHERE source_key = ${GUIDE_PRICE_SOURCE}
  `);
  const row = result.rows[0] as { data_source_id: number; redistribution_allowed: boolean } | undefined;
  if (!row) throw new Error("pricecharting data_source missing");
  if (row.redistribution_allowed) throw new Error("pricecharting redistribution_allowed is true — refusing to write");
  return Number(row.data_source_id);
}

async function persistRawSnapshot(rawJson: string): Promise<string | null> {
  const db = getDb();
  const hash = createHash("sha256").update(rawJson).digest("hex");
  const existing = await db.execute(sql`
    SELECT id FROM vault_evidence.raw_snapshots WHERE content_hash = ${hash} LIMIT 1
  `);
  const found = existing.rows[0] as { id: string } | undefined;
  if (found?.id) return found.id;
  const inserted = await db.execute(sql`
    INSERT INTO vault_evidence.raw_snapshots
      (source, content_hash, content_type, payload, byte_length, record_count,
       prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
    VALUES (
      ${GUIDE_PRICE_SOURCE}, ${hash}, 'application/json', ${rawJson},
      ${Buffer.byteLength(rawJson)}, 1,
      ${GUIDE_PRICE_SOURCE}, 'observed', ${GUIDE_PRICE_RULE}, 1.0, 'verified'
    )
    ON CONFLICT (content_hash) DO NOTHING
    RETURNING id
  `);
  const row = inserted.rows[0] as { id: string } | undefined;
  if (row?.id) return row.id;
  const again = await db.execute(sql`
    SELECT id FROM vault_evidence.raw_snapshots WHERE content_hash = ${hash} LIMIT 1
  `);
  return (again.rows[0] as { id: string } | undefined)?.id ?? null;
}

async function upsertMap(input: {
  dataSourceId: number;
  vendor: VendorProductInput;
  assetId: string;
  method: string;
  confidence: number | null;
  needsReview: boolean;
}): Promise<"inserted" | "kept"> {
  const db = getDb();
  const existing = await db.execute(sql`
    SELECT asset_id::text, needs_review, confirmed_at
      FROM vault_market.vendor_product_map
     WHERE data_source_id = ${input.dataSourceId} AND vendor_product_id = ${input.vendor.vendorProductId}
  `);
  const row = existing.rows[0] as { asset_id: string; needs_review: boolean; confirmed_at: Date | null } | undefined;
  if (row?.confirmed_at) return "kept";
  if (row && row.needs_review === false) return "kept";
  if (row) {
    await db.execute(sql`
      UPDATE vault_market.vendor_product_map
         SET asset_id = ${input.assetId}::uuid,
             vendor_product_name = ${input.vendor.vendorProductName},
             vendor_console_name = ${input.vendor.vendorConsoleName ?? null},
             vendor_upc = ${input.vendor.vendorUpc ?? null},
             match_method = ${input.method},
             match_confidence = ${input.confidence},
             needs_review = ${input.needsReview},
             provider_ids = ${JSON.stringify({ pricecharting_id: input.vendor.vendorProductId })}::jsonb,
             last_seen_at = now()
       WHERE data_source_id = ${input.dataSourceId}
         AND vendor_product_id = ${input.vendor.vendorProductId}
         AND confirmed_at IS NULL
    `);
    return "inserted";
  }
  await db.execute(sql`
    INSERT INTO vault_market.vendor_product_map
      (data_source_id, vendor_product_id, vendor_product_name, vendor_console_name, vendor_upc,
       asset_id, match_method, match_confidence, needs_review, provider_ids,
       prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes)
    VALUES (
      ${input.dataSourceId}, ${input.vendor.vendorProductId}, ${input.vendor.vendorProductName},
      ${input.vendor.vendorConsoleName ?? null}, ${input.vendor.vendorUpc ?? null},
      ${input.assetId}::uuid, ${input.method}, ${input.confidence}, ${input.needsReview},
      ${JSON.stringify({ pricecharting_id: input.vendor.vendorProductId })}::jsonb,
      ${GUIDE_PRICE_SOURCE}, 'inferred', ${GUIDE_PRICE_RULE}, ${GUIDE_PRICE_CONFIDENCE_CEILING},
      'unverified', ${input.needsReview ? "exact_name ambiguous variant — needs_review" : "exact_name unambiguous"}
    )
  `);
  return "inserted";
}

async function writeObservations(input: {
  product: PriceChartingProduct;
  assetId: string;
  dataSourceId: number;
  baselineEligible: boolean;
  snapshotOn: string;
  observedAt: Date;
  rawSnapshotId: string | null;
}): Promise<number> {
  const vertical = verticalFromConsoleName(input.product["console-name"]);
  const mapped = mapPriceChartingProduct(input.product, vertical);
  if (mapped.skipped) return 0;
  const rows = mapped.observations.filter((o) => o.priceType === "market_value");
  if (
    vertical === "comic" &&
    rows.some((o) => o.vendorKey !== "loose-price" && o.conditionKey === "raw_ungraded")
  ) {
    throw new Error("comic guide ladder collapsed to raw_ungraded — refusing to write");
  }
  const db = getDb();
  let written = 0;
  for (const o of rows) {
    const parsed = GuidePriceObservationSchema.parse({
      assetId: input.assetId,
      holdingId: null,
      holdingSourceRowId: `pc:${input.product.id}:asset:${input.assetId}`,
      pricedUnitId: null,
      conditionKey: o.conditionKey,
      snapshotOn: input.snapshotOn,
      observedAt: input.observedAt,
      observationKind: "guide_quote",
      source: GUIDE_PRICE_SOURCE,
      evidenceClass: "vendor_derived",
      guidePrice: o.priceUsd,
      currency: "USD",
      rawSnapshotId: input.rawSnapshotId,
      providerIds: { pricecharting_id: input.product.id, vendor_key: o.vendorKey },
      provSource: GUIDE_PRICE_SOURCE,
      provMethod: "inferred",
      provRuleVersion: GUIDE_PRICE_RULE,
      provConfidence: GUIDE_PRICE_CONFIDENCE_CEILING,
      provVerification: "unverified",
      provNotes: input.baselineEligible
        ? "Phase B guide · vendor_derived · unverified"
        : "Phase B ambiguous variant · baseline_eligible=false",
      ingestBatch: GUIDE_PRICE_PHASE_B_BATCH,
      baselineEligible: input.baselineEligible,
    });
    const result = await db.execute(sql`
      INSERT INTO vault_market.guide_price_observation
        (asset_id, holding_id, holding_source_row_id, priced_unit_id, condition_key,
         snapshot_on, observed_at, observation_kind, source, data_source_id,
         evidence_class, guide_price, currency, raw_snapshot_id, provider_ids,
         prov_source, prov_method, prov_rule_version, prov_confidence,
         prov_verification, prov_notes, ingest_batch, baseline_eligible)
      VALUES (
        ${parsed.assetId}::uuid, NULL, ${parsed.holdingSourceRowId}, NULL, ${parsed.conditionKey},
        ${parsed.snapshotOn}::date, ${parsed.observedAt.toISOString()}::timestamptz,
        ${parsed.observationKind}, ${parsed.source}, ${input.dataSourceId},
        ${parsed.evidenceClass}, ${parsed.guidePrice}, ${parsed.currency},
        ${parsed.rawSnapshotId}::uuid, ${JSON.stringify(parsed.providerIds)}::jsonb,
        ${parsed.provSource}, 'inferred', ${parsed.provRuleVersion}, ${parsed.provConfidence},
        'unverified', ${parsed.provNotes}, ${parsed.ingestBatch}, ${parsed.baselineEligible}
      )
      ON CONFLICT (holding_source_row_id, condition_key, source, snapshot_on) DO NOTHING
    `);
    written += result.rowCount ?? 0;
  }
  return written;
}

async function resolveProduct(
  vendorId: string,
  cache: Map<string, PriceChartingProduct>,
): Promise<{ product: PriceChartingProduct | null; fetched: boolean; rawSnapshotId: string | null }> {
  const cached = cache.get(vendorId);
  if (cached && productHasGradedLadder(cached)) {
    return { product: cached, fetched: false, rawSnapshotId: null };
  }
  const fetched = await fetchPriceChartingProduct({ id: vendorId });
  if (!fetched.ok) {
    return { product: cached ?? null, fetched: false, rawSnapshotId: null };
  }
  cache.set(vendorId, fetched.product);
  const rawSnapshotId = await persistRawSnapshot(fetched.rawJson);
  return { product: fetched.product, fetched: true, rawSnapshotId };
}

export async function runPhaseBWrite(log: (msg: string) => void = () => undefined): Promise<PhaseBWriteReport> {
  const now = new Date();
  const snapshotOn = chicagoDate(now);
  const dsId = await dataSourceId();

  const comicAssets = await loadComicAssets();
  const comicVendors = await loadVendorProducts("comic");
  const comicRun = await runAssetCoverageDryRun({
    vertical: "comic",
    slice: "comics-holdings",
    assets: comicAssets,
    vendors: comicVendors,
  });
  const classified = classifyComicMatches(comicRun.matches);
  const series = seriesCandidateReport(comicRun.matches, comicAssets);

  const singles = await loadPokemonSingles();
  const live = await fetchPokemonVendorsAndProducts(singles);
  const snapshotPokemon = await loadVendorProducts("pokemon");
  const seen = new Set(live.vendors.map((v) => v.vendorProductId));
  const pokemonVendors = [...live.vendors];
  for (const vendor of snapshotPokemon) {
    if (seen.has(vendor.vendorProductId)) continue;
    seen.add(vendor.vendorProductId);
    pokemonVendors.push(vendor);
  }
  const pokemonRun = await runAssetCoverageDryRun({
    vertical: "pokemon",
    slice: "pokemon-singles",
    assets: singles,
    vendors: pokemonVendors,
  });
  const pokemonHits = pokemonRun.matches.filter((m) => m.vendor && m.matchMethod === "exact_name");

  const productCache = await loadComicProductMap();
  for (const [id, product] of live.products) productCache.set(id, product);

  let mapsInserted = 0;
  let mapsReview = 0;
  let observationsBaseline = 0;
  let observationsReviewOnly = 0;
  let productsFetched = 0;
  let productsFromSnapshot = 0;

  const persist = async (
    row: AssetMatchResult,
    baselineEligible: boolean,
    writeObservationsForRow: boolean,
  ) => {
    if (!row.vendor) return;
    const mapResult = await upsertMap({
      dataSourceId: dsId,
      vendor: row.vendor,
      assetId: row.assetId,
      method: row.matchMethod,
      confidence: row.matchConfidence,
      needsReview: !baselineEligible,
    });
    if (mapResult === "inserted") {
      if (baselineEligible) mapsInserted += 1;
      else mapsReview += 1;
    }
    if (!writeObservationsForRow) return;
    const resolved = await resolveProduct(row.vendor.vendorProductId, productCache);
    if (resolved.fetched) productsFetched += 1;
    else if (resolved.product) productsFromSnapshot += 1;
    if (!resolved.product) return;
    const n = await writeObservations({
      product: resolved.product,
      assetId: row.assetId,
      dataSourceId: dsId,
      baselineEligible,
      snapshotOn,
      observedAt: now,
      rawSnapshotId: resolved.rawSnapshotId,
    });
    if (baselineEligible) observationsBaseline += n;
    else observationsReviewOnly += n;
  };

  log(`pokemon exact_name=${pokemonHits.length} comic unambiguous=${classified.unambiguous.length} ambiguous=${classified.ambiguous.length}`);
  let i = 0;
  for (const row of pokemonHits) {
    await persist(row, true, true);
    i += 1;
  }
  log(`pokemon observations done (${i})`);
  i = 0;
  for (const row of classified.unambiguous) {
    await persist(row, true, true);
    i += 1;
    if (i % 25 === 0) log(`comic unambiguous ${i}/${classified.unambiguous.length}`);
  }
  for (const row of classified.ambiguous) {
    await persist(row, false, false);
  }

  return {
    version: PHASE_B_WRITE_VERSION,
    pokemonWriteAssets: pokemonHits.length,
    comicUnambiguousAssets: classified.unambiguous.length,
    comicAmbiguousReview: classified.ambiguous.length,
    mapsInserted,
    mapsReview,
    observationsBaseline,
    observationsReviewOnly,
    productsFetched,
    productsFromSnapshot,
    series21Plus: series.series21Plus,
    series21PlusTop: series.top,
    afterIssue21Plus: series.afterIssue21Plus,
    issueParseGaps: series.issueParseGaps,
    numericIssueInSeries21: series.numericIssueInSeries21,
    longestOwnedSeriesAssets: series.longestOwnedSeriesAssets,
    phase2Enabled: false,
  };
}

export function formatPhaseBWriteReport(report: PhaseBWriteReport): string {
  const top = report.series21PlusTop
    .map((s) => `${s.series} assets=${s.assets} medianCand=${s.medianCandidates}`)
    .join("\n  ");
  return [
    `${report.version}`,
    `pokemonWriteAssets=${report.pokemonWriteAssets}`,
    `comicUnambiguous=${report.comicUnambiguousAssets} comicAmbiguousReview=${report.comicAmbiguousReview}`,
    `maps inserted=${report.mapsInserted} review=${report.mapsReview}`,
    `observations baseline=${report.observationsBaseline} reviewOnly=${report.observationsReviewOnly}`,
    `products fetched=${report.productsFetched} fromSnapshot=${report.productsFromSnapshot}`,
    `series21Plus=${report.series21Plus} numericIssueInThose=${report.numericIssueInSeries21}`,
    `afterIssue21Plus=${report.afterIssue21Plus} issueParseGaps=${report.issueParseGaps}`,
    `longestOwnedSeriesAssets=${report.longestOwnedSeriesAssets}`,
    `series21Plus top:\n  ${top}`,
    `phase2Enabled=${report.phase2Enabled}`,
  ].join("\n");
}
