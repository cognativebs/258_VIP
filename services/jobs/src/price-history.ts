/**
 * Daily card price history job (TCGplayer source of truth).
 *
 * Scheduled or ad-hoc; both run the same function. Writes one row per
 * card/day/printing/condition into vault_market.card_price_history, so a
 * re-run on the same day updates rather than duplicates.
 *
 * Env:
 *   IQVAULT_DATABASE_DSN / DATABASE_URL   Postgres (libpq keywords or URL)
 *   VIP_PRICE_CONDITION                   default NM
 *   VIP_PRICE_CONCURRENCY                 default 4
 */
import {
  createTcgplayerPriceAdapter,
  type CardCondition,
  type PriceHistoryAdapter,
  type PriceHistoryRange,
  type PriceObservation,
} from "@vip/pricing";
import { Pool } from "pg";

export const PRICE_HISTORY_JOB = "price-history";

const DEFAULT_DSN = "postgresql://postgres:vault@localhost:5432/iqvault";

/** Python side uses libpq keyword DSNs; node-postgres wants a URL. */
export function normalizeDsn(dsn: string): string {
  if (/^postgres(ql)?:\/\//i.test(dsn)) return dsn;
  if (!dsn.includes("=")) return dsn;
  const parts: Record<string, string> = {};
  for (const token of dsn.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) parts[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
  }
  const user = encodeURIComponent(parts.user ?? "postgres");
  const password = parts.password ? `:${encodeURIComponent(parts.password)}` : "";
  const host = parts.host ?? "localhost";
  const port = parts.port ?? "5432";
  const database = encodeURIComponent(parts.dbname ?? "postgres");
  return `postgresql://${user}${password}@${host}:${port}/${database}`;
}

export function dsnFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeDsn(env.IQVAULT_DATABASE_DSN ?? env.DATABASE_URL ?? DEFAULT_DSN);
}

export type PriceHistoryOptions = {
  range?: PriceHistoryRange;
  condition?: CardCondition;
  /** Only these catalog ids (ad-hoc single-card runs). */
  cards?: string[];
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  triggeredBy?: string;
  /** Injectable for tests. */
  adapter?: PriceHistoryAdapter;
  dsn?: string;
};

export type PriceHistoryReport = {
  job: string;
  ranAt: string;
  triggeredBy: string;
  range: PriceHistoryRange;
  condition: CardCondition;
  dryRun: boolean;
  cardsConsidered: number;
  cardsPriced: number;
  cardsEmpty: number;
  cardsFailed: number;
  rowsWritten: number;
  rowsUpdated: number;
  slotsRefreshed: number;
  /** Newest observation date seen this run — the honest "prices as of". */
  newestObservedOn: string | null;
  emptyReasons: Array<{ externalId: string; reason: string }>;
};

/** CLI flags: --range=daily --cards=a,b --limit=50 --concurrency=4 --dry-run */
export function parseArgs(argv: string[]): PriceHistoryOptions {
  const opts: PriceHistoryOptions = {};
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.startsWith("--")
      ? arg.slice(2).split("=", 2)
      : [arg, undefined];
    const key = (rawKey ?? "").toLowerCase();
    const value = rawValue ?? "";
    if (key === "range" && ["daily", "quarter", "annual"].includes(value)) {
      opts.range = value as PriceHistoryRange;
    } else if (key === "backfill") {
      opts.range = (["daily", "quarter", "annual"].includes(value)
        ? value
        : "annual") as PriceHistoryRange;
    } else if (key === "condition" && value) {
      opts.condition = value.toUpperCase() as CardCondition;
    } else if (key === "cards" && value) {
      opts.cards = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "limit" && value) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.trunc(n);
    } else if (key === "concurrency" && value) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) opts.concurrency = Math.trunc(n);
    } else if (key === "dry-run" || key === "dryrun") {
      opts.dryRun = true;
    }
  }
  return opts;
}

type CardRef = { source: string; externalId: string };

async function listBinderCards(pool: Pool, limit?: number): Promise<CardRef[]> {
  // DISTINCT: the same card in two binders is one price lookup, not two.
  const res = await pool.query<{ source: string; external_id: string }>(
    `SELECT DISTINCT source, external_id
       FROM vault_tcg.binder_slot
      WHERE source = 'pokemontcg' AND external_id IS NOT NULL AND external_id <> ''
      ORDER BY external_id
      ${limit ? "LIMIT $1" : ""}`,
    limit ? [limit] : [],
  );
  return res.rows.map((r) => ({ source: r.source, externalId: r.external_id }));
}

