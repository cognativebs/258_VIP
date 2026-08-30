import { z } from "zod";

/**
 * Ricoh / PaperStream trading-card scan intake v1.
 * Extends existing ScanBatch / ScanUnit — does not replace them.
 */
export const CARD_SCAN_RULE = "card-scan-intake@0.1.0";

export const ScanSourceSchema = z.string().min(1);
export const ScannerProfileSchema = z.string().min(1);
export const DEFAULT_SCAN_SOURCE = "ricoh_fi8170";
export const DEFAULT_SCANNER_PROFILE = "004_Cards";

export const EvidenceOriginSchema = z.enum([
  "front_visual",
  "front_text",
  "back_visual",
  "back_text",
  "catalog",
  "inference",
]);
export type EvidenceOrigin = z.infer<typeof EvidenceOriginSchema>;

export const EvidenceFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  origin: EvidenceOriginSchema,
  notes: z.string().optional(),
});
export type EvidenceField = z.infer<typeof EvidenceFieldSchema>;

export const CardIdentityFieldsSchema = z.object({
  category: EvidenceFieldSchema,
  playerOrCharacter: EvidenceFieldSchema,
  year: EvidenceFieldSchema,
  manufacturer: EvidenceFieldSchema,
  brand: EvidenceFieldSchema,
  setName: EvidenceFieldSchema,
  subsetInsert: EvidenceFieldSchema,
  collectorNumber: EvidenceFieldSchema,
  team: EvidenceFieldSchema,
  rookie: EvidenceFieldSchema,
  parallel: EvidenceFieldSchema,
  serialNumber: EvidenceFieldSchema,
  autograph: EvidenceFieldSchema,
  relic: EvidenceFieldSchema,
});
export type CardIdentityFields = z.infer<typeof CardIdentityFieldsSchema>;

export const CardIdentityEvidenceSchema = z.object({
  front: CardIdentityFieldsSchema,
  back: CardIdentityFieldsSchema,
  fused: CardIdentityFieldsSchema,
  conflictNotes: z.array(z.string()),
});
export type CardIdentityEvidence = z.infer<typeof CardIdentityEvidenceSchema>;

export const BaseVsParallelSchema = z.object({
  baseDisplayName: z.string().nullable(),
  baseConfidence: z.number().min(0).max(1),
  parallelDisplayName: z.string().nullable(),
  parallelConfidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type BaseVsParallel = z.infer<typeof BaseVsParallelSchema>;

export const ReviewRouteSchema = z.enum(["HIGH", "MEDIUM", "LOW", "CONFLICT"]);
export type ReviewRoute = z.infer<typeof ReviewRouteSchema>;

export const PairingMethodSchema = z.enum([
  "sequential_duplex",
  "filename_front_back",
  "auto",
]);
export type PairingMethod = z.infer<typeof PairingMethodSchema>;

export const CardOrientationSchema = z.enum(["portrait", "landscape", "unknown"]);
export type CardOrientation = z.infer<typeof CardOrientationSchema>;

export const ImageRoleSchema = z.enum(["master", "normalized", "thumb"]);
export type ImageRole = z.infer<typeof ImageRoleSchema>;

export const TransformationLogSchema = z.array(z.string());

export const CardScanObjectSchema = z.object({
  cardScanId: z.string().min(1),
  batchId: z.string().min(1),
  frontImageId: z.string().nullable(),
  backImageId: z.string().nullable(),
  originalFrontRef: z.string().min(1),
  originalBackRef: z.string().nullable(),
  normalizedFrontRef: z.string().nullable(),
  normalizedBackRef: z.string().nullable(),
  source: ScanSourceSchema,
  pairingMethod: PairingMethodSchema,
  pairingConfidence: z.number().min(0).max(1),
  pairingNeedsReview: z.boolean(),
  orientation: CardOrientationSchema,
  processingStatus: z.string().min(1),
  identificationStatus: z.string().min(1),
  reviewStatus: z.string().min(1),
  reviewRoute: ReviewRouteSchema,
  evidence: CardIdentityEvidenceSchema,
  baseVsParallel: BaseVsParallelSchema,
  physicalReimport: z.boolean(),
  identityDuplicate: z.boolean(),
  createdAt: z.string(),
});
export type CardScanObject = z.infer<typeof CardScanObjectSchema>;

export const ScanBatchTelemetrySchema = z.object({
  imagesReceived: z.number().int().nonnegative(),
  cardsPaired: z.number().int().nonnegative(),
  pairingFailures: z.number().int().nonnegative(),
  cardsIdentified: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  duplicateWarnings: z.number().int().nonnegative(),
  processingFailures: z.number().int().nonnegative(),
  avgMsPerCard: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type ScanBatchTelemetry = z.infer<typeof ScanBatchTelemetrySchema>;

export const ReviewThresholdsSchema = z.object({
  highMin: z.number().min(0).max(1),
  mediumMin: z.number().min(0).max(1),
});
export type ReviewThresholds = z.infer<typeof ReviewThresholdsSchema>;

export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = {
  highMin: 0.8,
  mediumMin: 0.45,
};

export const AcceptanceRowSchema = z.object({
  card: z.string(),
  pairing: z.string(),
  baseIdentity: z.string(),
  parallel: z.string(),
  confidence: z.string(),
  reviewStatus: z.string(),
  inventoryCandidate: z.string(),
});
export type AcceptanceRow = z.infer<typeof AcceptanceRowSchema>;

export function unknownField(origin: EvidenceOrigin = "inference"): z.infer<
  typeof EvidenceFieldSchema
> {
  return { value: null, confidence: 0, origin, notes: "unknown" };
}

export function field(
  value: string | null,
  confidence: number,
  origin: EvidenceOrigin,
  notes?: string,
) {
  return EvidenceFieldSchema.parse({
    value,
    confidence,
    origin,
    notes,
  });
}
