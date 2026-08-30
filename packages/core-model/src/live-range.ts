import { z } from "zod";

/**
 * Cached Browse-listing range for a holding (plan 0003 Track B).
 * Never a sold ledger. Never overwrites current_price_snapshot.
 */
export const LiveRangeStatusSchema = z.enum(["not_fetched", "empty", "range"]);
export type LiveRangeStatus = z.infer<typeof LiveRangeStatusSchema>;

export const LiveRangeChipSchema = z.object({
  holdingSourceRowId: z.string().min(1),
  status: LiveRangeStatusSchema,
  observationKind: z.enum(["browse_listing", "browse_empty"]).nullable(),
  low: z.number().positive().nullable(),
  high: z.number().positive().nullable(),
  listingCount: z.number().int().nonnegative(),
  recencyDays: z.number().nonnegative().nullable(),
  observedAt: z.string().nullable(),
  verificationStatus: z.literal("unverified"),
  label: z.string().min(1),
  ruleOrModelVersion: z.string().min(1),
});
export type LiveRangeChip = z.infer<typeof LiveRangeChipSchema>;

export const LIVE_RANGE_RULE = "live-range-chip@0.1.0";

export function formatLiveRangeChip(input: {
  status: LiveRangeStatus;
  low: number | null;
  high: number | null;
  listingCount: number;
  recencyDays: number | null;
}): string {
  if (input.status === "not_fetched") return "not fetched";
  if (input.status === "empty" || input.listingCount === 0 || input.low == null) {
    return "0 listings · unverified";
  }
  const low = `$${input.low.toFixed(2)}`;
  const high = `$${(input.high ?? input.low).toFixed(2)}`;
  const range = low === high ? low : `${low}–${high}`;
  const n = input.listingCount;
  const listings = `${n} listing${n === 1 ? "" : "s"}`;
  const recency =
    input.recencyDays == null ? null : `${Math.round(input.recencyDays)}d`;
  return [range, listings, recency, "unverified"].filter(Boolean).join(" · ");
}

export function liveRangeChip(input: {
  holdingSourceRowId: string;
  listingCount: number;
  low: number | null;
  high: number | null;
  recencyDays: number | null;
  observedAt: string | null;
  fetched: boolean;
}): LiveRangeChip {
  const status: LiveRangeStatus = !input.fetched
    ? "not_fetched"
    : input.listingCount > 0 && input.low != null
      ? "range"
      : "empty";
  return LiveRangeChipSchema.parse({
    holdingSourceRowId: input.holdingSourceRowId,
    status,
    observationKind: !input.fetched
      ? null
      : input.listingCount > 0
        ? "browse_listing"
        : "browse_empty",
    low: status === "range" ? input.low : null,
    high: status === "range" ? (input.high ?? input.low) : null,
    listingCount: input.fetched ? input.listingCount : 0,
    recencyDays: status === "range" ? input.recencyDays : null,
    observedAt: input.fetched ? input.observedAt : null,
    verificationStatus: "unverified",
    label: formatLiveRangeChip({
      status,
      low: input.low,
      high: input.high,
      listingCount: input.listingCount,
      recencyDays: input.recencyDays,
    }),
    ruleOrModelVersion: LIVE_RANGE_RULE,
  });
}
