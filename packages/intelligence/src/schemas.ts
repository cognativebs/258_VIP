import { z } from "zod";
import { ProvenanceSchema } from "@vip/evidence";

export const UuidSchema = z.string().uuid();
export const ProbabilitySchema = z.number().min(0).max(1);
export const Score100Schema = z.number().min(0).max(100);

export const PriceDirectionSchema = z.enum(["down", "sideways", "up"]);
export type PriceDirection = z.infer<typeof PriceDirectionSchema>;

export const RecommendationActionSchema = z.enum([
  "buy",
  "sell",
  "hold",
  "grade",
  "watch",
  "negotiate",
  "pass",
  "upgrade",
  "lot",
  "inspect_further",
]);
export type RecommendationAction = z.infer<typeof RecommendationActionSchema>;

export const EvidenceSourceSchema = z.enum([
  "shelf_observation",
  "ebay_browse",
  "sold_comp",
  "ownership_record",
  "collection_fit_score",
  "pop_report",
  "signals_feed",
  "manual",
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const SourceSystemSchema = z.enum([
  "prediction_ledger",
  "recommendation_evidence_engine",
  "acquisition_underwriting",
  "grading_optimizer",
  "museum_synergy_score",
  "binder_chase_architecture",
  "manual",
]);
export type SourceSystem = z.infer<typeof SourceSystemSchema>;

export const GradingRecommendationSchema = z.enum([
  "grade",
  "hold_raw",
  "sell_raw",
  "inspect_further",
]);
export type GradingRecommendation = z.infer<typeof GradingRecommendationSchema>;

export const BinderPageTypeSchema = z.enum(["museum_page", "cultural_icons"]);
export type BinderPageType = z.infer<typeof BinderPageTypeSchema>;

export const BinderSlotTierSchema = z.enum([
  "museum_anchor",
  "binder_core",
  "completion",
  "filler",
]);
export type BinderSlotTier = z.infer<typeof BinderSlotTierSchema>;

export const RipVsSinglesSchema = z.enum(["complete", "rip_candidate", "buy_singles"]);
export type RipVsSingles = z.infer<typeof RipVsSinglesSchema>;

export const CollectionGoalTypeSchema = z.enum([
  "master_collection",
  "museum_page",
  "cultural_icons",
  "binder_core",
]);
export type CollectionGoalType = z.infer<typeof CollectionGoalTypeSchema>;

export const CycleStateSchema = z.enum([
  "fomo",
  "cooling",
  "accumulation",
  "recovery",
  "blue_chip",
]);
export type CycleState = z.infer<typeof CycleStateSchema>;

export const FieldModeSchema = z.enum(["store", "show", "auction", "trade"]);
export type FieldMode = z.infer<typeof FieldModeSchema>;

/** Providers in scope for this phase. Yu-Gi-Oh and SportsCardsPro are excluded. */
export const IdentificationProviderNameSchema = z.enum([
  "cardsight",
  "tcgdex",
  "scryfall",
  "mtgjson",
  "card_hedge",
]);
export type IdentificationProviderName = z.infer<typeof IdentificationProviderNameSchema>;

export const PredictionSchema = z
  .object({
    id: UuidSchema,
    assetId: UuidSchema,
    predictedAt: z.coerce.date(),
    priceAtPrediction: z.number().nonnegative(),
    horizonDays: z.number().int().positive(),
    resolvesAt: z.coerce.date(),
    probabilityDown: ProbabilitySchema,
    probabilitySideways: ProbabilitySchema,
    probabilityUp: ProbabilitySchema,
    assumptions: z.string().nullable().optional(),
    evidenceIds: z.array(UuidSchema).default([]),
    confidence: ProbabilitySchema.nullable().optional(),
    modelVersion: z.string().min(1),
    actualPrice: z.number().nonnegative().nullable().optional(),
    actualDirection: PriceDirectionSchema.nullable().optional(),
    forecastError: z.number().nullable().optional(),
    explanation: z.string().nullable().optional(),
    modelAdjustment: z.string().nullable().optional(),
    resolvedAt: z.coerce.date().nullable().optional(),
    createdAt: z.coerce.date(),
    provenance: ProvenanceSchema,
  })
  .superRefine((row, ctx) => {
    const sum = row.probabilityDown + row.probabilitySideways + row.probabilityUp;
    if (sum < 0.98 || sum > 1.02) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `probability distribution must sum to ~1.0 (got ${sum})`,
      });
    }
    const resolved = row.resolvedAt != null;
    const hasOutcome = row.actualPrice != null && row.actualDirection != null;
    if (resolved !== hasOutcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resolution fields must be all-null or all-set together",
      });
    }
  });
