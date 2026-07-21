import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

/** Canonical VIP actions. Watch is a Hold reason code, not a separate action. */
export const DecisionActionSchema = z.enum([
  "Buy",
  "Hold",
  "Grade",
  "Sell",
  "Lot",
  "Pass",
]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const UserConstraintsSchema = z.object({
  budget: z.number().nonnegative().nullable().optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).nullable().optional(),
  timeHorizon: z.string().nullable().optional(),
  collectionGoals: z.array(z.string()).default([]),
  premiumTolerance: z.number().min(0).max(1).nullable().optional(),
});
export type UserConstraints = z.infer<typeof UserConstraintsSchema>;

export const RecommendationSchema = BaseRecordSchema.extend({
  assetId: UuidSchema.nullable().optional(),
  holdingId: UuidSchema.nullable().optional(),
  action: DecisionActionSchema,
  reasonCodes: z.array(z.string()).default([]),
  supportingEvidenceRefs: z.array(z.string()).default([]),
  opposingEvidenceRefs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  constraintsSnapshot: UserConstraintsSchema.optional(),
  ruleOrModelVersion: z.string().min(1),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const DecisionOutcomeSchema = z.object({
  realized: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  resultLabel: z.string().nullable().optional(),
  measuredAt: z.coerce.date().nullable().optional(),
});

/** User-accepted (or overridden) action + outcome. Recommendation proposes; Decision records. */
export const DecisionSchema = BaseRecordSchema.extend({
  recommendationId: UuidSchema.nullable().optional(),
  chosenAction: DecisionActionSchema,
  wasOverride: z.boolean().default(false),
  evidenceBundleRefs: z.array(z.string()).default([]),
  decidedAt: z.coerce.date(),
  outcome: DecisionOutcomeSchema.optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;
