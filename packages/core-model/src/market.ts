import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const SaleSchema = BaseRecordSchema.extend({
  pricedUnitId: UuidSchema,
  source: z.string().min(1),
  sourceListingId: z.string().min(1),
  salePrice: z.number().nonnegative(),
  shipping: z.number().nonnegative().default(0),
  currency: z.string().length(3).default("USD"),
  saleDate: z.coerce.date(),
  isAuction: z.boolean().nullable().optional(),
  isOutlier: z.boolean().default(false),
  matchConfidence: z.number().min(0).max(1).default(1),
  rawTitle: z.string().nullable().optional(),
});
export type Sale = z.infer<typeof SaleSchema>;

/**
 * Internal blend may include marketPrice; UI must show range + sample + recency + confidence.
 */
export const MarketValueSchema = BaseRecordSchema.extend({
  pricedUnitId: UuidSchema,
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  marketPrice: z.number().nonnegative().optional(),
  sampleSize: z.number().int().nonnegative(),
  windowDays: z.number().int().positive().default(90),
  trendPct30d: z.number().nullable().optional(),
  velocity: z.enum(["fast", "medium", "slow"]).nullable().optional(),
  liquidityScore: z.number().min(0).max(100).nullable().optional(),
  lastSaleDate: z.coerce.date().nullable().optional(),
  computedAt: z.coerce.date(),
});
export type MarketValue = z.infer<typeof MarketValueSchema>;

export const MarketValueHistorySchema = BaseRecordSchema.extend({
  pricedUnitId: UuidSchema,
  marketPrice: z.number().nonnegative(),
  sampleSize: z.number().int().nonnegative().nullable().optional(),
  asOf: z.coerce.date(),
});
export type MarketValueHistory = z.infer<typeof MarketValueHistorySchema>;

export const PopulationReportSchema = BaseRecordSchema.extend({
  assetId: UuidSchema,
  gradeCompanyId: UuidSchema,
  gradeLabel: z.string().min(1),
  popCount: z.number().int().nonnegative(),
  popHigher: z.number().int().nonnegative().nullable().optional(),
  asOf: z.coerce.date(),
});
export type PopulationReport = z.infer<typeof PopulationReportSchema>;

/** Explicit “unknown condition” — NULL is forbidden (never means any). */
export const CONDITION_KEY_ANY = "any" as const;

export const ListingObservationKindSchema = z.enum(["browse_listing", "browse_empty"]);
export type ListingObservationKind = z.infer<typeof ListingObservationKindSchema>;

/**
 * Active listing (ask) or an explicit empty Browse fetch.
 * Not a `sale` row — do not persist these into vault_market.sale.
 */
export const ListingObservationSchema = BaseRecordSchema.extend({
  assetId: UuidSchema,
  holdingId: UuidSchema.nullable(),
  holdingSourceRowId: z.string().min(1),
  conditionKey: z.string().min(1),
  observationKind: ListingObservationKindSchema,
  source: z.literal("ebay_browse"),
  listingId: z.string().min(1),
  askPrice: z.number().positive().nullable(),
  currency: z.string().length(3).default("USD"),
  listingTitle: z.string().nullable().optional(),
  listingUrl: z.string().nullable().optional(),
  observedAt: z.coerce.date(),
  listingCreatedAt: z.coerce.date().nullable().optional(),
  rawSnapshotId: UuidSchema.nullable().optional(),
  providerIds: z.record(z.string()).default({}),
}).superRefine((row, ctx) => {
  if (row.observationKind === "browse_listing" && row.askPrice == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "browse_listing requires a positive askPrice",
      path: ["askPrice"],
    });
  }
  if (row.observationKind === "browse_empty" && row.askPrice != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "browse_empty must not carry an askPrice",
      path: ["askPrice"],
    });
  }
});
export type ListingObservation = z.infer<typeof ListingObservationSchema>;

export const ComicsCompsWalkCursorSchema = z.object({
  job: z.literal("comics-comps-walk"),
  lastHoldingSourceRowId: z.string().nullable(),
  processed: z.number().int().nonnegative(),
  skippedFresh: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  wrote: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      holdingSourceRowId: z.string(),
      reason: z.string(),
    }),
  ),
  paused: z.boolean(),
  publishers: z.array(z.string()),
  updatedAt: z.string().min(1),
});
export type ComicsCompsWalkCursor = z.infer<typeof ComicsCompsWalkCursorSchema>;
