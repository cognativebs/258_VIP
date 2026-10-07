import { z } from "zod";

export const CLZ_DIFF_RULE = "clz-diff-importer@0.1.0";
export const CLZ_DIFF_WATCH_REL = "data/imports/clz";
export const CLZ_DIFF_RAW_REL = "data/raw/clz";

/** CLZ catalog dollars. Never a PriceCharting guide observation. */
export const CLZ_VALUE_FIELD = "vault_collection.holding.current_price_snapshot";
export const GUIDE_BASELINE_VIEW = "vault_market.v_guide_price_baseline";

export const ClzDiffClassSchema = z.enum(["new", "changed", "unchanged", "disappeared"]);
export type ClzDiffClass = z.infer<typeof ClzDiffClassSchema>;

export const ClzChangeTypeSchema = z.enum([
  "ownership_new",
  "ownership_sold",
  "ownership_quantity",
  "condition_grade",
  "clz_value_drift",
  "metadata_only",
]);
export type ClzChangeType = z.infer<typeof ClzChangeTypeSchema>;

export const ClzDiffRowSchema = z.object({
  sourceRowId: z.string().min(1),
  classification: ClzDiffClassSchema,
  changeTypes: z.array(ClzChangeTypeSchema),
  changedFields: z.array(z.string()),
  possiblySold: z.boolean(),
  canonicalName: z.string().nullable(),
  clzValue: z.number().nullable(),
  quantity: z.number().int().nullable(),
  needsFreshVendorMap: z.boolean().optional(),
});
export type ClzDiffRow = z.infer<typeof ClzDiffRowSchema>;

export const ClzValueLandingSchema = z.object({
  clzValueField: z.literal(CLZ_VALUE_FIELD),
  guideBaseline: z.literal(GUIDE_BASELINE_VIEW),
  writesGuideBaseline: z.literal(false),
  notes: z.string(),
});

export const ClzDiffReportSchema = z.object({
  ruleOrModelVersion: z.literal(CLZ_DIFF_RULE),
  dryRun: z.boolean(),
  applied: z.boolean(),
  phase2Enabled: z.literal(false),
  exportPath: z.string(),
  snapshotPath: z.string().nullable(),
  contentHash: z.string(),
  incomingCount: z.number().int().nonnegative(),
  existingCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  disappearedCount: z.number().int().nonnegative(),
  possiblySoldFlagged: z.number().int().nonnegative(),
  byType: z.object({
    ownershipNew: z.number().int().nonnegative(),
    ownershipSold: z.number().int().nonnegative(),
    ownershipQuantity: z.number().int().nonnegative(),
    conditionGrade: z.number().int().nonnegative(),
    clzValueDrift: z.number().int().nonnegative(),
    metadataOnly: z.number().int().nonnegative(),
  }),
  newNeedFreshVendorMap: z.number().int().nonnegative(),
  newReuseExistingMap: z.number().int().nonnegative(),
  clzValueLanding: ClzValueLandingSchema,
  rows: z.array(ClzDiffRowSchema),
  notes: z.string(),
});
export type ClzDiffReport = z.infer<typeof ClzDiffReportSchema>;