async function upsertObservations(
  pool: Pool,
  source: string,
  observations: PriceObservation[],
): Promise<{ written: number; updated: number }> {
  let written = 0;
  let updated = 0;
  for (const o of observations) {
    const res = await pool.query<{ inserted: boolean }>(
      `INSERT INTO vault_market.card_price_history
         (source, external_id, price_source, product_id, variant, condition,
          condition_assumed, observed_on, currency, market_price,
          low_sale_price, high_sale_price, quantity_sold, transaction_count,
          prov_source, prov_method, prov_rule_version, prov_confidence,
          prov_verification, prov_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16::vault_evidence.provenance_method,$17,$18,
               $19::vault_evidence.verification_status,$20)
       ON CONFLICT ON CONSTRAINT card_price_history_daily_unique
       DO UPDATE SET
         market_price = EXCLUDED.market_price,
         low_sale_price = EXCLUDED.low_sale_price,
         high_sale_price = EXCLUDED.high_sale_price,
         quantity_sold = EXCLUDED.quantity_sold,
         transaction_count = EXCLUDED.transaction_count,
         product_id = COALESCE(EXCLUDED.product_id, vault_market.card_price_history.product_id),
         condition_assumed = EXCLUDED.condition_assumed,
         prov_method = EXCLUDED.prov_method,
         prov_confidence = EXCLUDED.prov_confidence,
         prov_verification = EXCLUDED.prov_verification,
         prov_notes = EXCLUDED.prov_notes,
         updated_at = now()
       RETURNING (first_seen_at = updated_at) AS inserted`,
      [
        source,
        o.externalId,
        o.source,
        o.productId,
        o.variant,
        o.condition,
        o.conditionAssumed,
        o.observedOn,
        o.currency,
        o.marketPrice,
        o.lowSalePrice,
        o.highSalePrice,
        o.quantitySold,
        o.transactionCount,
        o.provenance.source,
        o.provenance.method,
        o.provenance.ruleOrModelVersion,
        o.provenance.confidence,
        o.provenance.verificationStatus,
        o.provenance.notes ?? null,
      ],
    );
    if (res.rows[0]?.inserted) written += 1;
    else updated += 1;
  }
  return { written, updated };
}

/**
 * Push the newest priced day onto the binder slots holding this card, so the
 * Binder UI's "Prices as of" reflects the run.
 *
 * Two guards, both learned the hard way:
 *  - Never move the stamp backwards. An annual backfill's newest bucket is a
 *    week old, so without the timestamp guard it would make a freshly priced
 *    slot look staler than it is.
 *  - Only NM writes to the slot (see caller). A `--condition=LP` run once
 *    replaced a $852 NM value with $509 LP on the displayed collection.
 */
async function refreshSlots(
  pool: Pool,
  externalId: string,
  newest: PriceObservation,
): Promise<number> {
  const price = newest.marketPrice ?? newest.lowSalePrice;
  if (price == null) return 0;
  const observedAtMs = Date.parse(`${newest.observedOn}T00:00:00Z`);
  const res = await pool.query(
    `UPDATE vault_tcg.binder_slot
        SET price_market = $1,
            price_currency = $2,
            price_updated_at = $3,
            provenance_source = $4,
            provenance_method = $5,
            provenance_model_version = $6,
            confidence = $7,
            verification_status = $8
      WHERE source = 'pokemontcg' AND external_id = $9
        AND (price_updated_at IS NULL OR price_updated_at <= $3)`,
    [
      price,
      newest.currency,
      observedAtMs,
      newest.provenance.source,
      newest.provenance.method,
      newest.provenance.ruleOrModelVersion,
      newest.provenance.confidence,
      newest.provenance.verificationStatus,
      externalId,
    ],
  );
  return res.rowCount ?? 0;
}

/**
 * The binder's displayed value represents a Near Mint copy. Pricing another
 * condition is a legitimate query, but it must not redefine the collection's
 * headline number.
 */
export function shouldRefreshSlots(condition: CardCondition): boolean {
  return condition === "NM";
}

