import { describe, expect, it } from "vitest";
import {
  UNKNOWN_EXIT_RULE,
  UnknownExitCreateSchema,
  catalogSliceFromPillars,
  evaluateUnknownExitImpact,
  giftedShare,
} from "./unknown-exit.js";

/** July 2026 committed CLZ proof — General Inventory is the bulk bin. */
const JULY_SLICE = {
  catalogHoldings: 2700,
  catalogValue: 24238,
  scopeName: "General Inventory",
  scopeHoldings: 1044,
  scopeValue: 3640,
};

describe("UnknownExitCreateSchema", () => {
  it("requires unknown titles — refuses a pretended title list", () => {
    const ok = UnknownExitCreateSchema.parse({
      estimatedQty: 1000,
      titlesRecorded: false,
      acknowledgeUnknownTitles: true,
      recipientNote: "School custodian gift",
    });
    expect(ok.scope).toBe("general_inventory_bulk");
    expect(
      UnknownExitCreateSchema.safeParse({
        estimatedQty: 1000,
        titlesRecorded: true,
        acknowledgeUnknownTitles: true,
      }).success,
    ).toBe(false);
    expect(
      UnknownExitCreateSchema.safeParse({
        estimatedQty: 1000,
        titlesRecorded: false,
        acknowledgeUnknownTitles: false,
      }).success,
    ).toBe(false);
  });
});

describe("evaluateUnknownExitImpact", () => {
  it("gives a value range for ~1000 unrecorded bulk, never a point fact", () => {
    const impact = evaluateUnknownExitImpact(JULY_SLICE, 1000);
    expect(impact.method).toBe("inferred");
    expect(impact.verificationStatus).toBe("unverified");
    expect(impact.holdingsTouched).toBe(false);
    expect(impact.titlesInvented).toBe(false);
    expect(impact.ruleOrModelVersion).toBe(UNKNOWN_EXIT_RULE);
    expect(impact.physicalValueHigh).toBe(24238);
    expect(impact.physicalValueLow).toBe(round2(24238 - 3640 * (1000 / 1044)));
    expect(impact.physicalValueLow).toBeLessThan(impact.physicalValueHigh);
    expect(impact.physicalHoldingsLow).toBe(1700);
    expect(impact.physicalHoldingsHigh).toBe(2700);
    expect(impact.recommendations[0]?.action).toBe("Pass");
    expect(impact.recommendations[0]?.reasonCodes).toContain("DO_NOT_DELETE_HOLDINGS");
    expect(impact.recommendations[1]?.action).toBe("Hold");
  });

  it("caps the unaccounted slice at the bulk pillar — does not eat keys", () => {
    const impact = evaluateUnknownExitImpact(JULY_SLICE, 5000);
    expect(impact.giftedShare).toBe(1);
    expect(impact.unaccountedValueHigh).toBe(3640);
    expect(impact.physicalValueLow).toBe(20598);
    expect(impact.physicalHoldingsLow).toBe(1656);
  });

  it("does not invent a title list from the qty", () => {
    const impact = evaluateUnknownExitImpact(JULY_SLICE, 1000);
    expect(impact).not.toHaveProperty("giftedHoldingIds");
    expect(impact.titlesInvented).toBe(false);
  });
});

describe("catalogSliceFromPillars", () => {
  it("reads General Inventory from meta pillars", () => {
    const slice = catalogSliceFromPillars(2700, 24238, [
      { name: "General Inventory", count: 1044, value: 3640 },
      { name: "Batman", count: 295, value: 3781 },
    ]);
    expect(slice.scopeHoldings).toBe(1044);
    expect(slice.scopeValue).toBe(3640);
    expect(giftedShare(1000, 1044)).toBeCloseTo(1000 / 1044);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
