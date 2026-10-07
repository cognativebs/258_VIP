import { describe, expect, it } from "vitest";
import { GRADING_P98_SET_KEY, PhaseDEvidenceBundleSchema, PHASE_D_RULE } from "@vip/core-model";
import { calibrationSetFromArbitrage } from "./gradingCalibration.js";

describe("calibrationSetFromArbitrage", () => {
  it("freezes intersection-queue flags and keeps Phase 2 off", () => {
    const bundle = PhaseDEvidenceBundleSchema.parse({
      emitterKey: "grading_arbitrage",
      emitterVersion: PHASE_D_RULE,
      assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      conditionKey: "graded_9_8",
      direction: "bullish",
      strength: 0.5,
      confidence: 0.55,
      firedAt: "2026-09-20T23:00:00.000Z",
      evidence: {
        rawUngraded: 40,
        highGrade: 400,
        highKey: "graded_9_8",
        ratio: 10,
        p98: 0.2,
        p98Assumed: true,
        vendorDerivedMultiple: true,
        profitAtP10: 5,
        profitAtP20: 20,
        profitAtP30: 40,
        expectedIncrementalProfit: 20,
        expectedValue: 80,
        gradingOpportunityScore: 40,
        recommendation: "grade",
        pre1975PressRestorationRisk: true,
        yearBegan: 1970,
        canonicalName: "Amazing Spider-Man #90",
      },
      notes: "Grading Optimizer terms. Not signals_normalized.",
    });
    const set = calibrationSetFromArbitrage([bundle], new Date("2026-09-20T23:00:00.000Z"));
    expect(set.setKey).toBe(GRADING_P98_SET_KEY);
    expect(set.phase2Enabled).toBe(false);
    expect(set.recordCount).toBe(1);
    expect(set.records[0]?.flags).toEqual(
      expect.arrayContaining([
        "vendor_derived 9.8 multiple · confidence ≤ 0.75",
        "P(9.8)=0.2 assumed · unverified",
        "pre-1975 press/restoration risk",
      ]),
    );
  });
});
