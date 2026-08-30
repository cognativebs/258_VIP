import { z } from "zod";
import { DecisionActionSchema } from "./decisions.js";
import { InventoryBucketSchema } from "./inventory-bucket.js";
import { LiveRangeChipSchema } from "./live-range.js";

/**
 * Batch 001 — first real-inventory walk.
 * Sports (25) before comics (10). Manual inspect every row.
 * Record only money-affecting disagreements + elapsed human seconds.
 */
export const BATCH_001_ID = "batch-001";
export const BATCH_RUN_RULE = "batch-run@0.1.0";

export const BatchCategorySchema = z.enum(["sports", "comic"]);
export type BatchCategory = z.infer<typeof BatchCategorySchema>;

/** Money-affecting failure classes only. */
export const MoneyFailureClassSchema = z.enum([
  "identity",
  "pricing",
  "inventory",
  "disposition",
  "listing",
  "workflow",
]);
export type MoneyFailureClass = z.infer<typeof MoneyFailureClassSchema>;

export const BatchPipelineStageSchema = z.enum([
  "ingest",
  "identify",
  "inventory_bucket",
  "price",
  "disposition",
  "ebay_ready",
]);
export type BatchPipelineStage = z.infer<typeof BatchPipelineStageSchema>;

export const ExpectedSportsIdentitySchema = z.object({
  year: z.number().int(),
  brand: z.string().min(1),
  player: z.string().min(1),
  collectorNumber: z.string().nullable(),
  parallel: z.string().nullable(),
  serialMax: z.number().int().positive().nullable(),
  autograph: z.boolean(),
  relic: z.boolean(),
  displayName: z.string().min(1),
});
export type ExpectedSportsIdentity = z.infer<typeof ExpectedSportsIdentitySchema>;

export const BatchRosterItemSchema = z.object({
  slot: z.number().int().positive(),
  category: BatchCategorySchema,
  fileStem: z.string().min(1),
  expected: ExpectedSportsIdentitySchema,
  /** Operator band for this messy dealer lot — not a software valuation. */
  intendedAskBandUsd: z.object({
    low: z.number().positive(),
    high: z.number().positive(),
  }),
  messFlags: z.array(z.string()).min(1),
});
export type BatchRosterItem = z.infer<typeof BatchRosterItemSchema>;

export const ParsedIdentitySliceSchema = z.object({
  catalogKey: z.string().nullable(),
  displayName: z.string().nullable(),
  year: z.number().int().nullable(),
  brand: z.string().nullable(),
  player: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  parallel: z.string().nullable(),
  serialMax: z.number().int().positive().nullable(),
  autograph: z.boolean(),
  relic: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  matchReasons: z.array(z.string()),
});
export type ParsedIdentitySlice = z.infer<typeof ParsedIdentitySliceSchema>;

export const BatchDispositionSchema = z.object({
  action: DecisionActionSchema,
  reasonCode: z.string().min(1),
  notes: z.string().min(1),
  confidence: z.number().min(0).max(1),
  ruleOrModelVersion: z.literal(BATCH_RUN_RULE),
  verificationStatus: z.literal("unverified"),
});
export type BatchDisposition = z.infer<typeof BatchDispositionSchema>;

export const BatchListingSliceSchema = z.object({
  draftId: z.string().nullable(),
  status: z.string().nullable(),
  title: z.string().nullable(),
  categoryHint: z.string().nullable(),
  condition: z.string().nullable(),
  askPrice: z.number().positive().nullable(),
  submitReady: z.boolean(),
  emptyReason: z.string().nullable(),
  imageCount: z.number().int().nonnegative(),
});
export type BatchListingSlice = z.infer<typeof BatchListingSliceSchema>;

