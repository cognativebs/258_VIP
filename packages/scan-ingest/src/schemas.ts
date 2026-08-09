import { z } from "zod";
import {
  CaptureFaceSchema,
  CapturePurposeSchema,
  CaptureQualityTierSchema,
  CategoryKindSchema,
  UuidSchema,
} from "@vip/core-model";
import { ProvenanceSchema } from "@vip/evidence";

/** Supported card categories for this intake path. */
export const ScanCategorySchema = z.enum(["sports", "pokemon", "mtg"]);
export type ScanCategory = z.infer<typeof ScanCategorySchema>;

export const ScanUnitStatusSchema = z.enum([
  "captured",
  "identified",
  "needs_review",
  "duplicate_alert",
  "confirmed",
  "rejected",
  "listed_draft",
]);
export type ScanUnitStatus = z.infer<typeof ScanUnitStatusSchema>;

export const ScanPageInputSchema = z.object({
  /** Absolute or storage-relative path / URL. */
  storageRef: z.string().min(1),
  contentHash: z.string().min(1),
  mimeType: z.string().min(1).default("image/jpeg"),
  byteLength: z.number().int().nonnegative().optional(),
  face: CaptureFaceSchema.default("unknown"),
  /** Optional OCR / barcode text from PaperStream or a later OCR stage. */
  ocrText: z.string().nullable().optional(),
  fileName: z.string().optional(),
});
export type ScanPageInput = z.infer<typeof ScanPageInputSchema>;

/**
 * One physical card as a duplex pair (front + optional back).
 * Ricoh fi-8170 ADF typically emits front/back sequentially.
 */
export const ScanUnitInputSchema = z.object({
  unitIndex: z.number().int().nonnegative(),
  front: ScanPageInputSchema,
  back: ScanPageInputSchema.optional(),
  categoryHint: ScanCategorySchema.nullable().optional(),
});
export type ScanUnitInput = z.infer<typeof ScanUnitInputSchema>;

export const ScanBatchInputSchema = z.object({
  device: z.string().min(1).default("ricoh_fi8170"),
  purpose: CapturePurposeSchema.default("inventory_intake"),
  qualityTier: CaptureQualityTierSchema.default("intake"),
  categoryHint: ScanCategorySchema.nullable().optional(),
  tenantId: UuidSchema.nullable().optional(),
  /** Operator notes for the batch. */
  notes: z.string().optional(),
  units: z.array(ScanUnitInputSchema).min(1),
});
export type ScanBatchInput = z.infer<typeof ScanBatchInputSchema>;

