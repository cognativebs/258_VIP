import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moneyRange, previewUnknownExit } from "./unknownExitPreview";
import type { ComicsMeta } from "./comicTypes";

const META: ComicsMeta = {
  recordCount: 2700,
  totalValue: 24238,
  pillars: [{ name: "General Inventory", count: 1044, value: 3640 }],
};

describe("previewUnknownExit", () => {
  it("matches the July 2026 bulk-gift range and does not invent titles", () => {
    const impact = previewUnknownExit(META, 1000);
    assert.ok(impact);
    assert.equal(impact.method, "inferred");
    assert.equal(impact.verificationStatus, "unverified");
    assert.equal(impact.titlesInvented, false);
    assert.equal(impact.holdingsTouched, false);
    assert.equal(impact.physicalValueHigh, 24238);
    assert.equal(impact.physicalValueLow, Math.round((24238 - 3640 * (1000 / 1044)) * 100) / 100);
    assert.equal(impact.recommendations[0]?.action, "Pass");
    assert.doesNotMatch(JSON.stringify(impact), /giftedHoldingIds/);
    assert.match(moneyRange(impact.physicalValueLow, impact.physicalValueHigh), /inferred/);
  });
});
