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
