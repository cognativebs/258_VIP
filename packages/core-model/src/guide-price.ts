import { z } from "zod";
import { ConditionKeySchema, EVIDENCE_CLASS_CEILING } from "./pricecharting.js";

export const GUIDE_PRICE_RULE = "pricecharting-guide-snapshot@0.2.0";
export const GUIDE_PRICE_PRE_ADAPTER_RULE = "pricecharting-guide-snapshot@0.1.0";
export const GUIDE_PRICE_PRE_ADAPTER_BATCH = "pre_adapter_20260913";
export const GUIDE_PRICE_PHASE_B_BATCH = "phase_b_csv";
export const GUIDE_PRICE_CONFIDENCE_CEILING = EVIDENCE_CLASS_CEILING.vendor_derived;
export const GUIDE_PRICE_SOURCE = "pricecharting" as const;

export const GuideObservationKindSchema = z.enum(["guide_quote", "guide_empty"]);
export type GuideObservationKind = z.infer<typeof GuideObservationKindSchema>;

export const GuidePriceObservationSchema = z.object({
  assetId: z.string().uuid(),
  holdingId: z.string().uuid().nullable(),
  holdingSourceRowId: z.string().min(1),
  pricedUnitId: z.string().uuid().nullable(),
  conditionKey: ConditionKeySchema,
  snapshotOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observedAt: z.coerce.date(),
  observationKind: GuideObservationKindSchema,
  source: z.literal(GUIDE_PRICE_SOURCE),
  evidenceClass: z.literal("vendor_derived"),
  guidePrice: z.number().positive().nullable(),
  currency: z.literal("USD"),
  rawSnapshotId: z.string().uuid().nullable(),
  providerIds: z.record(z.string()),
  provSource: z.literal(GUIDE_PRICE_SOURCE),
  provMethod: z.literal("inferred"),
  provRuleVersion: z.string().min(1),
  provConfidence: z.number().min(0).max(GUIDE_PRICE_CONFIDENCE_CEILING),
  provVerification: z.literal("unverified"),
  provNotes: z.string().nullable(),
  ingestBatch: z.string().min(1),
  baselineEligible: z.boolean(),
});
export type GuidePriceObservation = z.infer<typeof GuidePriceObservationSchema>;
