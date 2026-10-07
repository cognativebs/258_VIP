/**
 * Phase B nightly PriceCharting CSV snapshot (ADR 0012).
 *
 * Gzip raw payload, hash-idempotent, one guide_price_observation per mapped
 * condition column. vendor_derived, confidence <= 0.75, redistribution false.
 * Does not write listing_observation or vault_core.market_price_observation.
 * Pre-adapter rows stay baseline_eligible=false.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  GUIDE_PRICE_CONFIDENCE_CEILING,
  GUIDE_PRICE_PHASE_B_BATCH,
  GUIDE_PRICE_RULE,
  GUIDE_PRICE_SOURCE,
  GuidePriceObservationSchema,
  PRICECHARTING_PRICE_KEYS,
  PriceChartingProductSchema,
  mapPriceChartingProduct,
  verticalFromConsoleName,
  type GuidePriceObservation,
  type PriceChartingProduct,
} from "@vip/core-model";
import { Pool } from "pg";
import { parsePriceChartingCsv, productsToCsv } from "./pricechartingCsv.js";
import { dsnFromEnv } from "./price-history.js";

export const PRICECHARTING_SNAPSHOT_JOB = "pricecharting-csv-snapshot";
export const PRICECHARTING_DEFAULT_BASE = "https://www.pricecharting.com";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT_DIR = join(__dirname, "..", "..", "..", "data", "raw", "pricecharting");

export type PriceChartingSnapshotOptions = {
  csvPath?: string;
  csvUrl?: string;
  fromSnapshots?: boolean;
  snapshotDir?: string;
  dryRun?: boolean;
  triggeredBy?: string;
  now?: Date;
  token?: string;
  baseUrl?: string;
  dsn?: string;
  fetchImpl?: typeof fetch;
  pool?: Pool;
};

export type PriceChartingSnapshotReport = {
  job: typeof PRICECHARTING_SNAPSHOT_JOB;
  ranAt: string;
  snapshotOn: string;
  mode: "file" | "download" | "snapshots-csv" | "reused";
  csvPath: string | null;
  gzipPath: string | null;
  payloadSha256: string | null;
  snapshotReused: boolean;
  rawSnapshotId: string | null;
  products: number;
  mappedAssets: number;
  observationsAttempted: number;
  observationsWritten: number;
  skippedUnmapped: number;
  skippedUnresolvedVertical: number;
  errors: string[];
};

export function chicagoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function observationsFromMappedProduct(input: {
  product: PriceChartingProduct;
  assetId: string;
  snapshotOn: string;
  observedAt: Date;
  rawSnapshotId: string | null;
  baselineEligible?: boolean;
}): GuidePriceObservation[] {
  const vertical = verticalFromConsoleName(input.product["console-name"]);
  const mapped = mapPriceChartingProduct(input.product, vertical);
  if (mapped.skipped) return [];
  const holdingSourceRowId = `pc:${input.product.id}:asset:${input.assetId}`;
  const observations = mapped.observations.filter((o) => o.priceType === "market_value");
  if (
    vertical === "comic" &&
    observations.some((o) => o.vendorKey !== "loose-price" && o.conditionKey === "raw_ungraded")
  ) {
    throw new Error("comic guide ladder collapsed to raw_ungraded — refusing to write");
  }
  return observations.map((o) =>
      GuidePriceObservationSchema.parse({
        assetId: input.assetId,
        holdingId: null,
        holdingSourceRowId,
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
        provNotes: "PriceCharting CSV · vendor_derived · unverified — not a sold ledger",
        ingestBatch: GUIDE_PRICE_PHASE_B_BATCH,
        baselineEligible: input.baselineEligible ?? true,
      }),
    );
}

export function formatPriceChartingSnapshotReport(report: PriceChartingSnapshotReport): string {
  const lines = [
    `${report.job} ${report.snapshotOn} mode=${report.mode}`,
    `products=${report.products} mappedAssets=${report.mappedAssets}`,
    `observations attempted=${report.observationsAttempted} written=${report.observationsWritten}`,
    `skipped unmapped=${report.skippedUnmapped} unresolvedVertical=${report.skippedUnresolvedVertical}`,
    `snapshot reused=${report.snapshotReused} sha256=${report.payloadSha256 ?? "none"}`,
  ];
  if (report.errors.length) lines.push(`errors: ${report.errors.join("; ")}`);
  return lines.join("\n");
}

function snapshotDir(opts: PriceChartingSnapshotOptions): string {
  return (
    opts.snapshotDir ??
    process.env.PRICECHARTING_SNAPSHOT_DIR ??
    DEFAULT_SNAPSHOT_DIR
  );
}

async function loadCsvText(
  opts: PriceChartingSnapshotOptions,
  pool: Pool | null,
): Promise<{
  text: string;
  mode: "file" | "download" | "snapshots-csv";
  sourceLabel: string;
}> {
  if (opts.csvPath) {
    return { text: readFileSync(opts.csvPath, "utf8"), mode: "file", sourceLabel: opts.csvPath };
  }
  const token = (opts.token ?? process.env.PRICECHARTING_TOKEN ?? "").trim();
  const envUrl = (opts.csvUrl ?? process.env.PRICECHARTING_CSV_URL ?? "").trim();
  const errors: string[] = [];
  if (envUrl) {
    if (!token && !/[?&]t=/.test(envUrl)) {
      throw new Error("PRICECHARTING_TOKEN unset and PRICECHARTING_CSV_URL has no t=");
    }
    const fetchImpl = opts.fetchImpl ?? fetch;
    const url = /[?&]t=/.test(envUrl) || !token
      ? envUrl
      : `${envUrl}${envUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
    const res = await fetchImpl(url);
    const text = await res.text();
    const label = redactPriceChartingUrl(url);
    if (res.ok && text.includes(",") && !text.trimStart().startsWith("<")) {
      return { text, mode: "download", sourceLabel: label };
    }
    errors.push(`${label} HTTP ${res.status} (not CSV)`);
  }
  const allowSnapshots = opts.fromSnapshots !== false;
  if (allowSnapshots && pool) {
    const products = await loadProductsFromRawSnapshots(pool);
    if (products.length) {
      return {
        text: productsToCsv(products),
        mode: "snapshots-csv",
        sourceLabel: "vault_evidence.raw_snapshots:pricecharting",
      };
    }
  }
  throw new Error(
    `PriceCharting CSV unavailable${errors.length ? `: ${errors.join("; ")}` : ""}. Set PRICECHARTING_CSV_URL to the Legendary Subscriptions API/Download file, pass --csv=path, or keep captured raw_snapshots.`,
  );
}

async function loadProductsFromRawSnapshots(pool: Pool): Promise<PriceChartingProduct[]> {
  const result = await pool.query<{ payload: string }>(
    `SELECT payload
       FROM vault_evidence.raw_snapshots
      WHERE source = $1 AND payload IS NOT NULL`,
    [GUIDE_PRICE_SOURCE],
  );
  const seen = new Set<string>();
  const products: PriceChartingProduct[] = [];
  for (const row of result.rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      continue;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { products?: unknown }).products)
        ? ((parsed as { products: unknown[] }).products)
        : [parsed];
    for (const item of items) {
      const product = PriceChartingProductSchema.safeParse(item);
      if (!product.success) continue;
      const existing = products.find((p) => p.id === product.data.id);
      if (!existing) {
        seen.add(product.data.id);
        products.push(product.data);
        continue;
      }
      const richer =
        PRICECHARTING_PRICE_KEYS.filter((k) => product.data[k] != null && Number(product.data[k]) > 0)
          .length >
        PRICECHARTING_PRICE_KEYS.filter((k) => existing[k] != null && Number(existing[k]) > 0).length;
      if (richer) Object.assign(existing, product.data);
    }
  }
  return products;
}

export function redactPriceChartingUrl(url: string): string {
  return url.replace(/([?&]t=)[^&]+/gi, "$1REDACTED");
}

export async function runPriceChartingSnapshotJob(
  opts: PriceChartingSnapshotOptions = {},
): Promise<PriceChartingSnapshotReport> {
  const now = opts.now ?? new Date();
  const snapshotOn = chicagoDate(now);
  const report: PriceChartingSnapshotReport = {
    job: PRICECHARTING_SNAPSHOT_JOB,
    ranAt: now.toISOString(),
    snapshotOn,
    mode: "file",
    csvPath: opts.csvPath ?? null,
    gzipPath: null,
    payloadSha256: null,
    snapshotReused: false,
    rawSnapshotId: null,
    products: 0,
    mappedAssets: 0,
    observationsAttempted: 0,
    observationsWritten: 0,
    skippedUnmapped: 0,
    skippedUnresolvedVertical: 0,
    errors: [],
  };

  const ownPool = !opts.pool;
  const pool = opts.pool ?? new Pool({ connectionString: opts.dsn ?? dsnFromEnv() });

  let csvText: string;
  try {
    const loaded = await loadCsvText(opts, pool);
    csvText = loaded.text;
    report.mode = loaded.mode;
    report.csvPath = loaded.sourceLabel;
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
    if (ownPool) await pool.end();
    return report;
  }

  const products = parsePriceChartingCsv(csvText);
  report.products = products.length;
  const gz = gzipSync(Buffer.from(csvText, "utf8"));
  const sha = createHash("sha256").update(gz).digest("hex");
  report.payloadSha256 = sha;

  const dir = snapshotDir(opts);
  mkdirSync(dir, { recursive: true });
  const gzipPath = join(dir, `${snapshotOn}-${sha.slice(0, 12)}.csv.gz`);
  writeFileSync(gzipPath, gz);
  report.gzipPath = gzipPath;

  if (opts.dryRun) {
    if (ownPool) await pool.end();
    return report;
  }

  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM vault_evidence.raw_snapshots WHERE content_hash = $1 LIMIT 1`,
      [sha],
    );
    let rawId = existing.rows[0]?.id ?? null;
    if (rawId) {
      report.snapshotReused = true;
      report.mode = "reused";
    } else {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO vault_evidence.raw_snapshots
           (source, content_hash, content_type, payload, storage_ref, byte_length, record_count,
            prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
         VALUES (
           $1, $2, 'application/gzip', NULL, $3, $4, $5,
           $1, 'observed', $6, 1.0, 'verified'
         )
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [GUIDE_PRICE_SOURCE, sha, gzipPath, gz.length, products.length, GUIDE_PRICE_RULE],
      );
      rawId = inserted.rows[0]?.id ?? null;
      if (!rawId) {
        const again = await pool.query<{ id: string }>(
          `SELECT id FROM vault_evidence.raw_snapshots WHERE content_hash = $1 LIMIT 1`,
          [sha],
        );
        rawId = again.rows[0]?.id ?? null;
        report.snapshotReused = true;
        report.mode = "reused";
      }
    }
    report.rawSnapshotId = rawId;
    if (!rawId) {
      report.errors.push("raw snapshot id missing after insert/reuse");
      return report;
    }

    const ds = await pool.query<{ data_source_id: number; redistribution_allowed: boolean }>(
      `SELECT data_source_id, redistribution_allowed
         FROM vault_market.data_source
        WHERE source_key = $1`,
      [GUIDE_PRICE_SOURCE],
    );
    const dataSourceId = ds.rows[0]?.data_source_id ?? null;
    if (ds.rows[0] && ds.rows[0].redistribution_allowed) {
      report.errors.push("pricecharting redistribution_allowed is true — refusing to write");
      return report;
    }

    const maps = await pool.query<{ vendor_product_id: string; asset_id: string }>(
      `SELECT m.vendor_product_id, m.asset_id::text
         FROM vault_market.vendor_product_map m
         JOIN vault_core.asset a ON a.id = m.asset_id
         JOIN vault_core.categories c ON c.id = a.category_id
        WHERE m.data_source_id = $1
          AND m.asset_id IS NOT NULL
          AND m.needs_review = false
          AND (
            c.kind = 'comic'
            OR (c.kind = 'pokemon' AND a.format = 'single')
          )`,
      [dataSourceId],
    );
    const assetByVendor = new Map(maps.rows.map((r) => [r.vendor_product_id, r.asset_id]));
    report.mappedAssets = assetByVendor.size;

    for (const product of products) {
      const assetId = assetByVendor.get(product.id);
      if (!assetId) {
        report.skippedUnmapped += 1;
        continue;
      }
      if (!verticalFromConsoleName(product["console-name"])) {
        report.skippedUnresolvedVertical += 1;
        continue;
      }
      const rows = observationsFromMappedProduct({
        product,
        assetId,
        snapshotOn,
        observedAt: now,
        rawSnapshotId: rawId,
      });
      for (const row of rows) {
        report.observationsAttempted += 1;
        const result = await pool.query(
          `INSERT INTO vault_market.guide_price_observation
             (asset_id, holding_id, holding_source_row_id, priced_unit_id, condition_key,
              snapshot_on, observed_at, observation_kind, source, data_source_id,
              evidence_class, guide_price, currency, raw_snapshot_id, provider_ids,
              prov_source, prov_method, prov_rule_version, prov_confidence,
              prov_verification, prov_notes, ingest_batch, baseline_eligible)
           VALUES (
             $1::uuid, NULL, $2, NULL, $3, $4::date, $5::timestamptz, $6, $7, $8,
             $9, $10, $11, $12::uuid, $13::jsonb,
             $14, 'inferred', $15, $16, 'unverified', $17, $18, true
           )
           ON CONFLICT (holding_source_row_id, condition_key, source, snapshot_on) DO NOTHING`,
          [
            row.assetId,
            row.holdingSourceRowId,
            row.conditionKey,
            row.snapshotOn,
            row.observedAt.toISOString(),
            row.observationKind,
            row.source,
            dataSourceId,
            row.evidenceClass,
            row.guidePrice,
            row.currency,
            row.rawSnapshotId,
            JSON.stringify(row.providerIds),
            row.provSource,
            row.provRuleVersion,
            row.provConfidence,
            row.provNotes,
            row.ingestBatch,
          ],
        );
        report.observationsWritten += result.rowCount ?? 0;
      }
    }
  } finally {
    if (ownPool) await pool.end();
  }
  return report;
}