export const BatchPipelineResultSchema = z.object({
  slot: z.number().int().positive(),
  unitId: z.string().nullable(),
  holdingId: z.string().nullable(),
  holdingSourceRowId: z.string().nullable(),
  stagesCompleted: z.array(BatchPipelineStageSchema),
  identity: ParsedIdentitySliceSchema,
  inventoryBucket: InventoryBucketSchema.nullable(),
  liveRange: LiveRangeChipSchema.nullable(),
  disposition: BatchDispositionSchema.nullable(),
  listing: BatchListingSliceSchema.nullable(),
  softwareFlags: z.array(MoneyFailureClassSchema),
  softwareFlagNotes: z.array(z.string()),
  pipelineElapsedMs: z.number().nonnegative(),
});
export type BatchPipelineResult = z.infer<typeof BatchPipelineResultSchema>;

export const BatchInspectionSchema = z.object({
  failureClasses: z.array(MoneyFailureClassSchema),
  notes: z.string(),
  /** Elapsed human inspect time. Baseline before optimizing. */
  humanSeconds: z.number().nonnegative(),
  inspectedAt: z.string().nullable(),
  inspector: z.string().nullable(),
});
export type BatchInspection = z.infer<typeof BatchInspectionSchema>;

export const InspectBatchItemBodySchema = z.object({
  slot: z.number().int().positive(),
  failureClasses: z.array(MoneyFailureClassSchema),
  notes: z.string().max(2000).default(""),
  humanSeconds: z.number().nonnegative(),
  inspector: z.string().min(1).default("operator"),
});
export type InspectBatchItemBody = z.infer<typeof InspectBatchItemBodySchema>;

export const BatchRunItemSchema = z.object({
  slot: z.number().int().positive(),
  category: BatchCategorySchema,
  roster: BatchRosterItemSchema,
  result: BatchPipelineResultSchema.nullable(),
  inspection: BatchInspectionSchema.nullable(),
});
export type BatchRunItem = z.infer<typeof BatchRunItemSchema>;

export const BatchRunSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["not_started", "sports_running", "sports_ready", "comics_pending"]),
  sportsCount: z.literal(25),
  comicsCount: z.literal(10),
  items: z.array(BatchRunItemSchema),
  provenance: z.object({
    source: z.literal("batch_001"),
    method: z.literal("inferred"),
    ruleOrModelVersion: z.literal(BATCH_RUN_RULE),
    verificationStatus: z.literal("unverified"),
    notes: z.string(),
  }),
});
export type BatchRun = z.infer<typeof BatchRunSchema>;

export function identityDisagrees(
  expected: ExpectedSportsIdentity,
  actual: ParsedIdentitySlice,
): string[] {
  const notes: string[] = [];
  if (!actual.displayName) {
    notes.push("No identity produced");
    return notes;
  }
  const hay = `${actual.displayName} ${actual.matchReasons.join(" ")}`.toLowerCase();
  if (actual.year !== expected.year) {
    notes.push(`year ${expected.year} vs ${actual.year ?? "none"}`);
  }
  if (expected.player && !hay.includes(expected.player.toLowerCase().split(" ").pop() ?? "")) {
    notes.push(`player missing: ${expected.player}`);
  }
  if (expected.parallel && !hay.includes(expected.parallel.toLowerCase())) {
    notes.push(`parallel dropped: ${expected.parallel}`);
  }
  if (expected.serialMax && actual.serialMax !== expected.serialMax) {
    notes.push(`serial /${expected.serialMax} vs ${actual.serialMax ?? "none"}`);
  }
  if (expected.autograph && !actual.autograph && !hay.includes("auto")) {
    notes.push("autograph dropped");
  }
  if (expected.relic && !actual.relic && !hay.includes("relic")) {
    notes.push("relic dropped");
  }
  if (
    expected.collectorNumber &&
    actual.collectorNumber &&
    expected.collectorNumber !== actual.collectorNumber
  ) {
    notes.push(
      `number ${expected.collectorNumber} vs ${actual.collectorNumber}`,
    );
  }
  return notes;
}
