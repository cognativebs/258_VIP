export { INTELLIGENCE_VERSION } from "./version.js";

export {
  UuidSchema,
  ProbabilitySchema,
  Score100Schema,
  PriceDirectionSchema,
  RecommendationActionSchema,
  EvidenceSourceSchema,
  SourceSystemSchema,
  GradingRecommendationSchema,
  BinderPageTypeSchema,
  BinderSlotTierSchema,
  RipVsSinglesSchema,
  CollectionGoalTypeSchema,
  CycleStateSchema,
  FieldModeSchema,
  IdentificationProviderNameSchema,
  PredictionSchema,
  EvidenceCardSchema,
  RecommendationRecordSchema,
  UnderwritingSchema,
  GradingEvaluationSchema,
  CollectionGoalSchema,
  BinderSlotSchema,
  BinderPageSchema,
  BinderPageCompletionSchema,
  SynergyScoreSchema,
  MarketCycleStateSchema,
  BuyOpportunityScanSchema,
  FieldSessionSchema,
  CardScanSchema,
  IdentificationGoldenCaseSchema,
  type PriceDirection,
  type RecommendationAction,
  type EvidenceSource,
  type SourceSystem,
  type GradingRecommendation,
  type BinderPageType,
  type BinderSlotTier,
  type RipVsSingles,
  type CollectionGoalType,
  type CycleState,
  type FieldMode,
  type IdentificationProviderName,
  type Prediction,
  type EvidenceCard,
  type RecommendationRecord,
  type Underwriting,
  type GradingEvaluation,
  type CollectionGoal,
  type BinderSlot,
  type BinderPage,
  type BinderPageCompletion,
  type SynergyScore,
  type MarketCycleState,
  type BuyOpportunityScan,
  type FieldSession,
  type CardScan,
  type IdentificationGoldenCase,
} from "./schemas.js";

export {
  PredictionLedgerError,
  createPrediction,
  impliedDirection,
  directionFromPrices,
  resolvePrediction,
  assertForecastImmutable,
  needsScoring,
  calibrate,
  type PredictionInput,
  type CalibrationReport,
} from "./prediction.js";

export {
  EvidenceEngineError,
  createRecommendation,
  readRecommendation,
  wrapEngineRecommendation,
  type EvidenceCardInput,
  type RecommendationInput,
} from "./evidence.js";

export {
  DEFAULT_COVERAGE_THRESHOLD,
  UnderwritingError,
  coverageRatio,
  underwrite,
  lockUnderwriting,
  assertUnderwritingMutable,
  type UnderwritingInput,
} from "./underwriting.js";

export {
  GradingError,
  expectedGradingValue,
  expectedIncrementalProfit,
  gradingOpportunityScore,
  recommendGrading,
  evaluateGrading,
  type GradeBandInput,
  type GradingInput,
} from "./grading.js";

export {
  BinderError,
  createCollectionGoal,
  createBinderPage,
  addBinderSlot,
  binderPageCompletion,
} from "./binder.js";

export {
  compositeSynergyScore,
  collectionQualityDensity,
  scoreSynergy,
  type SynergyInput,
} from "./synergy.js";

export { isUuid, uuidFromKey } from "./ids.js";

export {
  Phase2BlockedError,
  recordManualCycleState,
  recordManualBuyOpportunity,
  classifyMarketCycle,
  scanBuyOpportunities,
  suggestPortfolioConsolidation,
} from "./phase2.js";

export {
  IdentificationContractError,
  ALLOWED_IDENTIFICATION_PROVIDERS,
  FORBIDDEN_IDENTIFICATION_PROVIDERS,
  assertAllowedProvider,
  createFieldSession,
  recordCardScan,
  assertCardScanImmutable,
  openIdentification,
  supersedeIdentification,
  addGoldenCase,
  auctionMaxBid,
  tradeBasketEquality,
  type CardIdentificationProvider,
  type CatalogProvider,
  type MarketDataProvider,
  type MarketplaceCatalogProvider,
  type CardIdentification,
} from "./contracts.js";

export { FIXTURE_IDS, FIXTURE_AS_OF, seedIntelligenceFixtures } from "./fixtures.js";

export {
  CohenScoreInputSchema,
  CohenActionSchema,
  CohenScoreResultSchema,
  scoreCohenCover,
  COHEN_IVY9_FIXTURE,
  COHEN_DIENAMITE_FIXTURE,
  type CohenScoreInput,
  type CohenAction,
  type CohenScoreResult,
} from "./cohen.js";

export {
  PrintLifeStageSchema,
  PrintLifeWatchSchema,
  PrintLifeBlockedError,
  classifyPrintLife,
  PRINT_LIFE_WATCHES,
  type PrintLifeStage,
  type PrintLifeWatch,
} from "./printLife.js";

export {
  EmergingStanceSchema,
  EmergingMarketSeedSchema,
  EMERGING_MARKET_SEEDS,
  type EmergingStance,
  type EmergingMarketSeed,
} from "./emergingMarkets.js";
