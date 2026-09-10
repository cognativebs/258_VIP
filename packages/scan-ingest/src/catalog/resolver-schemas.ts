import { z } from "zod";
import { ProvenanceSchema } from "@vip/evidence";
import { IdentityCandidateSchema, ScanCategorySchema } from "../schemas.js";

export const CatalogAdapterOutcomeStatusSchema = z.enum([
  "ok",
  "timeout",
  "error",
  "skipped",
]);
export type CatalogAdapterOutcomeStatus = z.infer<
  typeof CatalogAdapterOutcomeStatusSchema
>;

export const CatalogAdapterOutcomeSchema = z.object({
  adapterId: z.string().min(1),
  status: CatalogAdapterOutcomeStatusSchema,
  cardCount: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  called: z.boolean(),
  snapshotId: z.string().nullable().optional(),
  snapshotHash: z.string().nullable().optional(),
  error: z.string().optional(),
});
export type CatalogAdapterOutcome = z.infer<typeof CatalogAdapterOutcomeSchema>;

export const CatalogResolverResultSchema = z.object({
  candidates: z.array(IdentityCandidateSchema),
  outcomes: z.array(CatalogAdapterOutcomeSchema),
  cacheHit: z.boolean(),
  providerCalls: z.number().int().nonnegative(),
  contentHash: z.string().nullable(),
  category: ScanCategorySchema.nullable().optional(),
  provenance: ProvenanceSchema,
});
export type CatalogResolverResult = z.infer<typeof CatalogResolverResultSchema>;

export const IdObservationRecordSchema = z.object({
  predictedAssetId: z.string().uuid().nullable(),
  predictedConfidence: z.number().min(0).max(1).nullable(),
  confirmedAssetId: z.string().uuid(),
  wasCorrect: z.boolean().nullable(),
  imageUrl: z.string().min(1),
  ocrText: z.string().nullable(),
});
export type IdObservationRecord = z.infer<typeof IdObservationRecordSchema>;

export const IdentificationBenchmarkCaseSchema = z.object({
  id: z.string().min(1),
  adapterId: z.string().min(1).default("merged"),
  predictedCatalogKey: z.string().nullable(),
  predictedCollectorNumber: z.string().nullable(),
  predictedParallel: z.string().nullable(),
  predictedConfidence: z.number().min(0).max(1).nullable(),
  expectedCatalogKey: z.string().nullable(),
  expectedCollectorNumber: z.string().nullable(),
  expectedParallel: z.string().nullable(),
  confirmedCorrect: z.boolean().nullable().optional(),
  failed: z.boolean(),
  providerCalls: z.number().int().nonnegative().default(0),
});
export type IdentificationBenchmarkCase = z.infer<
  typeof IdentificationBenchmarkCaseSchema
>;

export const ConfidenceCalibrationBandSchema = z.object({
  band: z.enum(["high", "mid", "low"]),
  minInclusive: z.number(),
  maxExclusive: z.number(),
  count: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1).nullable(),
});
export type ConfidenceCalibrationBand = z.infer<
  typeof ConfidenceCalibrationBandSchema
>;

export const AdapterBenchmarkReportSchema = z.object({
  adapterId: z.string().min(1),
  cases: z.number().int().nonnegative(),
  top1Accuracy: z.number().min(0).max(1).nullable(),
  exactParallelAccuracy: z.number().min(0).max(1).nullable(),
  cardNumberAccuracy: z.number().min(0).max(1).nullable(),
  failureRate: z.number().min(0).max(1),
  callsConsumed: z.number().int().nonnegative(),
  calibration: z.array(ConfidenceCalibrationBandSchema),
});
export type AdapterBenchmarkReport = z.infer<typeof AdapterBenchmarkReportSchema>;

export const IdentificationBenchmarkReportSchema = z.object({
  ruleOrModelVersion: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
  adapters: z.array(AdapterBenchmarkReportSchema),
  overall: AdapterBenchmarkReportSchema,
});
export type IdentificationBenchmarkReport = z.infer<
  typeof IdentificationBenchmarkReportSchema
>;
