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
