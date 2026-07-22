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
