import { z } from "zod";
import { ProvenanceSchema } from "@vip/evidence";

export const DealerCategorySchema = z.enum(["sports", "tcg", "comics", "sealed", "other"]);
export type DealerCategory = z.infer<typeof DealerCategorySchema>;

export const FlipActionSchema = z.enum(["buy_now", "hold", "pass"]);
export type FlipAction = z.infer<typeof FlipActionSchema>;

export const FlipCompSchema = z.object({
  id: z.string().optional(),
  price: z.number().nonnegative(),
  saleDate: z.coerce.date(),
  source: z.string().min(1).default("manual"),
  title: z.string().optional(),
});
export type FlipComp = z.infer<typeof FlipCompSchema>;

export const FlipDealInputSchema = z.object({
  assetId: z.string().optional(),
  assetName: z.string().min(1),
  category: DealerCategorySchema.default("other"),
  ageYears: z.number().nonnegative(),
  /** Census / pop at the relevant grade. Null = unknown — never treat as zero. */
  popCount: z.number().int().nonnegative().nullable(),
  listingPrice: z.number().nonnegative(),
  gradingCost: z.number().nonnegative().default(0),
  shippingCost: z.number().nonnegative().default(0),
  sellingFeePct: z.number().min(0).max(0.5).default(0.13),
  comps: z.array(FlipCompSchema).default([]),
  windowDays: z.number().int().positive().default(90),
  asOf: z.coerce.date().optional(),
  notes: z.string().optional(),
});
export type FlipDealInput = z.input<typeof FlipDealInputSchema>;
export type FlipDealInputParsed = z.output<typeof FlipDealInputSchema>;

export const FlipScoreBreakdownSchema = z.object({
  marginPts: z.number(),
  askPts: z.number(),
  liquidityPts: z.number(),
  popPts: z.number(),
  agePts: z.number(),
});
export type FlipScoreBreakdown = z.infer<typeof FlipScoreBreakdownSchema>;

export const FlipDealResultSchema = z.object({
  assetName: z.string(),
  flipScore: z.number().min(0).max(100),
  action: FlipActionSchema,
  actionLabel: z.string(),
  confidence: z.number().min(0).max(1),
  targetResaleLow: z.number().nullable(),
  targetResaleHigh: z.number().nullable(),
  targetResaleMid: z.number().nullable(),
  maxBuy: z.number().nullable(),
  buyBasis: z.number(),
  expectedExitNet: z.number().nullable(),
  expectedNetProfit: z.number().nullable(),
  marginPct: z.number().nullable(),
  matchedComps: z.number().int().nonnegative(),
  recencyDays: z.number().nullable(),
  reasonCodes: z.array(z.string()),
  supporting: z.array(z.string()),
  opposing: z.array(z.string()),
  breakdown: FlipScoreBreakdownSchema,
  engineStance: z.string(),
  engineAction: z.string(),
  provenance: ProvenanceSchema,
  howToRead: z.string(),
});
export type FlipDealResult = z.infer<typeof FlipDealResultSchema>;

export const GraderSchema = z.enum(["PSA", "CGC", "BGS"]);
export type Grader = z.infer<typeof GraderSchema>;

export const ServiceLaneSchema = z.enum(["bulk", "value", "express"]);
export type ServiceLane = z.infer<typeof ServiceLaneSchema>;

export const GradeKeySchema = z.enum(["7", "8", "9", "9.5", "10"]);
export type GradeKey = z.infer<typeof GradeKeySchema>;

export const GradingFeeTierSchema = z.object({
  id: z.string(),
  grader: GraderSchema,
  category: z.enum(["cards", "comics"]),
  name: z.string(),
  lane: ServiceLaneSchema,
  feeUsd: z.number().nonnegative(),
  turnaroundBusinessDays: z.number().int().positive(),
  maxInsuredValueUsd: z.number().nonnegative().nullable(),
  minQty: z.number().int().positive().default(1),
  status: z.enum(["active", "paused"]),
  notes: z.string(),
});
export type GradingFeeTier = z.infer<typeof GradingFeeTierSchema>;

export const GradeMarketValueSchema = z.object({
  grade: GradeKeySchema,
  marketValue: z.number().nonnegative().nullable(),
  probability: z.number().min(0).max(1).nullable(),
});
export type GradeMarketValue = z.infer<typeof GradeMarketValueSchema>;

