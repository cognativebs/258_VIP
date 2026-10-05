/**
 * Pokémon fair-market value from PriceCharting (ADR 0012 amendment 2026-10-04).
 *
 * Cards: Binder slots you own or wishlist, plus Binder cards named by
 * synthesized signals. Each card is matched once to a PriceCharting product in
 * vault_market.vendor_product_map; only an exact English set + number + name
 * match is priced without review. Each run writes one card_price_history row
 * per priced condition per day (upsert), and keeps every PriceCharting
 * response in vault_evidence.raw_snapshots. Guide values, never sold comps.
 * Idle (blocked) without a token; never invents a price.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupPriceCharting, pricechartingTokenFromEnv, type PriceChartingLookup } from "@vip/dealer-kit";
import {
  PRICECHARTING_CARDS_VERSION,
  PRICECHARTING_PRICE_SOURCE,
  VENDOR_GUIDE_CONFIDENCE_CAP,
  conditionRows,
  matchBinderCard,
  type BinderCard,
} from "@vip/pricing";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type Lookup = (query: { q?: string; id?: string; list?: boolean }) => Promise<PriceChartingLookup>;

const CARD_SOURCE = "pokemontcg";
const ROW_CONFIDENCE = Math.min(0.7, VENDOR_GUIDE_CONFIDENCE_CAP);
const ROW_NOTE = "PriceCharting guide (sale-derived, vendor_derived per ADR 0012). Not a sold comp · unverified.";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The PriceCharting token lives in services/api/.env; load it without overriding the shell. */
/** VIP_API_ENV_FILE points at another checkout's .env (e.g. running from a git worktree). */
export function loadApiEnv(
  env: NodeJS.ProcessEnv = process.env,
  path = env.VIP_API_ENV_FILE?.trim() || join(__dirname, "..", "..", "api", ".env"),
): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut <= 0) continue;
    const k = line.slice(0, cut).trim();
    let v = line.slice(cut + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (env[k] == null || String(env[k]).trim() === "") env[k] = v;
  }
}

export type PokemonPricesReport = {
  job: "pokemon-prices";
  version: typeof PRICECHARTING_CARDS_VERSION;
  status: "succeeded" | "partial" | "blocked";
  reason: string | null;
  dryRun: boolean;
  cards: number;
  matchedNow: number;
  needsReview: number;
  unmatched: number;
  priced: number;
  rowsWritten: number;
  requests: number;
  errors: { externalId: string; reason: string }[];
};

export async function selectCards(db: Queryable, limit: number): Promise<BinderCard[]> {
  const { rows } = await db.query(
    `WITH signal_cards AS (
       SELECT DISTINCT substring(entity_ref from 'binder_card:(.*)') AS card_key
         FROM vault_signals.signal_entity WHERE entity_ref LIKE 'binder_card:%'
     )
     SELECT DISTINCT ON (b.external_id) b.external_id, b.card_name, b.set_name, b.number
       FROM vault_tcg.binder_slot b
      WHERE b.source = $1 AND b.external_id IS NOT NULL AND b.card_name IS NOT NULL AND b.set_name IS NOT NULL
        AND (b.owned OR b.on_wishlist
             OR lower(regexp_replace(b.card_name, '[^A-Za-z0-9]+', '-', 'g')) IN (SELECT card_key FROM signal_cards))
      ORDER BY b.external_id
      LIMIT $2`,
    [CARD_SOURCE, limit],
  ).catch(async (e) => {
    // vault_signals may not exist in an old database; Binder wants alone still work.
    if (!/signal_entity/.test(String(e))) throw e;
    return db.query(
      `SELECT DISTINCT ON (external_id) external_id, card_name, set_name, number FROM vault_tcg.binder_slot
        WHERE source = $1 AND external_id IS NOT NULL AND card_name IS NOT NULL AND set_name IS NOT NULL AND (owned OR on_wishlist)
        ORDER BY external_id LIMIT $2`,
      [CARD_SOURCE, limit],
    );
  });
  return rows.map((r) => ({ externalId: r.external_id, name: r.card_name, setName: r.set_name, number: r.number }));
}

async function snapshot(db: Queryable, raw: string | undefined, records: number): Promise<void> {
  if (!raw) return;
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  await db.query(
    `INSERT INTO vault_evidence.raw_snapshots
       (source, content_hash, content_type, payload, byte_length, record_count, prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
     VALUES ('pricecharting', $1, 'application/json', $2, $3, $4, 'pricecharting', 'observed', $5, $6, 'unverified')
     ON CONFLICT (content_hash) DO NOTHING`,
    [hash, raw, Buffer.byteLength(raw, "utf8"), records, PRICECHARTING_CARDS_VERSION, ROW_CONFIDENCE],
  );
}

