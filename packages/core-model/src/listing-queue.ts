import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";
import { InventoryBucketSchema } from "./inventory-bucket.js";

export const ListingDraftStatusSchema = z.enum([
  "pending_credentials",
  "draft_ready",
  "blocked_personal",
  "blocked_insufficient_range",
  "blocked_not_sell",
  "submitted",
  "failed",
]);
export type ListingDraftStatus = z.infer<typeof ListingDraftStatusSchema>;

export const LISTING_QUEUE_RULE = "listing-queue@0.1.0";

export const ListingDraftSchema = BaseRecordSchema.extend({
  holdingId: UuidSchema.nullable(),
  holdingSourceRowId: z.string().min(1),
  inventoryBucket: InventoryBucketSchema,
  title: z.string().min(1),
  status: ListingDraftStatusSchema,
  askPrice: z.number().positive().nullable(),
  liveLow: z.number().positive().nullable(),
  liveHigh: z.number().positive().nullable(),
  listingCount: z.number().int().nonnegative(),
  emptyReason: z.string().nullable().optional(),
  listingPayload: z.record(z.unknown()).default({}),
  overrideNote: z.string().nullable().optional(),
});
export type ListingDraft = z.infer<typeof ListingDraftSchema>;

export const QueueListingDraftsBodySchema = z.object({
  holdingSourceRowIds: z.array(z.string().min(1)).min(1).max(40),
  /** Operator must set Sell — scan confirm is never enough. */
  action: z.literal("Sell"),
  askPrice: z.number().positive().nullable().optional(),
  /** Required to draft a personal-collection item. */
  personalOverrideNote: z.string().min(8).nullable().optional(),
  /** Required when askPrice is outside the live range. */
  rangeOverrideNote: z.string().min(8).nullable().optional(),
});
export type QueueListingDraftsBody = z.infer<typeof QueueListingDraftsBodySchema>;
