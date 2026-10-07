import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextScanSelection, selectScan, visibleScanRange } from "./scanLog";

describe("scan event log", () => {
  it("follows the newest event until an older row is selected", () => {
    const first = nextScanSelection({ rows: [{ id: "a" }], selectedId: null, followNewest: true });
    assert.deepEqual(first, { selectedId: "a", followNewest: true });
    const appended = nextScanSelection({
      rows: [{ id: "b" }, { id: "a" }],
      selectedId: first.selectedId,
      followNewest: first.followNewest,
    });
    assert.equal(appended.selectedId, "b");
    const pinned = selectScan([{ id: "b" }, { id: "a" }], "a");
    assert.equal(pinned.followNewest, false);
    const kept = nextScanSelection({
      rows: [{ id: "c" }, { id: "b" }, { id: "a" }],
      selectedId: pinned.selectedId,
      followNewest: pinned.followNewest,
    });
    assert.equal(kept.selectedId, "a");
  });

  it("renders only a window once the log passes 200 rows", () => {
    assert.equal(visibleScanRange(200, 0).virtual, false);
    const window = visibleScanRange(201, 0);
    assert.equal(window.virtual, true);
    assert.equal(window.start, 0);
    assert.ok(window.end < 201);
  });
});
