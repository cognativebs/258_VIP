import { z } from "zod";

/** How a value was produced. Inferred must never masquerade as observed. */
export const ProvenanceMethodSchema = z.enum([
  "observed",
  "normalized",
  "inferred",
  "opinion",
  "recommendation",
]);
export type ProvenanceMethod = z.infer<typeof ProvenanceMethodSchema>;

export const VerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "disputed",
  "superseded",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/** Optional human band alongside numeric confidence 0–1. */
export const ConfidenceBandSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;

export const ProvenanceSchema = z.object({
  source: z.string().min(1),
  method: ProvenanceMethodSchema,
  ruleOrModelVersion: z.string().min(1),
  /** 0–1 inclusive. Prefer band for UI when precision is weak. */
  confidence: z.number().min(0).max(1),
  confidenceBand: ConfidenceBandSchema.optional(),
  verificationStatus: VerificationStatusSchema,
  supersededBy: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
