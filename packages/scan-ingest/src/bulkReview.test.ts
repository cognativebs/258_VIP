import { describe, expect, it } from "vitest";
import {
  BulkRejectNoneRequestSchema,
  BulkStageAutoRequestSchema,
  selectAutoForConfirmList,
  selectNoneForReject,
  type BulkReviewUnit,
} from "./bulkReview.js";

let n = 0;
function unit(over: Partial<BulkReviewUnit> = {}): BulkReviewUnit {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    status: "identified",
    resolutionMode: null,
    confidenceBand: "auto",
    reviewStatus: "needs_confirmation",
    pairingNeedsReview: false,
    candidates: [{}],
    ...over,
  };
}

describe("selectAutoForConfirmList", () => {
  it("stages only unresolved auto-band cards with a candidate", () => {
    const ok = unit();
    const review = unit({ confidenceBand: "review" });
    const resolved = unit({ resolutionMode: "operator_confirmed" });
    const sel = selectAutoForConfirmList([ok, review, resolved]);
    expect(sel.eligible).toEqual([ok.id]);
    expect(sel.skipped).toEqual([]);
  });

  it("never sweeps up a needs_review or pairing-flagged card", () => {
    const flagged = unit({ reviewStatus: "needs_review" });
    const statusFlagged = unit({ status: "needs_review" });
    const pairing = unit({ pairingNeedsReview: true });
    const listed = unit({ reviewStatus: "draft_ready" });
    const empty = unit({ candidates: [] });
    const sel = selectAutoForConfirmList([flagged, statusFlagged, pairing, listed, empty]);
    expect(sel.eligible).toEqual([]);
    expect(sel.skipped.map((s) => s.reason)).toEqual([
      "needs_review",
      "needs_review",
      "pairing_needs_review",
      "already_on_confirm_list",
      "no_candidate",
    ]);
  });
});

describe("selectNoneForReject", () => {
  it("rejects only unresolved none-band cards with no candidate", () => {
    const none = unit({ confidenceBand: "none", candidates: [], reviewStatus: "needs_review" });
    const weak = unit({ confidenceBand: "weak", candidates: [] });
    const done = unit({ confidenceBand: "none", candidates: [], resolutionMode: "rejected" });
    const sel = selectNoneForReject([none, weak, done]);
    expect(sel.eligible).toEqual([none.id]);
  });

  it("skips a none card that gained candidates or has a pairing doubt", () => {
    const edited = unit({ confidenceBand: "none", candidates: [{}] });
    const pairing = unit({ confidenceBand: "none", candidates: [], pairingNeedsReview: true });
    const sel = selectNoneForReject([edited, pairing]);
    expect(sel.eligible).toEqual([]);
    expect(sel.skipped.map((s) => s.reason)).toEqual(["has_candidates", "pairing_needs_review"]);
  });
});

describe("bulk request contracts", () => {
  it("requires an explicit confirm for reject-none", () => {
    expect(BulkRejectNoneRequestSchema.safeParse({}).success).toBe(false);
    expect(BulkRejectNoneRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(
      BulkRejectNoneRequestSchema.parse({ confirm: true, expectedCount: 3 }).expectedCount,
    ).toBe(3);
  });

  it("stage-auto takes no options", () => {
    expect(BulkStageAutoRequestSchema.safeParse({}).success).toBe(true);
    expect(BulkStageAutoRequestSchema.safeParse({ acknowledgeDuplicates: true }).success).toBe(
      false,
    );
  });
});
