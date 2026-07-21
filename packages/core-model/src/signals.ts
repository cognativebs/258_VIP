import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const SourceObservationSchema = BaseRecordSchema.extend({
  source: z.string().min(1),
  payloadRef: z.string().min(1),
  fetchedAt: z.coerce.date(),
});
export type SourceObservation = z.infer<typeof SourceObservationSchema>;

export const SignalTypeSchema = z.enum([
  "news",
  "market",
  "supply",
  "retail",
  "reprint",
  "auction",
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const QuarantineStatusSchema = z.enum([
  "active",
  "quarantined",
  "rejected",
]);

/** Persisted intelligence event — not the Orchastr8 Signal Hunter agent role. */
export const SignalSchema = BaseRecordSchema.extend({
  signalType: SignalTypeSchema,
  body: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  signalDate: z.coerce.date(),
  noveltyScore: z.number().min(0).max(1).nullable().optional(),
  quarantineStatus: QuarantineStatusSchema.default("active"),
  assetId: UuidSchema.nullable().optional(),
});
export type Signal = z.infer<typeof SignalSchema>;

export const HuntSignalSchema = BaseRecordSchema.extend({
  huntId: UuidSchema,
  signalType: SignalTypeSchema,
  body: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  signalDate: z.coerce.date(),
});
export type HuntSignal = z.infer<typeof HuntSignalSchema>;