export type Prediction = z.infer<typeof PredictionSchema>;

export const EvidenceCardSchema = z.object({
  id: UuidSchema,
  recommendationId: UuidSchema,
  evidenceSource: EvidenceSourceSchema,
  evidenceTimestamp: z.coerce.date(),
  freshnessHours: z.number().nonnegative(),
  confidence: ProbabilitySchema.nullable().optional(),
  supportingEvidence: z.string().nullable().optional(),
  contradictoryEvidence: z.string().nullable().optional(),
  missingInformation: z.string().nullable().optional(),
  confidenceWouldIncreaseIf: z.string().nullable().optional(),
  rawReferenceId: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  provenance: ProvenanceSchema,
});
export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;

export const RecommendationRecordSchema = z
  .object({
    id: UuidSchema,
    assetId: UuidSchema.nullable().optional(),
    holdingId: UuidSchema.nullable().optional(),
    action: RecommendationActionSchema,
    confidence: ProbabilitySchema,
    rationale: z.string().nullable().optional(),
    createdAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    sourceSystem: SourceSystemSchema,
    isStale: z.boolean(),
    evidence: z.array(EvidenceCardSchema).min(1),
    provenance: ProvenanceSchema,
  })
  .refine((row) => row.assetId != null || row.holdingId != null, {
    message: "recommendation requires assetId or holdingId",
  });
export type RecommendationRecord = z.infer<typeof RecommendationRecordSchema>;

export const UnderwritingSchema = z.object({
  id: UuidSchema,
  assetId: UuidSchema.nullable().optional(),
  lotDescription: z.string().nullable().optional(),
  evaluatedAt: z.coerce.date(),
  askingPrice: z.number().nonnegative(),
  offerPrice: z.number().positive(),
  conservativeRawValue: z.number().nonnegative(),
  likelyRawValue: z.number().nonnegative().nullable().optional(),
  museumKeepValue: z.number().nonnegative().nullable().optional(),
  liquidationValue: z.number().nonnegative().nullable().optional(),
  sellingCosts: z.number().nonnegative().nullable().optional(),
  expectedDaysToLiquidate: z.number().int().nonnegative().nullable().optional(),
  acquisitionCoverageRatio: z.number(),
  coverageRatioMinimumThreshold: z.number().positive(),
  belowThreshold: z.boolean(),
  /** Always false — coverage below threshold flags, never auto-blocks. */
  blocked: z.literal(false),
  expectedProfit: z.number().nullable().optional(),
  capitalAtRisk: z.number().nullable().optional(),
  confidence: ProbabilitySchema.nullable().optional(),
  linkedRecommendationId: UuidSchema.nullable().optional(),
  completedTransaction: z.boolean(),
  lockedAt: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  provenance: ProvenanceSchema,
});
export type Underwriting = z.infer<typeof UnderwritingSchema>;

export const GradingEvaluationSchema = z.object({
  id: UuidSchema,
  holdingId: UuidSchema,
  evaluatedAt: z.coerce.date(),
  rawValue: z.number().nonnegative(),
  psa7Probability: ProbabilitySchema.nullable().optional(),
  psa7Value: z.number().nonnegative().nullable().optional(),
  psa8Probability: ProbabilitySchema.nullable().optional(),
  psa8Value: z.number().nonnegative().nullable().optional(),
  psa9Probability: ProbabilitySchema.nullable().optional(),
  psa9Value: z.number().nonnegative().nullable().optional(),
  psa10Probability: ProbabilitySchema.nullable().optional(),
  psa10Value: z.number().nonnegative().nullable().optional(),
  gradingCost: z.number().nonnegative(),
  shippingCost: z.number().nonnegative(),
  insuranceCost: z.number().nonnegative(),
  sellingExpensePct: z.number().min(0).max(1),
  opportunityCost: z.number().nonnegative(),
  expectedGradingValue: z.number().nonnegative(),
  expectedIncrementalProfit: z.number(),
  gradingOpportunityScore: Score100Schema,
  recommendation: GradingRecommendationSchema,
  graderRouting: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  provenance: ProvenanceSchema,
});
export type GradingEvaluation = z.infer<typeof GradingEvaluationSchema>;

export const CollectionGoalSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  goalType: CollectionGoalTypeSchema,
  description: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type CollectionGoal = z.infer<typeof CollectionGoalSchema>;

