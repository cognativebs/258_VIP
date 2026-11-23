import { z } from "zod";
import { PredictionSchema, UuidSchema } from "./schemas.js";

/**
 * Contracts for the manual intelligence store (backlog O).
 *
 * The store has two backends behind one interface: Postgres (`vault_core`
 * tables from migrations 20260815_11..16) and the legacy JSON file
 * (`VIP_INTELLIGENCE_STATE`), which stays as the fallback when Postgres is
 * unreachable. Every read reports which backend answered, so a JSON fallback
 * is never presented as the durable ledger.
 */

export const IntelligenceStoreKindSchema = z.enum(["postgres", "json"]);
export type IntelligenceStoreKind = z.infer<typeof IntelligenceStoreKindSchema>;

/** `auto` = Postgres, falling back to JSON only when Postgres is unreachable. */
export const IntelligenceStoreModeSchema = z.enum(["auto", "postgres", "json"]);
export type IntelligenceStoreMode = z.infer<typeof IntelligenceStoreModeSchema>;

/** One item captured during a field session (vault_core.field_captured_item). */
export const FieldCaptureSchema = z.object({
  id: UuidSchema,
  fieldSessionId: UuidSchema,
  capturedAt: z.string().min(1),
  askingPrice: z.number().nonnegative().nullable(),
  imageRef: z.string().nullable(),
  recommendationId: UuidSchema.nullable(),
  underwritingId: UuidSchema.nullable(),
  cardScanId: UuidSchema.nullable(),
  identificationId: UuidSchema.nullable(),
  /** Permanent workflow state — never auto-cleared. */
  needsReview: z.boolean(),
});
export type FieldCapture = z.infer<typeof FieldCaptureSchema>;

/** Body of POST /api/intelligence/predictions/:id/resolve. A human records the outcome. */
export const ResolvePredictionRequestSchema = z.object({
  actualPrice: z.coerce.number().finite().nonnegative(),
  explanation: z.string().trim().max(2000).optional(),
  modelAdjustment: z.string().trim().max(2000).optional(),
});
export type ResolvePredictionRequest = z.infer<typeof ResolvePredictionRequestSchema>;

export const DUE_PREDICTIONS_RULE = "prediction-due@0.1.0";

/**
 * Predictions past their horizon with no recorded outcome. In Postgres mode the
 * list comes from the `vault_core.prediction_needs_scoring` view (DB clock);
 * in JSON mode it is the same filter computed in-process. Nothing auto-resolves.
 */
export const DuePredictionsReportSchema = z.object({
  store: IntelligenceStoreKindSchema,
  source: z.enum(["vault_core.prediction_needs_scoring", "json:needsScoring"]),
  rule: z.literal(DUE_PREDICTIONS_RULE),
  asOf: z.string().min(1),
  count: z.number().int().nonnegative(),
  predictions: z.array(PredictionSchema),
  note: z.string(),
});
export type DuePredictionsReport = z.infer<typeof DuePredictionsReportSchema>;

/** Collections in the JSON document, in the order the importer writes them (FK order). */
export const INTELLIGENCE_COLLECTIONS = [
  "fieldSessions",
  "cardScans",
  "identifications",
  "goldenCases",
  "recommendations",
  "predictions",
  "underwriting",
  "grading",
  "cycleStates",
  "buyScans",
  "captures",
] as const;
export const IntelligenceCollectionSchema = z.enum(INTELLIGENCE_COLLECTIONS);
export type IntelligenceCollection = z.infer<typeof IntelligenceCollectionSchema>;

export const ImportSkipSchema = z.object({
  id: z.string(),
  reason: z.string(),
});

export const ImportCollectionReportSchema = z.object({
  table: z.string(),
  inJson: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  alreadyPresent: z.number().int().nonnegative(),
  skipped: z.array(ImportSkipSchema),
});
export type ImportCollectionReport = z.infer<typeof ImportCollectionReportSchema>;

export const INTELLIGENCE_IMPORT_RULE = "intelligence-json-import@0.1.0";

export const IntelligenceImportReportSchema = z.object({
  rule: z.literal(INTELLIGENCE_IMPORT_RULE),
  source: z.string(),
  dryRun: z.boolean(),
  collections: z.record(IntelligenceCollectionSchema, ImportCollectionReportSchema),
  totals: z.object({
    inJson: z.number().int().nonnegative(),
    inserted: z.number().int().nonnegative(),
    alreadyPresent: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});
export type IntelligenceImportReport = z.infer<typeof IntelligenceImportReportSchema>;