export const BreakEvenInputSchema = z.object({
  rawCost: z.number().nonnegative(),
  grader: GraderSchema,
  category: z.enum(["cards", "comics"]).default("cards"),
  tierId: z.string().optional(),
  lane: ServiceLaneSchema.optional(),
  shippingCost: z.number().nonnegative().default(15),
  insuranceCost: z.number().nonnegative().default(0),
  sellingFeePct: z.number().min(0).max(0.5).default(0.13),
  opportunityCost: z.number().nonnegative().default(0),
  /** Optional PriceCharting / manual values per grade. */
  gradeValues: z.array(GradeMarketValueSchema).default([]),
});
export type BreakEvenInput = z.input<typeof BreakEvenInputSchema>;

export const GradeBreakEvenRowSchema = z.object({
  grade: GradeKeySchema,
  minSaleToBreakEven: z.number(),
  marketValue: z.number().nullable(),
  expectedNet: z.number().nullable(),
  roiPct: z.number().nullable(),
  coversCosts: z.boolean().nullable(),
});
export type GradeBreakEvenRow = z.infer<typeof GradeBreakEvenRowSchema>;

export const BreakEvenResultSchema = z.object({
  grader: GraderSchema,
  tier: GradingFeeTierSchema,
  rawCost: z.number(),
  allInBeforeSale: z.number(),
  sellingFeePct: z.number(),
  rows: z.array(GradeBreakEvenRowSchema),
  expectedIncrementalProfit: z.number().nullable(),
  recommendation: z.enum(["grade", "hold_raw", "sell_raw", "inspect_further"]),
  popRedFlags: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type BreakEvenResult = z.infer<typeof BreakEvenResultSchema>;

export const PriceChartingHostSchema = z.enum([
  "https://www.pricecharting.com",
  "https://www.sportscardspro.com",
]);
export type PriceChartingHost = z.infer<typeof PriceChartingHostSchema>;

export const PriceChartingConditionMapSchema = z.object({
  ungraded: z.number().nullable(),
  grade7: z.number().nullable(),
  grade8: z.number().nullable(),
  grade9: z.number().nullable(),
  grade95: z.number().nullable(),
  psa10: z.number().nullable(),
  bgs10: z.number().nullable(),
  cgc10: z.number().nullable(),
});
export type PriceChartingConditionMap = z.infer<typeof PriceChartingConditionMapSchema>;

export const PriceChartingProductSchema = z.object({
  id: z.string(),
  productName: z.string(),
  consoleName: z.string(),
  releaseDate: z.string().nullable(),
  salesVolume: z.number().nullable(),
  prices: PriceChartingConditionMapSchema,
  host: PriceChartingHostSchema,
  rawKeysPresent: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type PriceChartingProduct = z.infer<typeof PriceChartingProductSchema>;

export const CompSourceSchema = z.object({
  order: z.number().int().positive(),
  id: z.string(),
  name: z.string(),
  url: z.string(),
  useFor: z.string(),
  caveat: z.string(),
});
export type CompSource = z.infer<typeof CompSourceSchema>;

export const CompRedFlagSchema = z.object({
  id: z.string(),
  title: z.string(),
  tells: z.array(z.string()),
  doInstead: z.string(),
});
export type CompRedFlag = z.infer<typeof CompRedFlagSchema>;

export const StoreCategorySchema = z.enum(["sealed", "singles", "graded", "accessories"]);
export type StoreCategory = z.infer<typeof StoreCategorySchema>;

export const StoreSkuSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: StoreCategorySchema,
  qtyOnHand: z.number().int().nonnegative(),
  unitCost: z.number().nonnegative(),
  listPrice: z.number().nonnegative(),
  secondaryLow: z.number().nonnegative().nullable(),
  secondaryHigh: z.number().nonnegative().nullable(),
  unitsSold90d: z.number().int().nonnegative(),
  daysSinceLastSale: z.number().int().nonnegative().nullable(),
  reorderPointQty: z.number().int().nonnegative(),
  targetMarginPct: z.number(),
});
export type StoreSku = z.infer<typeof StoreSkuSchema>;

export const StoreSkuStatusSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: StoreCategorySchema,
  marginPct: z.number().nullable(),
  vsTarget: z.enum(["above", "on", "below", "unknown"]),
  daysOfSupply: z.number().nullable(),
  reorder: z.boolean(),
  deadStock: z.enum(["none", "watch", "liquidate"]),
  listVsSecondary: z.enum(["under", "in_band", "over", "no_secondary"]),
  seasonalNote: z.string(),
  nextAction: z.string(),
});
export type StoreSkuStatus = z.infer<typeof StoreSkuStatusSchema>;