export const IdentityCandidateSchema = z.object({
  assetId: UuidSchema.nullable().optional(),
  /** Stable catalog key when asset row does not exist yet. */
  catalogKey: z.string().min(1),
  category: ScanCategorySchema,
  displayName: z.string().min(1),
  setName: z.string().nullable().optional(),
  collectorNumber: z.string().nullable().optional(),
  playerOrCharacter: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  externalIds: z
    .array(
      z.object({
        source: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
  matchReasons: z.array(z.string()).default([]),
  provenance: ProvenanceSchema,
});
export type IdentityCandidate = z.infer<typeof IdentityCandidateSchema>;

export const DuplicateMatchSchema = z.object({
  holdingId: z.string().min(1),
  assetId: UuidSchema.nullable().optional(),
  assetName: z.string().min(1),
  quantity: z.number().int().positive(),
  matchKind: z.enum(["same_asset", "same_external_id", "same_catalog_key"]),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

export const DuplicateAlertSchema = z.object({
  unitId: UuidSchema,
  duplicates: z.array(DuplicateMatchSchema).min(1),
  /** Operator must acknowledge before confirm-as-additional or reject. */
  requiresConfirmation: z.literal(true),
  provenance: ProvenanceSchema,
});
export type DuplicateAlert = z.infer<typeof DuplicateAlertSchema>;

export const ScanUnitSchema = z.object({
  id: UuidSchema,
  batchId: UuidSchema,
  unitIndex: z.number().int().nonnegative(),
  status: ScanUnitStatusSchema,
  categoryHint: ScanCategorySchema.nullable().optional(),
  frontStorageRef: z.string().min(1),
  frontContentHash: z.string().min(1),
  backStorageRef: z.string().nullable().optional(),
  backContentHash: z.string().nullable().optional(),
  ocrText: z.string().nullable().optional(),
  candidates: z.array(IdentityCandidateSchema).default([]),
  selectedCandidateKey: z.string().nullable().optional(),
  duplicateAlert: DuplicateAlertSchema.nullable().optional(),
  holdingId: UuidSchema.nullable().optional(),
  rawSnapshotId: UuidSchema.nullable().optional(),
  idObservationId: UuidSchema.nullable().optional(),
  ebayListingDraftId: UuidSchema.nullable().optional(),
  decisionAction: z
    .enum(["Buy", "Hold", "Grade", "Sell", "Lot", "Pass"])
    .nullable()
    .optional(),
  provenance: ProvenanceSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ScanUnit = z.infer<typeof ScanUnitSchema>;

export const ScanBatchSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema,
  device: z.string().min(1),
  purpose: CapturePurposeSchema,
  qualityTier: CaptureQualityTierSchema,
  categoryHint: ScanCategorySchema.nullable().optional(),
  tenantId: UuidSchema.nullable().optional(),
  notes: z.string().optional(),
  status: z.enum(["open", "review", "closed"]),
  units: z.array(ScanUnitSchema),
  provenance: ProvenanceSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ScanBatch = z.infer<typeof ScanBatchSchema>;

/**
 * Operator confirm: verify identity into inventory.
 * When duplicates exist, `acknowledgeDuplicates` must be true.
 */
export const ConfirmUnitRequestSchema = z.object({
  unitId: UuidSchema,
  /** catalogKey of the chosen candidate, or free-text override key. */
  selectedCandidateKey: z.string().min(1),
  /** Optional override when operator corrects the ID. */
  confirmedDisplayName: z.string().min(1).optional(),
  category: ScanCategorySchema.optional(),
  quantity: z.number().int().positive().default(1),
  acknowledgeDuplicates: z.boolean().default(false),
  /** After confirm, optionally queue an eBay listing draft. */
  queueEbayListingDraft: z.boolean().default(false),
  assumedGrade: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});
export type ConfirmUnitRequest = z.infer<typeof ConfirmUnitRequestSchema>;

export const InventoryCommitSchema = z.object({
  holdingId: UuidSchema,
  assetId: UuidSchema,
  source: z.string().min(1),
  sourceRowId: z.string().min(1),
  rawSnapshotId: UuidSchema,
  quantity: z.number().int().positive(),
  assumedGrade: z.string().nullable().optional(),
  needsVerification: z.boolean(),
  verificationNotes: z.string().nullable().optional(),
  duplicateAcknowledged: z.boolean(),
  provenance: ProvenanceSchema,
});
export type InventoryCommit = z.infer<typeof InventoryCommitSchema>;

export const EbayListingDraftStatusSchema = z.enum([
  "pending_credentials",
  "draft_ready",
  "submitted",
  "failed",
]);
export type EbayListingDraftStatus = z.infer<typeof EbayListingDraftStatusSchema>;

export const EbayListingDraftSchema = z.object({
  id: UuidSchema,
  unitId: UuidSchema,
  holdingId: UuidSchema.nullable().optional(),
  title: z.string().min(1),
  categoryHint: ScanCategorySchema.nullable().optional(),
  status: EbayListingDraftStatusSchema,
  /** Explicit idle reason when developer tokens are missing. */
  emptyReason: z.string().optional(),
  listingPayload: z.record(z.unknown()).optional(),
  provenance: ProvenanceSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type EbayListingDraft = z.infer<typeof EbayListingDraftSchema>;

/** Existing inventory row shape used for duplicate checks (API-facing subset). */
export const InventoryLookupRowSchema = z.object({
  id: z.string().min(1),
  assetId: UuidSchema.nullable().optional(),
  assetName: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  externalIds: z
    .array(
      z.object({
        source: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .default([]),
  /** Optional normalized key for fuzzy catalog match. */
  catalogKey: z.string().optional(),
});
export type InventoryLookupRow = z.infer<typeof InventoryLookupRowSchema>;

export const CatalogCardSchema = z.object({
  catalogKey: z.string().min(1),
  category: ScanCategorySchema,
  displayName: z.string().min(1),
  setName: z.string().nullable().optional(),
  collectorNumber: z.string().nullable().optional(),
  playerOrCharacter: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  /** Searchable tokens (OCR / title fragments). */
  searchText: z.string().min(1),
  externalIds: z
    .array(
      z.object({
        source: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .default([]),
  assetId: UuidSchema.nullable().optional(),
});
export type CatalogCard = z.infer<typeof CatalogCardSchema>;

/** Re-export category kind for consumers that need full VIP kinds. */
export { CategoryKindSchema };
