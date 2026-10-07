import { z } from "zod";
import { ConditionKeySchema } from "./pricecharting.js";

export const PHASE_D_RULE = "phase-d-cross-section@0.1.0";
export const PHASE_D_CONFIDENCE_CEILING = 0.75;
export const PHASE_D_MIN_NIGHTLY_SNAPSHOTS = 30;
export const PHASE_D_ASK_LISTING_MIN = 5;
export const PHASE_D_ASK_HIGH = 1.25;
export const PHASE_D_ASK_LOW = 0.85;
export const PHASE_D_ASK_CONTEXT_HIGH = 12;
export const PHASE_D_ASK_CONTEXT_LOW = 13;
export const PHASE_D_PREMIUM_TIGHT = 1.4;
/** Assumed CGC 9.8 hit rate · unverified. No pop report attached. */
export const PHASE_D_P_98_UNVERIFIED = 0.2;
export const PHASE_D_P_98_SENSITIVITY = [0.1, 0.2, 0.3] as const;
export const PHASE_D_GRADING_COST = 25;
export const PHASE_D_SELLING_EXPENSE_PCT = 0.13;
export const PHASE_D_PRE_1975_YEAR = 1975;

/** Ask/guide extremes flag the vendor map, not the listing price. */
export const MAP_INTEGRITY_ASK_MIN = 5;
export const MAP_INTEGRITY_RATIO_LOW = 0.1;
export const MAP_INTEGRITY_RATIO_HIGH = 10;
export const MAP_INTEGRITY_RULE = "map-integrity-ask-guide@0.1.0";
export const GRADING_P98_SET_KEY = "p98_set_001";
export const GRADING_P98_SET_RULE = "grading-p98-calibration@0.1.0";

/** series.year_began minus vendor product year. Vendor-older > this flags the map. */
export const ERA_GAP_YEARS = 10;
export const ERA_AUDIT_RULE = "map-era-gap@0.1.0";

export const PhaseDEmitterKeySchema = z.enum([
  "ask_divergence_high",
  "ask_divergence_low",
  "grade_premium_compression",
  "grading_arbitrage",
  "price_acceleration",
  "lull_detected",
]);
export type PhaseDEmitterKey = z.infer<typeof PhaseDEmitterKeySchema>;

export const PhaseDDeferredEmitters = ["price_acceleration", "lull_detected"] as const;

export const PhaseDEvidenceBundleSchema = z.object({
  emitterKey: PhaseDEmitterKeySchema,
  emitterVersion: z.literal(PHASE_D_RULE),
  assetId: z.string().uuid(),
  conditionKey: ConditionKeySchema,
  direction: z.enum(["bullish", "bearish", "neutral"]),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(PHASE_D_CONFIDENCE_CEILING),
  firedAt: z.string().min(1),
  evidence: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  notes: z.string().min(1),
});
export type PhaseDEvidenceBundle = z.infer<typeof PhaseDEvidenceBundleSchema>;

export const PhaseDContextSchema = z.object({
  nightlySnapshotDays: z.number().int().nonnegative(),
  deferredEmitters: z.array(z.enum(PhaseDDeferredEmitters)),
  deferredUntilSnapshots: z.literal(PHASE_D_MIN_NIGHTLY_SNAPSHOTS),
  askDivergence: z.array(PhaseDEvidenceBundleSchema),
  gradePremiumCompression: z.array(PhaseDEvidenceBundleSchema),
  gradingArbitrage: z.array(PhaseDEvidenceBundleSchema),
  phase2Enabled: z.literal(false),
  provenance: z.object({
    source: z.literal("phase_d_cross_section"),
    method: z.literal("inferred"),
    ruleOrModelVersion: z.literal(PHASE_D_RULE),
    verificationStatus: z.literal("unverified"),
    confidenceCeiling: z.literal(PHASE_D_CONFIDENCE_CEILING),
    notes: z.string(),
  }),
});
export type PhaseDContext = z.infer<typeof PhaseDContextSchema>;
