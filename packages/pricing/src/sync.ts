import {
  createTcgplayerPriceAdapter,
} from "./tcgplayer.js";
import type {
  CardCondition,
  PriceHistoryAdapter,
  PriceHistoryRange,
  PriceObservation,
} from "./types.js";

/**
 * Price-history sync core, shared by the CLI job, the scheduler, and the
 * Binder Vault button so there is exactly one implementation of "update
 * prices".
 *
 * The database is reached through an injected runner rather than a driver
 * dependency, so this package stays free of `pg` and each caller supplies its
 * own pool.
 */

export type SqlRunner = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;

export type PriceSyncOptions = {
  runner: SqlRunner;
  adapter?: PriceHistoryAdapter;
  range?: PriceHistoryRange;
  condition?: CardCondition;
  /** Only these catalog ids (ad-hoc single-card runs). */
  cards?: string[];
  /** Restrict to the cards in one binder. */
  binderId?: string | null;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  triggeredBy?: string;
};

export type PriceSyncReport = {
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

export const PRICE_HISTORY_JOB = "price-history";

type CardRef = { source: string; externalId: string };

/**
 * DISTINCT: the same card in two binders is one price lookup, not two.
 */
export async function listBinderCards(
  runner: SqlRunner,
  opts: { binderId?: string | null; limit?: number } = {},
): Promise<CardRef[]> {
  const params: unknown[] = [];
  let where = `s.source = 'pokemontcg' AND s.external_id IS NOT NULL AND s.external_id <> ''`;
  let from = `vault_tcg.binder_slot s`;

  if (opts.binderId) {
    from += ` JOIN vault_tcg.binder_page p ON p.id = s.page_id`;
    params.push(opts.binderId);
    where += ` AND p.binder_id = $${params.length}`;
  }

  let sql = `SELECT DISTINCT s.source, s.external_id FROM ${from} WHERE ${where} ORDER BY s.external_id`;
  if (opts.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const res = await runner(sql, params);
  return res.rows.map((r) => ({
    source: String(r.source),
    externalId: String(r.external_id),
  }));
}

async function upsertObservations(
  runner: SqlRunner,
  source: string,
  observations: PriceObservation[],
): Promise<{ written: number; updated: number }> {
  let written = 0;
  let updated = 0;
  for (const o of observations) {
    const res = await runner(
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
 * Binder's "Prices as of" reflects the run.
 *
 * Two guards, both learned by running it:
 *  - Never move the stamp backwards. An annual backfill's newest bucket is a
 *    week old, so without the timestamp guard it would make a freshly priced
 *    slot look staler than it is.
 *  - Only NM writes to the slot (see shouldRefreshSlots). A `condition=LP` run
 *    once replaced a $852 NM value with $509 LP on the displayed collection.
 */
async function refreshSlots(
  runner: SqlRunner,
  externalId: string,
  newest: PriceObservation,
): Promise<number> {
  const price = newest.marketPrice ?? newest.lowSalePrice;
  if (price == null) return 0;
  const observedAtMs = Date.parse(`${newest.observedOn}T00:00:00Z`);
  const res = await runner(
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

/** Newest row for the requested condition. */
export function pickNewest(
  observations: PriceObservation[],
  condition: CardCondition,
): PriceObservation | null {
  const wanted = observations.filter((o) => o.condition === condition);
  const pool = wanted.length > 0 ? wanted : observations;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0]!;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}

export async function syncPriceHistory(
  options: PriceSyncOptions,
): Promise<PriceSyncReport> {
  const range = options.range ?? "daily";
  const condition = options.condition ?? "NM";
  const concurrency = options.concurrency ?? 4;
  const dryRun = options.dryRun ?? false;
  const adapter = options.adapter ?? createTcgplayerPriceAdapter();
  const runner = options.runner;

  const report: PriceSyncReport = {
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

  const cards: CardRef[] = options.cards?.length
    ? options.cards.map((externalId) => ({ source: "pokemontcg", externalId }))
    : await listBinderCards(runner, {
        binderId: options.binderId ?? null,
        limit: options.limit,
      });
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
        runner,
        card.source,
        result.observations,
      );
      report.rowsWritten += written;
      report.rowsUpdated += updated;

      if (shouldRefreshSlots(condition)) {
        const newest = pickNewest(result.observations, condition);
        if (newest) {
          report.slotsRefreshed += await refreshSlots(runner, card.externalId, newest);
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

  return report;
}

export function formatPriceSyncReport(report: PriceSyncReport): string {
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
