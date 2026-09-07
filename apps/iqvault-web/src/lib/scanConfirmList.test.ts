import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confirmListCount,
  isOnConfirmList,
  type StagedBatch,
  type StagedUnit,
} from "./scanApi";

function unit(partial: Partial<StagedUnit>): StagedUnit {
  return {
    id: partial.id ?? "u1",
    unitIndex: 0,
    status: "identified",
    frontStorageRef: "front.jpg",
    backStorageRef: null,
    selectedCandidateKey: null,
    holdingId: null,
    confirmedAssetId: null,
    resolutionMode: null,
    topConfidence: 0.8,
    confidenceBand: "review",
    duplicateAcknowledged: false,
    decisionAction: null,
    candidates: [],
    reviewStatus: "needs_confirmation",
    ...partial,
  };
}

describe("confirm list membership", () => {
  it("treats draft_ready unresolved cards as on the list", () => {
    assert.equal(isOnConfirmList(unit({ reviewStatus: "draft_ready" })), true);
    assert.equal(isOnConfirmList(unit({ reviewStatus: "needs_confirmation" })), false);
    assert.equal(
      isOnConfirmList(
        unit({ reviewStatus: "draft_ready", resolutionMode: "operator_confirmed" }),
      ),
      false,
    );
  });

  it("counts only unresolved draft_ready units", () => {
    const batch = {
      id: "b1",
      device: "ricoh",
      status: "review",
      categoryHint: "pokemon",
      notes: null,
      createdAt: "",
      units: [
        unit({ id: "a", reviewStatus: "draft_ready" }),
        unit({ id: "b", reviewStatus: "needs_confirmation" }),
        unit({
          id: "c",
          reviewStatus: "draft_ready",
          resolutionMode: "operator_confirmed",
        }),
      ],
    } as StagedBatch;
    assert.equal(confirmListCount(batch), 1);
  });
});
