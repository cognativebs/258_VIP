import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";
import { DecisionActionSchema } from "./decisions.js";

export const ThesisStatusSchema = z.enum([
  "draft",
  "active",
  "retired",
  "invalidated",
]);

export const ThesisSchema = BaseRecordSchema.extend({
  claim: z.string().min(1),
  horizon: z.string().min(1),
  linkedAssetIds: z.array(UuidSchema).default([]),
  status: ThesisStatusSchema.default("draft"),
});
export type Thesis = z.infer<typeof ThesisSchema>;

export const PredictionOutcomeSchema = z.enum([
  "pending",
  "hit",
  "miss",
  "partial",
  "void",
]);

export const PredictionSchema = BaseRecordSchema.extend({
  thesisId: UuidSchema.nullable().optional(),
  claim: z.string().min(1),
  probability: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()).default([]),
  action: DecisionActionSchema.nullable().optional(),
  expiresAt: z.coerce.date(),
  outcome: PredictionOutcomeSchema.default("pending"),
  calibrationNotes: z.string().nullable().optional(),
  brierScore: z.number().nullable().optional(),
});
export type Prediction = z.infer<typeof PredictionSchema>;
