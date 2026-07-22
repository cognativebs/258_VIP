import { z } from "zod";

export const SIGNALS_VERSION = "signals@0.1.0";

export const PipelineStageSchema = z.enum([
  "SourceObservation",
  "RawEvent",
  "DeduplicatedEvent",
  "NormalizedSignal",
  "AssetImpact",
  "ThesisUpdate",
  "RecommendationChange",
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const SourceRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  authority: z.enum(["owner_import", "market", "retail", "news", "social", "internal"]),
  historicalAccuracy: z.number().min(0).max(1),
  latencyHours: z.number().nonnegative(),
  categoryCoverage: z.array(z.string()),
  accessMethod: z.enum(["xml_file", "csv_file", "api", "rss", "manual", "scrape_adapter"]),
  terms: z.string(),
  active: z.boolean().default(true),
});
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

/** Append-only stage record — never overwrite prior stages. */
export const StageRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stage: PipelineStageSchema,
  createdAt: z.coerce.date(),
  parentIds: z.array(z.string()).default([]),
  payload: z.record(z.unknown()),
  contentHash: z.string(),
  quarantineStatus: z.enum(["active", "quarantined", "rejected"]).default("active"),
  noveltyScore: z.number().min(0).max(1).nullable().optional(),
  dedupeKey: z.string().nullable().optional(),
  notes: z.string().optional(),
});
export type StageRecord = z.infer<typeof StageRecordSchema>;

export const PredictionLedgerEntrySchema = z.object({
  id: z.string(),
  claim: z.string(),
  probability: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()).default([]),
  action: z.enum(["Buy", "Hold", "Grade", "Sell", "Lot", "Pass"]).nullable().optional(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  outcome: z.enum(["pending", "hit", "miss", "partial", "void"]).default("pending"),
  outcomeValue: z.number().min(0).max(1).nullable().optional(),
  brierScore: z.number().nullable().optional(),
  calibrationNotes: z.string().nullable().optional(),
  errorNotes: z.string().nullable().optional(),
});
export type PredictionLedgerEntry = z.infer<typeof PredictionLedgerEntrySchema>;