export async function runPokemonPrices(
  db: Queryable,
  opts: { dryRun?: boolean; limit?: number; now?: Date; lookup?: Lookup; minGapMs?: number; token?: string | null } = {},
): Promise<PokemonPricesReport> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const report: PokemonPricesReport = {
    job: "pokemon-prices",
    version: PRICECHARTING_CARDS_VERSION,
    status: "succeeded",
    reason: null,
    dryRun: Boolean(opts.dryRun),
    cards: 0,
    matchedNow: 0,
    needsReview: 0,
    unmatched: 0,
    priced: 0,
    rowsWritten: 0,
    requests: 0,
    errors: [],
  };
  const token = opts.token !== undefined ? opts.token : pricechartingTokenFromEnv();
  if (!opts.lookup && !token) {
    return { ...report, status: "blocked", reason: "PRICECHARTING_TOKEN is not set (services/api/.env) — no prices fetched, none invented" };
  }
  const gap = opts.minGapMs ?? Number(process.env.VIP_PRICECHARTING_MIN_GAP_MS ?? 1100);
  let last = 0;
  const lookup: Lookup = async (q) => {
    const wait = last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    report.requests += 1;
    return opts.lookup ? opts.lookup(q) : lookupPriceCharting({ ...q, category: "tcg" }, { token });
  };

  if (!(await hasPriceChartingRegistry(db))) {
    return { ...report, status: "blocked", reason: REGISTRY_MISSING };
  }
  const ds = await db.query(`SELECT data_source_id FROM vault_market.data_source WHERE source_key = 'pricecharting'`);
  if (!ds.rows[0]) return { ...report, status: "blocked", reason: "vault_market.data_source has no pricecharting row" };
  const dataSourceId = ds.rows[0].data_source_id;

  const cards = await selectCards(db, opts.limit ?? 500);
  report.cards = cards.length;
  for (const card of cards) {
    try {
      const mapped = await db.query(
        `SELECT vendor_product_id, needs_review FROM vault_market.vendor_product_map
          WHERE data_source_id = $1 AND provider_ids->'pokemontcg' ? $2
          ORDER BY needs_review, match_confidence DESC NULLS LAST LIMIT 1`,
        [dataSourceId, card.externalId],
      );
      let productId: string | null = mapped.rows[0]?.vendor_product_id ?? null;
      let reviewed = mapped.rows[0] ? !mapped.rows[0].needs_review : false;
      let fromSearch: Extract<PriceChartingLookup, { ok: true }>["product"] | null = null;

      if (!mapped.rows[0]) {
        const found = await lookup({ q: `${card.name} ${card.setName} ${card.number ?? ""}`.trim(), list: true });
        if (!found.ok) {
          report.unmatched += 1;
          continue;
        }
        if (!opts.dryRun) await snapshot(db, found.rawJson, found.products?.length ?? 1);
        const candidates = (found.products ?? [found.product]).map((p) => ({ id: p.id, productName: p.productName, consoleName: p.consoleName }));
        const match = matchBinderCard(card, candidates);
        if (!match.productId) {
          report.unmatched += 1;
          continue;
        }
        productId = match.productId;
        reviewed = !match.needsReview;
        if (match.needsReview) report.needsReview += 1;
        else report.matchedNow += 1;
        fromSearch = (found.products ?? [found.product]).find((p) => p.id === match.productId) ?? null;
        if (!opts.dryRun) {
          await db.query(
            `INSERT INTO vault_market.vendor_product_map (
               data_source_id, vendor_product_id, vendor_product_name, vendor_console_name, match_method, match_confidence,
               needs_review, first_seen_at, last_seen_at, provider_ids, prov_source, prov_method, prov_rule_version,
               prov_confidence, prov_verification, prov_notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, jsonb_build_object('pokemontcg', jsonb_build_array($9::text)),
                       'pricecharting', 'inferred', $10, $6, 'unverified', $11)
             ON CONFLICT (data_source_id, vendor_product_id) DO UPDATE
               SET last_seen_at = EXCLUDED.last_seen_at,
                   provider_ids = jsonb_set(
                     vault_market.vendor_product_map.provider_ids, '{pokemontcg}',
                     (SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM jsonb_array_elements_text(
                        coalesce(vault_market.vendor_product_map.provider_ids->'pokemontcg', '[]'::jsonb) || to_jsonb($9::text)) AS v))`,
            [dataSourceId, match.productId, match.productName, candidates.find((c) => c.id === match.productId)?.consoleName ?? null, match.method, match.confidence, match.needsReview, now, card.externalId, PRICECHARTING_CARDS_VERSION, `${card.name} · ${card.setName} #${card.number ?? "?"}: ${match.reason}`],
          );
        }
      } else if (!reviewed) {
        report.needsReview += 1;
      }

      if (!productId || !reviewed) continue;
      let product = fromSearch;
      if (!product) {
        const byId = await lookup({ id: productId });
        if (!byId.ok) {
          report.errors.push({ externalId: card.externalId, reason: byId.emptyReason });
          continue;
        }
        if (!opts.dryRun) await snapshot(db, byId.rawJson, 1);
        product = byId.product;
      }
      const rows = conditionRows(product.prices);
      if (rows.length) report.priced += 1;
      if (opts.dryRun) continue;
      for (const r of rows) {
        await db.query(
          `INSERT INTO vault_market.card_price_history (
             source, external_id, price_source, product_id, variant, condition, condition_assumed, observed_on, currency,
             market_price, prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
           ) VALUES ($1, $2, $3, $4, 'default', $5, $6, $7, 'USD', $8, 'pricecharting', 'observed', $9, $10, 'unverified', $11)
           ON CONFLICT (source, external_id, price_source, variant, condition, observed_on)
           DO UPDATE SET market_price = EXCLUDED.market_price, product_id = EXCLUDED.product_id, updated_at = now()`,
          [CARD_SOURCE, card.externalId, PRICECHARTING_PRICE_SOURCE, productId, r.condition, r.conditionAssumed, today, r.price, PRICECHARTING_CARDS_VERSION, ROW_CONFIDENCE, ROW_NOTE],
        );
        report.rowsWritten += 1;
      }
    } catch (e) {
      report.errors.push({ externalId: card.externalId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (report.errors.length) report.status = "partial";
  return report;
}

/** The PriceCharting registry (vault_market.data_source + vendor_product_map) ships with the pricecharting-core-wiring migrations. */
export const REGISTRY_MISSING =
  "vault_market.data_source / vendor_product_map are missing — apply the PriceCharting registry migrations (20260917_01, 20260920_02) first";

export async function hasPriceChartingRegistry(db: Queryable): Promise<boolean> {
  const r = await db.query(
    `SELECT to_regclass('vault_market.data_source') IS NOT NULL AND to_regclass('vault_market.vendor_product_map') IS NOT NULL AS ok`,
  );
  return Boolean(r.rows[0]?.ok);
}

export type ReviewRow = { externalId: string; card: string; productId: string; productName: string; reason: string | null; confidence: number | null };

export async function listReview(db: Queryable): Promise<ReviewRow[]> {
  if (!(await hasPriceChartingRegistry(db))) return [];
  const { rows } = await db.query(
    `SELECT m.vendor_product_id, m.vendor_product_name, m.prov_notes, m.match_confidence::float AS conf,
            jsonb_array_elements_text(m.provider_ids->'pokemontcg') AS external_id
       FROM vault_market.vendor_product_map m
       JOIN vault_market.data_source d ON d.data_source_id = m.data_source_id AND d.source_key = 'pricecharting'
      WHERE m.needs_review AND m.provider_ids ? 'pokemontcg'
      ORDER BY external_id`,
  );
  return rows.map((r) => ({
    externalId: r.external_id,
    card: (r.prov_notes ?? "").split(":")[0],
    productId: r.vendor_product_id,
    productName: r.vendor_product_name,
    reason: r.prov_notes,
    confidence: r.conf,
  }));
}

/**
 * Operator confirms a reviewed match (optionally a different PriceCharting product id).
 * confirmed_at stays NULL: the registry locks confirmed rows to an asset_id, and cards
 * have no asset until TCG plan v2 D1/D2 — the confirmation lives in method + verification.
 */
export async function confirmMatch(db: Queryable, externalId: string, productId?: string): Promise<boolean> {
  if (!(await hasPriceChartingRegistry(db))) return false;
  const r = await db.query(
    `UPDATE vault_market.vendor_product_map m
        SET needs_review = false, match_method = 'manual', prov_verification = 'verified',
            prov_notes = concat_ws(' · ', m.prov_notes, 'confirmed by operator ' || to_char(now(), 'YYYY-MM-DD'))
       FROM vault_market.data_source d
      WHERE d.data_source_id = m.data_source_id AND d.source_key = 'pricecharting'
        AND m.provider_ids->'pokemontcg' ? $1 AND ($2::text IS NULL OR m.vendor_product_id = $2)
      RETURNING m.vendor_product_id`,
    [externalId, productId ?? null],
  );
  return r.rows.length > 0;
}

export function formatPokemonPricesReport(r: PokemonPricesReport): string {
  return [
    `VIP Job — pokemon-prices (${r.version})${r.dryRun ? " · dry run" : ""} · status: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`,
    `cards ${r.cards} · matched now ${r.matchedNow} · needs review ${r.needsReview} · unmatched ${r.unmatched} · priced ${r.priced} · rows ${r.rowsWritten} · requests ${r.requests}`,
    ...r.errors.map((e) => `  ${e.externalId}: ${e.reason}`),
  ].join("\n");
}
