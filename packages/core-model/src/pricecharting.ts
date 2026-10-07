import { z } from "zod";

/**
 * PriceCharting contracts (PC-CORE-01 Phase A, adapted to live VIP schema).
 *
 * PriceCharting product IDs are grade-agnostic. The join is asset_id.
 * Condition is applied at observation time — never baked into the vendor map.
 * Prices arrive as integer pennies. Mapper converts to dollars.
 */

export const EVIDENCE_CLASS_KEYS = [
  "observed",
  "normalized",
  "vendor_derived",
  "inferred",
  "opinion",
] as const;
export type EvidenceClassKey = (typeof EVIDENCE_CLASS_KEYS)[number];

export const EvidenceClassSchema = z.object({
  evidenceClass: z.enum(EVIDENCE_CLASS_KEYS),
  description: z.string().min(1),
  isFactual: z.boolean(),
  confidenceCeiling: z.number().min(0).max(1),
});
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

export const EVIDENCE_CLASS_CEILING: Record<EvidenceClassKey, number> = {
  observed: 1.0,
  normalized: 0.95,
  vendor_derived: 0.75,
  inferred: 0.7,
  opinion: 0.6,
};

export const DATA_SOURCE_KEYS = ["pricecharting", "ebay_browse"] as const;
export type DataSourceKey = (typeof DATA_SOURCE_KEYS)[number];

export const DataSourceAccessMethodSchema = z.enum([
  "rest_api",
  "bulk_csv",
  "scraper",
  "manual",
]);

export const DataSourceSchema = z.object({
  sourceKey: z.string().min(1),
  displayName: z.string().min(1),
  accessMethod: DataSourceAccessMethodSchema,
  defaultEvidenceClass: z.enum(EVIDENCE_CLASS_KEYS),
  redistributionAllowed: z.boolean(),
  latencyMinutes: z.number().int().nonnegative().nullable(),
  categoryCoverage: z.array(z.string()),
  isActive: z.boolean().default(true),
  historicalAccuracy: z.number().min(0).max(1).nullable().optional(),
  accuracySampleN: z.number().int().nonnegative().default(0),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

/**
 * Condition tokens used by listing_observation and PriceCharting mapping.
 * NULL is forbidden. `any` means unknown — never “match all”.
 *
 * Keys are finer than PC-CORE-01’s graded_10 collapse: official PriceCharting
 * docs distinguish PSA 10 / BGS 10 / CGC 10 / SGC 10, and the same JSON key
 * means a different grade per vertical.
 */
export const CONDITION_KEYS = [
  "any",
  "raw_ungraded",
  "cib",
  "sealed_new",
  "box_only",
  "manual_only",
  "graded_wata",
  "graded_4",
  "graded_6",
  "graded_7",
  "graded_8",
  "graded_9",
  "graded_9_2",
  "graded_9_4",
  "graded_9_5",
  "graded_9_8",
  "graded_10",
  "graded_psa_10",
  "graded_bgs_10",
  "graded_cgc_10",
  "graded_sgc_10",
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export const ConditionKeySchema = z.enum(CONDITION_KEYS);

export const PRICECHARTING_VERTICALS = [
  "comic",
  "pokemon",
  "sports",
  "mtg",
  "video_games",
  "other",
] as const;
export type PriceChartingVertical = (typeof PRICECHARTING_VERTICALS)[number];

export const PriceChartingVerticalSchema = z.enum(PRICECHARTING_VERTICALS);

/** Official Prices API keys that are dollar amounts (pennies). */
export const PRICECHARTING_PRICE_KEYS = [
  "loose-price",
  "cib-price",
  "new-price",
  "graded-price",
  "box-only-price",
  "manual-only-price",
  "bgs-10-price",
  "condition-17-price",
  "condition-18-price",
  "retail-loose-buy",
  "retail-loose-sell",
  "retail-cib-buy",
  "retail-cib-sell",
  "retail-new-buy",
  "retail-new-sell",
] as const;
export type PriceChartingPriceKey = (typeof PRICECHARTING_PRICE_KEYS)[number];

export const PriceTypeSchema = z.enum(["market_value", "retail_buy", "retail_sell"]);
export type PriceType = z.infer<typeof PriceTypeSchema>;

export const VendorMatchMethodSchema = z.enum([
  "upc",
  "exact_name",
  "trgm",
  "manual",
  "unmatched",
]);
export type VendorMatchMethod = z.infer<typeof VendorMatchMethodSchema>;

export const VendorProductMapSchema = z.object({
  vendorProductId: z.string().min(1),
  vendorProductName: z.string().min(1),
  vendorConsoleName: z.string().nullable(),
  vendorUpc: z.string().nullable(),
  assetId: z.string().uuid().nullable(),
  pricedUnitId: z.string().uuid().nullable(),
  matchMethod: VendorMatchMethodSchema,
  matchConfidence: z.number().min(0).max(1).nullable(),
  needsReview: z.boolean(),
  confirmedAt: z.coerce.date().nullable().optional(),
  confirmedBy: z.string().nullable().optional(),
});
export type VendorProductMap = z.infer<typeof VendorProductMapSchema>;

const pennyOrNull = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

/** Raw Prices API / CSV row. Keys keep vendor hyphenation. */
export const PriceChartingProductSchema = z.object({
  status: z.string().optional(),
  id: z.union([z.string(), z.number()]).transform(String),
  "product-name": z.string().min(1),
  "console-name": z.string().optional().nullable(),
  upc: z.string().optional().nullable(),
  asin: z.string().optional().nullable(),
  epid: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  "release-date": z.string().optional().nullable(),
  "sales-volume": pennyOrNull,
  "loose-price": pennyOrNull,
  "cib-price": pennyOrNull,
  "new-price": pennyOrNull,
  "graded-price": pennyOrNull,
  "box-only-price": pennyOrNull,
  "manual-only-price": pennyOrNull,
  "bgs-10-price": pennyOrNull,
  "condition-17-price": pennyOrNull,
  "condition-18-price": pennyOrNull,
  "retail-loose-buy": pennyOrNull,
  "retail-loose-sell": pennyOrNull,
  "retail-cib-buy": pennyOrNull,
  "retail-cib-sell": pennyOrNull,
  "retail-new-buy": pennyOrNull,
  "retail-new-sell": pennyOrNull,
});
export type PriceChartingProduct = z.infer<typeof PriceChartingProductSchema>;

export const MappedPriceObservationSchema = z.object({
  vendorProductId: z.string().min(1),
  vendorKey: z.enum(PRICECHARTING_PRICE_KEYS),
  priceType: PriceTypeSchema,
  channel: z.literal("pricecharting"),
  conditionKey: ConditionKeySchema,
  priceUsd: z.number().nonnegative(),
  evidenceClass: z.literal("vendor_derived"),
});
export type MappedPriceObservation = z.infer<typeof MappedPriceObservationSchema>;

export const PRICECHARTING_SOURCE_TERMS =
  "Legendary subscription; current values only; no history; redistribution_allowed=false.";
