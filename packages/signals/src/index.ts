export {
  SIGNALS_VERSION,
  PipelineStageSchema,
  SourceRegistryEntrySchema,
  StageRecordSchema,
  PredictionLedgerEntrySchema,
  type PipelineStage,
  type SourceRegistryEntry,
  type StageRecord,
  type PredictionLedgerEntry,
} from "./types.js";

export { AppendOnlyStageStore } from "./store.js";
export { SourceRegistry, DEFAULT_SOURCES } from "./registry.js";
export {
  SIGNALS_NEWS_SOURCE_RULE,
  SignalsNewsSourceSchema,
  newsAdapterMayRun,
  type SignalsNewsSource,
} from "./news-source.js";
export { dedupeKey, noveltyScore, textSimilarity, normalizeText } from "./dedupe.js";
export { runSignalPipeline, type IngestEvent, type PipelineResult } from "./pipeline.js";
export { PredictionLedger, brierScore } from "./prediction-ledger.js";

export {
  RSS_ADAPTER_VERSION,
  RawRssSnapshotSchema,
  RssAdapterConfigSchema,
  NormalizedSignalFromRssSchema,
  SignalProvenanceSchema,
  type RawRssSnapshot,
  type RssAdapterConfig,
  type NormalizedSignalFromRss,
  type SignalProvenance,
} from "./schemas/rss-adapter.js";

export {
  SourceStatsSchema,
  SourceRegistryPersistedSchema,
  ApiSourceEntrySchema,
  type SourceStats,
  type SourceRegistryPersisted,
  type ApiSourceEntry,
} from "./schemas/source-registry.js";

export { RssAdapter, resetRssRateLimitForTests } from "./adapters/rss-adapter.js";

export {
  EBAY_BROWSE_ADAPTER_VERSION,
  EbayBrowseAdapterConfigSchema,
  MarketCompsQuerySchema,
  MarketCompsBundleSchema,
  MarketCompsProvenanceSchema,
  ActiveListingAskSchema,
  LiquidityProxySchema,
  RawEbayBrowseSnapshotSchema,
  AskAsSaleCompSchema,
  PricingSeamResultSchema,
  type EbayBrowseAdapterConfig,
  type MarketCompsQuery,
  type MarketCompsBundle,
  type MarketCompsProvenance,
  type ActiveListingAsk,
  type LiquidityProxy,
  type RawEbayBrowseSnapshot,
  type AskAsSaleComp,
  type PricingSeamResult,
  type EbayEnvironment,
} from "./schemas/ebay-browse.js";

export {
  EbayBrowseAdapter,
  liquidityFromActiveCount,
  resetEbayBrowseStateForTests,
} from "./adapters/ebay-browse-adapter.js";

export {
  toPricingSeamResult,
  type MarketCompsAdapter,
} from "./adapters/market-comps.js";

export {
  defaultSourcesStatePath,
  loadPersistedState,
  savePersistedState,
  isSourceActive,
  setSourceActive,
} from "./registry/source-persistence.js";

export {
  SPINE_RULE_VERSION,
  SpineProvenanceSchema,
  IngestRunSchema,
  RawDocumentSchema,
  DocumentSnapshotSchema,
  EvidenceRoleSchema,
  OriginRelationSchema,
  SpineEventSchema,
  EventEvidenceSchema,
  OriginLinkSchema,
  SpineSignalTypeCodeSchema,
  SpineSignalTypeSchema,
  WeightedProductExponentsSchema,
  ScoreWeightSetSchema,
  SpineSignalSchema,
  SignalEntitySchema,
  AttentionObservationSchema,
  PREDICTION_MEASUREMENT_HORIZONS_DAYS,
  PredictionSchema,
  PredictionMeasurementSchema,
  ValuationCitationSchema,
  type SpineProvenance,
  type IngestRun,
  type RawDocument,
  type DocumentSnapshot,
  type EvidenceRole,
  type OriginRelation,
  type SpineEvent,
  type EventEvidence,
  type OriginLink,
  type SpineSignalTypeCode,
  type SpineSignalType,
  type WeightedProductExponents,
  type ScoreWeightSet,
  type SpineSignal,
  type SignalEntity,
  type AttentionObservation,
  type Prediction,
  type PredictionMeasurement,
  type ValuationCitation,
} from "./schemas/spine.js";

export {
  normalizeSignalUrl,
  independentSourceCount,
  signalInfluence,
  priorityFromScores,
  assertMayEnterValuation,
  ValuationFirewallError,
  type SignalUrlMode,
} from "./spine.js";

export {
  SPORTS_HEADLINE_CLASSIFIER,
  ClassifierRuleSetSchema,
  LlmClassificationSchema,
  InjurySeveritySchema,
  SignalDirectionSchema,
  SubjectKindSchema,
  compileRuleSet,
  noiseMatch,
  injurySeverity,
  decideByRules,
  decideByLlm,
  scoreDecision,
  llmMessages,
  type ClassifierRuleSet,
  type CompiledRuleSet,
  type LlmClassification,
  type Headline,
  type HeadlineDecision,
  type SignalDecision,
  type InjurySeverity,
} from "./classifier/sports-headline.js";
export { SPORTS_HEADLINE_RULES_SEED } from "./classifier/sports-headline-seed.js";
export { SPORTS_HEADLINE_RULES_V0_2_0 } from "./classifier/sports-headline-seed.js";
export {
  DailySportsProfileSchema,
  CurationStanceSchema,
  sportFromFeedUrl,
  allocateSlots,
  curateDailySports,
  type DailySportsProfile,
  type CurationStance,
  type CurationCandidate,
  type CuratedItem,
} from "./curation/daily-sports.js";
export { DAILY_SPORTS_PROFILE_SEED } from "./curation/daily-sports-seed.js";
