import { z } from "zod";

/**
 * Bulk review actions for a Ricoh scan batch (backlog F).
 *
 * - "Add all auto to confirm list" only STAGES cards (review_status = draft_ready).
 *   Nothing enters inventory until the operator runs Approve Confirm List, which
 *   keeps its duplicate gate (409 until copies are acknowledged).
 * - "Reject all none" is a status change on cards with no candidate at all.
 *   Raw scans, images and the unit rows are kept; nothing is deleted.
 *
 * Cards flagged for review (needs_review, pairing needs review) are never swept
 * up by a bulk action — needs_review is a permanent workflow state and the
 * operator handles those cards one at a time.
 */

export const BULK_REVIEW_RULE_VERSION = "scan-bulk-review@0.1.0";

/** Minimal unit shape the selectors need — matches the staged-unit rows. */
export type BulkReviewUnit = {
  id: string;
  status: string;
  resolutionMode: string | null;
  confidenceBand: string | null;
  reviewStatus: string | null;
  pairingNeedsReview: boolean;
  candidates: ReadonlyArray<unknown>;
};

export const BulkSkipReasonSchema = z.enum([
  "already_on_confirm_list",
  "needs_review",
  "pairing_needs_review",
  "no_candidate",
  "has_candidates",
]);
export type BulkSkipReason = z.infer<typeof BulkSkipReasonSchema>;

export type BulkSelection = {
  eligible: string[];
  skipped: Array<{ unitId: string; reason: BulkSkipReason }>;
};

function unresolved(unit: BulkReviewUnit): boolean {
  return !unit.resolutionMode;
}

/** Unresolved cards in the `auto` band that a bulk stage may put on the confirm list. */
export function selectAutoForConfirmList(
  units: ReadonlyArray<BulkReviewUnit>,
): BulkSelection {
  const eligible: string[] = [];
  const skipped: BulkSelection["skipped"] = [];
  for (const unit of units) {
    if (!unresolved(unit) || unit.confidenceBand !== "auto") continue;
    if (unit.reviewStatus === "draft_ready") {
      skipped.push({ unitId: unit.id, reason: "already_on_confirm_list" });
    } else if (unit.reviewStatus === "needs_review" || unit.status === "needs_review") {
      skipped.push({ unitId: unit.id, reason: "needs_review" });
    } else if (unit.pairingNeedsReview) {
      skipped.push({ unitId: unit.id, reason: "pairing_needs_review" });
    } else if (unit.candidates.length === 0) {
      skipped.push({ unitId: unit.id, reason: "no_candidate" });
    } else {
      eligible.push(unit.id);
    }
  }
  return { eligible, skipped };
}

/**
 * Unresolved cards in the `none` band (no candidate) that a bulk reject may close.
 * A card whose front/back pairing is in doubt is skipped: swapping faces may
 * identify it, so the operator looks at it first.
 */
export function selectNoneForReject(
  units: ReadonlyArray<BulkReviewUnit>,
): BulkSelection {
  const eligible: string[] = [];
  const skipped: BulkSelection["skipped"] = [];
  for (const unit of units) {
    if (!unresolved(unit) || unit.confidenceBand !== "none") continue;
    if (unit.candidates.length > 0) {
      skipped.push({ unitId: unit.id, reason: "has_candidates" });
    } else if (unit.pairingNeedsReview) {
      skipped.push({ unitId: unit.id, reason: "pairing_needs_review" });
    } else {
      eligible.push(unit.id);
    }
  }
  return { eligible, skipped };
}

const UnitIdSchema = z.string().uuid();

const BulkSkippedSchema = z.object({
  unitId: UnitIdSchema,
  reason: BulkSkipReasonSchema,
});

/** POST /api/scan/batches/:id/confirm-list/stage-auto — no options today. */
export const BulkStageAutoRequestSchema = z.object({}).strict();
export type BulkStageAutoRequest = z.infer<typeof BulkStageAutoRequestSchema>;

export const BulkStageAutoResultSchema = z.object({
  ok: z.literal(true),
  batchId: UnitIdSchema,
  staged: z.array(UnitIdSchema),
  skipped: z.array(BulkSkippedSchema),
  /** Staged cards that already look held — Approve will ask before adding a copy. */
  duplicates: z.array(z.object({ unitId: UnitIdSchema, displayName: z.string().min(1) })),
  ruleVersion: z.literal(BULK_REVIEW_RULE_VERSION),
  note: z.string(),
});
export type BulkStageAutoResult = z.infer<typeof BulkStageAutoResultSchema>;

/**
 * POST /api/scan/batches/:id/reject-none.
 * `confirm: true` is required so a stray POST cannot close cards.
 * `expectedCount` (the count the operator saw) guards against the batch
 * changing between the dialog and the request: a mismatch returns 409.
 */
export const BulkRejectNoneRequestSchema = z
  .object({
    confirm: z.literal(true),
    expectedCount: z.number().int().min(0).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type BulkRejectNoneRequest = z.infer<typeof BulkRejectNoneRequestSchema>;

export const BulkRejectNoneResultSchema = z.object({
  ok: z.literal(true),
  batchId: UnitIdSchema,
  rejected: z.array(UnitIdSchema),
  skipped: z.array(BulkSkippedSchema),
  errors: z.array(z.string()),
  ruleVersion: z.literal(BULK_REVIEW_RULE_VERSION),
  note: z.string(),
});
export type BulkRejectNoneResult = z.infer<typeof BulkRejectNoneResultSchema>;
