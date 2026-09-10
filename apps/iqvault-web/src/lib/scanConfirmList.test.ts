import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confirmListCount,
  confirmListDuplicateUnits,
  confirmListUnitDisplayName,
  formatDuplicateCopyVerifyMessage,
  isOnConfirmList,
  unitNeedsInventoryCopyAck,
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

describe("approve list duplicate copy verify", () => {
  it("treats already-held and reimported cards as needing a copy ack", () => {
    assert.equal(unitNeedsInventoryCopyAck(unit({})), false);
    assert.equal(
      unitNeedsInventoryCopyAck(unit({ duplicateAcknowledged: true })),
      true,
    );
    assert.equal(
      unitNeedsInventoryCopyAck(unit({ physicalReimport: true })),
      true,
    );
  });

  it("lists only confirm-list cards that already exist in inventory", () => {
    const batch = {
      id: "b1",
      device: "ricoh",
      status: "review",
      categoryHint: "pokemon",
      notes: null,
      createdAt: "",
      units: [
        unit({
          id: "held",
          reviewStatus: "draft_ready",
          duplicateAcknowledged: true,
          candidates: [
            {
              catalogKey: "pokemon:tcgdex:me02-060",
              displayName: "Carvanha",
              category: "pokemon",
              setName: "ME02",
              collectorNumber: "060",
              confidence: 0.9,
              matchReasons: [],
              adapterId: "tcgdex",
              assetId: null,
            },
          ],
        }),
        unit({ id: "fresh", reviewStatus: "draft_ready" }),
        unit({
          id: "off-list",
          reviewStatus: "needs_confirmation",
          duplicateAcknowledged: true,
        }),
      ],
    } as StagedBatch;
    const dupes = confirmListDuplicateUnits(batch);
    assert.deepEqual(
      dupes.map((u) => u.id),
      ["held"],
    );
    assert.equal(confirmListUnitDisplayName(dupes[0]!), "Carvanha (ME02 060)");
  });

  it("asks whether to add another copy and names the card", () => {
    assert.equal(
      formatDuplicateCopyVerifyMessage(["Carvanha (ME02 060)"]),
      "This card already exists in inventory:\n\nCarvanha (ME02 060)\n\nAdd another copy?",
    );
  });
});
