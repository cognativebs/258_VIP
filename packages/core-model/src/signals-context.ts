import { z } from "zod";
import { QuarantineStatusSchema, SignalTypeSchema } from "./signals.js";

export const SIGNALS_CONTEXT_RULE = "signals-context@0.1.0";
export const SIGNALS_CONTEXT_CAP = 25;

export const SignalsContextItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  body: z.string().min(1),
  sourceId: z.string().min(1),
  publishedAt: z.string().min(1),
  signalType: SignalTypeSchema,
  quarantineStatus: QuarantineStatusSchema,
  confidence: z.number().min(0).max(1),
  ruleVersion: z.string().min(1),
});
export type SignalsContextItem = z.infer<typeof SignalsContextItemSchema>;

export const SignalsContextSchema = z.object({
  active: z.array(SignalsContextItemSchema).max(SIGNALS_CONTEXT_CAP),
  quarantinedCount: z.number().int().nonnegative(),
  feedKind: z.enum(["job_feed", "seed", "empty"]),
  provenance: z.object({
    source: z.string(),
    method: z.literal("inferred"),
    ruleOrModelVersion: z.literal(SIGNALS_CONTEXT_RULE),
    verificationStatus: z.literal("unverified"),
    notes: z.string(),
  }),
});
export type SignalsContext = z.infer<typeof SignalsContextSchema>;

export const SignalOutputActionSchema = z.enum(["Hold", "Review", "Churn", "Pass"]);

export const SignalBucketOutputSchema = z.object({
  signalId: z.string().min(1),
  title: z.string(),
  body: z.string(),
  action: SignalOutputActionSchema,
  bucketHint: z.enum([
    "personal_collection",
    "investment_vault",
    "dealer_inventory",
    "unmapped",
  ]),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type SignalBucketOutput = z.infer<typeof SignalBucketOutputSchema>;
