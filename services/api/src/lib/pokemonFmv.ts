/**
 * Pokémon fair-market value at read time: for Binder cards you own or
 * wishlist, a range per condition from stored PriceCharting guide snapshots
 * (vault_market.card_price_history). Ranges, snapshot counts, recency and
 * capped confidence — never a single number presented as fact, never sold
 * comps. Cards without a confirmed PriceCharting match say so.
 */
import { z } from "zod";
import { PRICECHARTING_PRICE_SOURCE, fmvFromHistory } from "@vip/pricing";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const PokemonFmvQuerySchema = z
  .object({
    externalId: z.string().regex(/^[a-z0-9.-]+$/i).optional(),
    windowDays: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict();

export async function buildPokemonFmv(
  db: Queryable,
  opts: { externalId?: string; externalIds?: ReadonlyArray<string>; windowDays?: number; asOf?: Date } = {},
) {
  const asOf = opts.asOf ?? new Date();
  const windowDays = opts.windowDays ?? 30;
  const cards = await db.query(
    `SELECT b.external_id, min(b.card_name) AS card_name, min(b.set_name) AS set_name, min(b.number) AS number,
            bool_or(b.owned) AS owned, bool_or(b.on_wishlist AND NOT b.owned) AS wishlist
       FROM vault_tcg.binder_slot b
      WHERE b.source = 'pokemontcg' AND b.external_id IS NOT NULL AND (b.owned OR b.on_wishlist)
        AND ($1::text IS NULL OR b.external_id = $1)
        AND ($2::text[] IS NULL OR b.external_id = ANY($2::text[]))
      GROUP BY b.external_id
      ORDER BY b.external_id`,
    [opts.externalId ?? null, opts.externalIds ? [...opts.externalIds] : null],
  );
  const ids = cards.rows.map((r) => r.external_id);
  const history = await db.query(
    `SELECT external_id, condition, condition_assumed, observed_on::text AS observed_on, market_price::float AS price
       FROM vault_market.card_price_history
      WHERE source = 'pokemontcg' AND price_source = $1 AND external_id = ANY($2::text[])
        AND observed_on > ($3::date - make_interval(days => $4))`,
    [PRICECHARTING_PRICE_SOURCE, ids, asOf.toISOString().slice(0, 10), windowDays],
  );
  const registry = await db.query(
    `SELECT to_regclass('vault_market.data_source') IS NOT NULL AND to_regclass('vault_market.vendor_product_map') IS NOT NULL AS ok`,
  );
  const maps = !registry.rows[0]?.ok ? { rows: [] as any[] } : await db.query(
    `SELECT jsonb_array_elements_text(m.provider_ids->'pokemontcg') AS external_id, m.vendor_product_id, m.vendor_product_name, m.needs_review
       FROM vault_market.vendor_product_map m
       JOIN vault_market.data_source d ON d.data_source_id = m.data_source_id AND d.source_key = 'pricecharting'
      WHERE m.provider_ids ? 'pokemontcg'`,
  );
  const mapByCard = new Map(maps.rows.map((m) => [m.external_id, m]));

  return {
    asOf: asOf.toISOString(),
    windowDays,
    cards: cards.rows.map((c) => {
      const m = mapByCard.get(c.external_id);
      const rows = history.rows
        .filter((h) => h.external_id === c.external_id)
        .map((h) => ({ condition: h.condition, conditionAssumed: h.condition_assumed, observedOn: h.observed_on, price: h.price }));
      return {
        externalId: c.external_id,
        name: c.card_name,
        setName: c.set_name,
        number: c.number,
        owned: Boolean(c.owned),
        wishlist: Boolean(c.wishlist),
        match: m
          ? { productId: m.vendor_product_id, productName: m.vendor_product_name, needsReview: Boolean(m.needs_review) }
          : null,
        fmv: fmvFromHistory(rows, { asOf, windowDays }),
      };
    }),
    provenance: {
      method: "read_time_range",
      evidenceClass: "vendor_guide",
      verificationStatus: "unverified",
      notes:
        "PriceCharting guide values (sale-derived), ranges over stored snapshots; confidence ≤ 0.75 (ADR 0012). Not sold comps. NM for ungraded is assumed · unverified. Matches marked needsReview are not priced until confirmed.",
    },
  };
}