export const BinderSlotSchema = z.object({
  id: UuidSchema,
  binderPageId: UuidSchema,
  slotNumber: z.number().int().min(1).max(9),
  assetId: UuidSchema,
  tier: BinderSlotTierSchema,
  isMuseumAnchor: z.boolean(),
});
export type BinderSlot = z.infer<typeof BinderSlotSchema>;

export const BinderPageSchema = z.object({
  id: UuidSchema,
  expansionId: UuidSchema.nullable().optional(),
  pageType: BinderPageTypeSchema,
  collectionGoalId: UuidSchema.nullable().optional(),
  slots: z.array(BinderSlotSchema),
});
export type BinderPage = z.infer<typeof BinderPageSchema>;

export const BinderPageCompletionSchema = z.object({
  binderPageId: UuidSchema,
  pageType: BinderPageTypeSchema,
  totalSlots: z.number().int().nonnegative(),
  filledSlots: z.number().int().nonnegative(),
  missingSlots: z.number().int().nonnegative(),
  completionPct: z.number(),
  ripVsSinglesRecommendation: RipVsSinglesSchema,
});
export type BinderPageCompletion = z.infer<typeof BinderPageCompletionSchema>;

export const SynergyScoreSchema = z.object({
  id: UuidSchema,
  holdingId: UuidSchema,
  evaluatedAt: z.coerce.date(),
  marketAttractiveness: Score100Schema,
  museumImportance: Score100Schema,
  investmentScore: Score100Schema,
  liquidityScore: Score100Schema,
  collectionSynergyScore: Score100Schema,
  contributingGoalIds: z.array(UuidSchema),
  notes: z.string().nullable().optional(),
  provenance: ProvenanceSchema,
});
export type SynergyScore = z.infer<typeof SynergyScoreSchema>;

/** Phase 2 — schema only. dataSource stays manual until Signals ingestion is live. */
export const MarketCycleStateSchema = z.object({
  id: UuidSchema,
  assetId: UuidSchema,
  evaluatedAt: z.coerce.date(),
  cycleState: CycleStateSchema,
  bubbleRiskScore: Score100Schema.nullable().optional(),
  priceVelocity: z.number().nullable().optional(),
  priceVsAthPct: z.number().nullable().optional(),
  salesVelocity: z.number().nullable().optional(),
  listingSupply: z.number().int().nullable().optional(),
  populationGrowthRate: z.number().nullable().optional(),
  releaseAgeDays: z.number().int().nullable().optional(),
  reprintRisk: z.enum(["low", "medium", "high"]).nullable().optional(),
  popularitySignal: Score100Schema.nullable().optional(),
  liquidityScore: z.number().nullable().optional(),
  dataSource: z.literal("manual"),
  notes: z.string().nullable().optional(),
});
export type MarketCycleState = z.infer<typeof MarketCycleStateSchema>;

export const BuyOpportunityScanSchema = z.object({
  id: UuidSchema,
  assetId: UuidSchema,
  marketCycleStateId: UuidSchema.nullable().optional(),
  scannedAt: z.coerce.date(),
  buyOpportunityScore: Score100Schema.nullable().optional(),
  declineFromHighPct: z.number().nullable().optional(),
  psaPremium: z.number().nullable().optional(),
  liquidityScore: z.number().nullable().optional(),
  popularitySignal: Score100Schema.nullable().optional(),
  artworkDesirability: Score100Schema.nullable().optional(),
  setQuality: Score100Schema.nullable().optional(),
  watchNote: z.string().nullable().optional(),
  dataSource: z.literal("manual"),
});
export type BuyOpportunityScan = z.infer<typeof BuyOpportunityScanSchema>;

export const FieldSessionSchema = z.object({
  id: UuidSchema,
  mode: FieldModeSchema,
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable().optional(),
  locationContext: z.string().nullable().optional(),
});
export type FieldSession = z.infer<typeof FieldSessionSchema>;

export const CardScanSchema = z.object({
  id: UuidSchema,
  capturedAt: z.coerce.date(),
  imageRef: z.string().min(1),
  physicalFingerprint: z.string().nullable().optional(),
  source: z.string().min(1),
});
export type CardScan = z.infer<typeof CardScanSchema>;

export const IdentificationGoldenCaseSchema = z.object({
  id: UuidSchema,
  cardScanId: UuidSchema,
  knownCorrectAssetId: UuidSchema,
  category: z.string().nullable().optional(),
  addedAt: z.coerce.date(),
});
export type IdentificationGoldenCase = z.infer<typeof IdentificationGoldenCaseSchema>;
