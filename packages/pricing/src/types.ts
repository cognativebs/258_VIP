import { ProvenanceSchema } from "@vip/evidence";
import { z } from "zod";

/**
 * Price history contracts.
 *
 * A price point is never just a number. TCGplayer's `marketPrice` is its own
 * computed value and is published even on days with zero sales, so it is
 * `normalized`, not `observed`. The observed evidence is the sale range plus
 * the transaction count — which is exactly what rule 4 requires a valuation to
 * carry (range + evidence count + recency + confidence).
 */

/** TCGplayer condition ladder, best to worst. */
export const CardConditionSchema = z.enum([
  "NM",
  "LP",
  "MP",
  "HP",
  "DMG",
  "UNKNOWN",
]);
export type CardCondition = z.infer<typeof CardConditionSchema>;

/** Map TCGplayer's condition strings onto the ladder. */
export const TCGPLAYER_CONDITIONS: Record<string, CardCondition> = {
  "near mint": "NM",
  "lightly played": "LP",
  "moderately played": "MP",
  "heavily played": "HP",
  damaged: "DMG",
};

export const PriceObservationSchema = z.object({
  /** Catalog id this price belongs to (e.g. pokemontcg `base1-4`). */
  externalId: z.string().min(1),
  /** Provider product id, kept so a run is reproducible. */
  productId: z.string().min(1).nullable(),
  source: z.string().min(1),
  /** Printing, e.g. Holofoil / Normal / Reverse Holofoil. */
  variant: z.string().min(1),
  condition: CardConditionSchema,
  /**
   * True when the provider did not report this condition and we fell back to
   * treating the price as Near Mint. Never silently presented as fact.
   */
  conditionAssumed: z.boolean(),
  /** UTC calendar day the bucket starts — the history key. */
  observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().min(1).default("USD"),

  /** Provider's computed market price for the day. */
  marketPrice: z.number().nonnegative().nullable(),
  /** Observed sale range for the day; null when nothing sold. */
  lowSalePrice: z.number().nonnegative().nullable(),
  highSalePrice: z.number().nonnegative().nullable(),
  /** Evidence count — zero means marketPrice is a model, not a trade. */
  quantitySold: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),

  provenance: ProvenanceSchema,
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

/** How far back to ask for, and at what granularity the provider answers. */
export const PriceHistoryRangeSchema = z.enum(["daily", "quarter", "annual"]);
export type PriceHistoryRange = z.infer<typeof PriceHistoryRangeSchema>;

export type PriceHistoryQuery = {
  externalId: string;
  range?: PriceHistoryRange;
  /** Preferred condition; defaults to NM. */
  condition?: CardCondition;
  /** Restrict to one printing when the caller already knows it. */
  variant?: string | null;
};

export type PriceHistoryResult = {
  adapterId: string;
  externalId: string;
  observations: PriceObservation[];
  /** Why zero observations, when empty. Never silent. */
  emptyReason?: string;
};

/**
 * Swappable price source (AGENTS.md rule 5). TCGplayer first; Card Hedge and
 * others plug in without the job changing.
 */
export type PriceHistoryAdapter = {
  id: string;
  label: string;
  /** Whether this adapter can price the given catalog id. */
  matches: (externalId: string, source?: string | null) => boolean;
  fetchHistory: (query: PriceHistoryQuery) => Promise<PriceHistoryResult>;
};