/** Newest row for the requested condition, preferring a real trade. */
export function pickNewest(
  observations: PriceObservation[],
  condition: CardCondition,
): PriceObservation | null {
  const wanted = observations.filter((o) => o.condition === condition);
  const pool = wanted.length > 0 ? wanted : observations;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0]!;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runPriceHistoryJob(
  options: PriceHistoryOptions = {},
): Promise<PriceHistoryReport> {
  const range = options.range ?? "daily";
  const condition =
    options.condition ??
    ((process.env.VIP_PRICE_CONDITION?.toUpperCase() as CardCondition | undefined) ?? "NM");
  const envConcurrency = Number(process.env.VIP_PRICE_CONCURRENCY ?? 4);
  const concurrency =
    options.concurrency ?? (Number.isFinite(envConcurrency) && envConcurrency > 0
      ? Math.trunc(envConcurrency)
      : 4);
  const dryRun = options.dryRun ?? false;
  const adapter = options.adapter ?? createTcgplayerPriceAdapter();

  const report: PriceHistoryReport = {
    job: PRICE_HISTORY_JOB,
    ranAt: new Date().toISOString(),
    triggeredBy: options.triggeredBy ?? "cli",
    range,
    condition,
    dryRun,
    cardsConsidered: 0,
    cardsPriced: 0,
    cardsEmpty: 0,
    cardsFailed: 0,
    rowsWritten: 0,
    rowsUpdated: 0,
    slotsRefreshed: 0,
    newestObservedOn: null,
    emptyReasons: [],
  };

  const pool = new Pool({
    connectionString: options.dsn ?? dsnFromEnv(),
    connectionTimeoutMillis: 5000,
    max: Math.max(2, Math.min(10, concurrency + 1)),
  });
  pool.on("error", () => {
    /* idle client errors must not kill the job */
  });

  try {
    const cards: CardRef[] = options.cards?.length
      ? options.cards.map((externalId) => ({ source: "pokemontcg", externalId }))
      : await listBinderCards(pool, options.limit);
    report.cardsConsidered = cards.length;

    await mapWithConcurrency(cards, concurrency, async (card) => {
      if (!adapter.matches(card.externalId, card.source)) {
        report.cardsEmpty += 1;
        report.emptyReasons.push({
          externalId: card.externalId,
          reason: `no adapter for source ${card.source}`,
        });
        return;
      }
      try {
        const result = await adapter.fetchHistory({
          externalId: card.externalId,
          range,
          condition,
        });
        if (result.observations.length === 0) {
          report.cardsEmpty += 1;
          if (result.emptyReason) {
            report.emptyReasons.push({
              externalId: card.externalId,
              reason: result.emptyReason,
            });
          }
          return;
        }

        report.cardsPriced += 1;
        for (const o of result.observations) {
          if (!report.newestObservedOn || o.observedOn > report.newestObservedOn) {
            report.newestObservedOn = o.observedOn;
          }
        }

        if (dryRun) return;

        const { written, updated } = await upsertObservations(
          pool,
          card.source,
          result.observations,
        );
        report.rowsWritten += written;
        report.rowsUpdated += updated;

        if (shouldRefreshSlots(condition)) {
          const newest = pickNewest(result.observations, condition);
          if (newest) {
            report.slotsRefreshed += await refreshSlots(pool, card.externalId, newest);
          }
        }
      } catch (e) {
        report.cardsFailed += 1;
        report.emptyReasons.push({
          externalId: card.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } finally {
    await pool.end().catch(() => {});
  }

  return report;
}

export function formatPriceHistoryReport(report: PriceHistoryReport): string {
  const lines = [
    `[${report.job}] range=${report.range} condition=${report.condition}` +
      `${report.dryRun ? " (dry-run)" : ""} triggeredBy=${report.triggeredBy}`,
    `  cards: considered=${report.cardsConsidered} priced=${report.cardsPriced} ` +
      `empty=${report.cardsEmpty} failed=${report.cardsFailed}`,
    `  rows:  new=${report.rowsWritten} updated=${report.rowsUpdated} ` +
      `slotsRefreshed=${report.slotsRefreshed}`,
    `  newest observation: ${report.newestObservedOn ?? "—"}`,
  ];
  for (const r of report.emptyReasons.slice(0, 10)) {
    lines.push(`  - ${r.externalId}: ${r.reason}`);
  }
  if (report.emptyReasons.length > 10) {
    lines.push(`  … ${report.emptyReasons.length - 10} more`);
  }
  return lines.join("\n");
}
