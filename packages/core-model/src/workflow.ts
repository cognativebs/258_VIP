import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const SyncEventSchema = BaseRecordSchema.extend({
  fromToolUserId: UuidSchema.nullable().optional(),
  toToolUserId: UuidSchema.nullable().optional(),
  eventType: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  status: z.enum(["queued", "applied", "failed"]).default("queued"),
});
export type SyncEvent = z.infer<typeof SyncEventSchema>;

export const WorkflowRunSchema = BaseRecordSchema.extend({
  kind: z.string().min(1),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable().optional(),
  deltaSummary: z.string().nullable().optional(),
  status: z.enum(["running", "succeeded", "failed"]).default("running"),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

/** Store-facing presentation derived from Recommendation — not a second engine. */
export const BuyOfferSchema = BaseRecordSchema.extend({
  recommendationId: UuidSchema,
  assetId: UuidSchema,
  maxOffer: z.number().nonnegative(),
  expectedMargin: z.number().nullable().optional(),
  listingChannel: z.string().nullable().optional(),
});
export type BuyOffer = z.infer<typeof BuyOfferSchema>;
