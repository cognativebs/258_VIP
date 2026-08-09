import { z } from "zod";
import { UserConstraintsSchema } from "@vip/core-model";

export const ENGINE_VERSION = "decision-engine@0.1.0";

/** Phase 2 engine stance. Watch maps to canonical Hold + reasonCode WATCH. */
export const EngineStanceSchema = z.enum(["Buy", "Watch", "Pass"]);
export type EngineStance = z.infer<typeof EngineStanceSchema>;

export const CostLineSchema = z.object({
  askPrice: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  buyerPremium: z.number().nonnegative().default(0),
  shipping: z.number().nonnegative().default(0),
  grading: z.number().nonnegative().default(0),
  expectedSellingFees: z.number().nonnegative().default(0),
});
export type CostLine = z.infer<typeof CostLineSchema>;

export const AllInCostResultSchema = z.object({
  askPrice: z.number().nonnegative(),
  tax: z.number().nonnegative(),
  buyerPremium: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  grading: z.number().nonnegative(),
  expectedSellingFees: z.number().nonnegative(),
  allIn: z.number().nonnegative(),
  exitNetIfSoldAtMid: z.number().nullable(),
  components: z.array(
    z.object({
      key: z.string(),
      amount: z.number(),
      included: z.boolean(),
    }),
  ),
  ruleOrModelVersion: z.string(),
});
export type AllInCostResult = z.infer<typeof AllInCostResultSchema>;

export const SaleCompSchema = z.object({
  id: z.string(),
  price: z.number().nonnegative(),
  saleDate: z.coerce.date(),
  source: z.string(),
  title: z.string().optional(),
});
export type SaleComp = z.infer<typeof SaleCompSchema>;

export const MarketRangeInputSchema = z.object({
  sales: z.array(SaleCompSchema).default([]),
  asOf: z.coerce.date().optional(),
  windowDays: z.number().int().positive().default(90),
});
export type MarketRangeInput = z.infer<typeof MarketRangeInputSchema>;

/**
 * Always a range — never a single point presented as fact.
 * mid is internal blend only.
 */
export const MarketRangeResultSchema = z.object({
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  mid: z.number().nonnegative().optional(),
  matchedSales: z.number().int().nonnegative(),
  recencyDays: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  confidenceBand: z.enum(["low", "medium", "high"]),
  windowDays: z.number().int().positive(),
  evidenceIds: z.array(z.string()),
  ruleOrModelVersion: z.string(),
});
export type MarketRangeResult = z.infer<typeof MarketRangeResultSchema>;

export const LiquidityResultSchema = z.object({
  score: z.number().min(0).max(100),
  band: z.enum(["illiquid", "slow", "medium", "fast"]),
  salesPerMonth: z.number().nonnegative(),
  matchedSales: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  ruleOrModelVersion: z.string(),
});
export type LiquidityResult = z.infer<typeof LiquidityResultSchema>;

export const TargetPriceResultSchema = z.object({
  targetAsk: z.number().nonnegative().nullable(),
  maxBuy: z.number().nonnegative().nullable(),
  basis: z.enum(["range_mid", "range_low", "constrained", "insufficient_evidence"]),
  notes: z.array(z.string()),
  ruleOrModelVersion: z.string(),
});
export type TargetPriceResult = z.infer<typeof TargetPriceResultSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "sale",
    "range",
    "liquidity",
    "cost",
    "constraint",
    "collection_fit",
    "risk",
    "signal",
  ]),
  summary: z.string(),
  polarity: z.enum(["supporting", "opposing", "neutral"]),
  weight: z.number().min(0).max(1).default(0.5),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const SignalEvidenceRefSchema = z.object({
  id: z.string(),
  body: z.string().optional(),
  title: z.string().optional(),
  signalType: z.string().optional(),
  quarantineStatus: z.string().optional(),
  provenance: z
    .object({
      source: z.string().optional(),
      verificationStatus: z.string().optional(),
    })
    .optional(),
});

export const DecisionInputSchema = z.object({
  assetId: z.string(),
  assetName: z.string(),
  askPrice: z.number().nonnegative().nullable().optional(),
  sales: z.array(SaleCompSchema).default([]),
  windowDays: z.number().int().positive().optional().default(90),
  costContext: CostLineSchema.partial().optional(),
  collectionFit: z
    .object({
      inHunt: z.boolean().default(false),
      huntSlug: z.string().optional(),
      isDuplicate: z.boolean().default(false),
      pillar: z.string().optional(),
    })
    .optional(),
  /** Optional intelligence signals — bridged via signalsToEvidenceRefs. */
  signalEvidence: z.array(SignalEvidenceRefSchema).optional().default([]),
  constraints: UserConstraintsSchema.default({ collectionGoals: [] }),
  asOf: z.coerce.date().optional(),
});
/** Accept partial defaults at call sites; parse to normalize. */
export type DecisionInput = z.input<typeof DecisionInputSchema>;
export type DecisionInputParsed = z.output<typeof DecisionInputSchema>;

export const EngineRecommendationSchema = z.object({
  /** Canonical VIP action (Watch → Hold). */
  action: z.enum(["Buy", "Hold", "Grade", "Sell", "Lot", "Pass"]),
  /** Phase 2 stance for Buy / Watch / Pass gate. */
  stance: EngineStanceSchema,
  reasonCodes: z.array(z.string()),
  supportingEvidence: z.array(EvidenceItemSchema),
  opposingEvidence: z.array(EvidenceItemSchema),
  confidence: z.number().min(0).max(1),
  marketRange: MarketRangeResultSchema.nullable(),
  liquidity: LiquidityResultSchema.nullable(),
  allInCost: AllInCostResultSchema.nullable(),
  targetPrice: TargetPriceResultSchema.nullable(),
  constraintsSnapshot: UserConstraintsSchema,
  ruleOrModelVersion: z.string(),
});
export type EngineRecommendation = z.infer<typeof EngineRecommendationSchema>;

/** Configurable thresholds — no magic numbers buried in rule bodies. */
export const RuleConfigSchema = z.object({
  minSalesForBuy: z.number().int().nonnegative().default(3),
  minConfidenceForBuy: z.number().min(0).max(1).default(0.55),
  maxAskOverHighPct: z.number().nonnegative().default(0.05),
  buyUnderLowBufferPct: z.number().nonnegative().default(0.02),
  watchBandPct: z.number().nonnegative().default(0.12),
  minLiquidityForBuy: z.number().min(0).max(100).default(35),
  taxRateDefault: z.number().min(0).max(1).default(0.0),
  sellingFeeRateDefault: z.number().min(0).max(1).default(0.13),
  gradingCostDefault: z.number().nonnegative().default(0),
  premiumRateDefault: z.number().min(0).max(1).default(0),
  shippingDefault: z.number().nonnegative().default(0),
  lowRiskMaxAskPremiumPct: z.number().nonnegative().default(0.0),
  highRiskMaxAskPremiumPct: z.number().nonnegative().default(0.1),
});
export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export const DEFAULT_RULE_CONFIG: RuleConfig = RuleConfigSchema.parse({});
