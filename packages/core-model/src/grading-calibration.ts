import { z } from "zod";
import { GRADING_P98_SET_KEY, GRADING_P98_SET_RULE, PHASE_D_P_98_UNVERIFIED } from "./phase-d.js";

export const GradingP98CalibrationRecSchema = z.object({
  assetId: z.string().uuid(),
  holdingId: z.string().uuid().nullable(),
  canonicalName: z.string().nullable(),
  rawUngraded: z.number().nonnegative(),
  highGrade: z.number().nonnegative(),
  highKey: z.string().min(1),
  ratio: z.number().nonnegative(),
  profitAtP10: z.number(),
  profitAtP20: z.number(),
  profitAtP30: z.number(),
  expectedIncrementalProfit: z.number(),
  expectedGradingValue: z.number(),
  gradingOpportunityScore: z.number(),
  recommendation: z.string().min(1),
  p98Assumed: z.number().min(0).max(1),
  vendorDerivedMultiple: z.literal(true),
  pre1975PressRestorationRisk: z.boolean(),
  yearBegan: z.number().int().nullable(),
  flags: z.array(z.string().min(1)).min(1),
  evidence: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type GradingP98CalibrationRec = z.infer<typeof GradingP98CalibrationRecSchema>;

export const GradingP98RemovalSchema = z.object({
  assetId: z.string().uuid(),
  canonicalName: z.string().nullable(),
  reason: z.string().min(1),
  removedAt: z.string().min(1),
  yearBegan: z.number().int().nullable(),
  vendorProductName: z.string().nullable(),
  vendorYear: z.number().int().nullable(),
});
export type GradingP98Removal = z.infer<typeof GradingP98RemovalSchema>;

export const GradingP98CalibrationSetSchema = z.object({
  setKey: z.literal(GRADING_P98_SET_KEY),
  setFrozenAt: z.string().min(1),
  ruleOrModelVersion: z.literal(GRADING_P98_SET_RULE),
  p98AssumedDefault: z.literal(PHASE_D_P_98_UNVERIFIED),
  phase2Enabled: z.literal(false),
  recordCount: z.number().int().nonnegative(),
  records: z.array(GradingP98CalibrationRecSchema),
  removed: z.array(GradingP98RemovalSchema).default([]),
  provenance: z.object({
    source: z.literal("grading_p98_calibration"),
    method: z.literal("inferred"),
    ruleOrModelVersion: z.literal(GRADING_P98_SET_RULE),
    verificationStatus: z.literal("unverified"),
    notes: z.string(),
  }),
});
export type GradingP98CalibrationSet = z.infer<typeof GradingP98CalibrationSetSchema>;
