import { describe, expect, it } from "vitest";
import { GradingP98CalibrationSetSchema } from "./grading-calibration.js";
import { GRADING_P98_SET_KEY, GRADING_P98_SET_RULE, PHASE_D_P_98_UNVERIFIED } from "./phase-d.js";

describe("GradingP98CalibrationSet", () => {
  it("freezes the first P(9.8) set with flags and Phase 2 off", () => {
    const set = GradingP98CalibrationSetSchema.parse({
      setKey: GRADING_P98_SET_KEY,
      setFrozenAt: "2026-09-20T23:00:00.000Z",
      ruleOrModelVersion: GRADING_P98_SET_RULE,
      p98AssumedDefault: PHASE_D_P_98_UNVERIFIED,
      phase2Enabled: false,
      recordCount: 1,
      removed: [],
      records: [
        {
          assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          holdingId: null,
          canonicalName: "Amazing Spider-Man #90",
          rawUngraded: 40,
          highGrade: 400,
          highKey: "graded_9_8",
          ratio: 10,
          profitAtP10: 5,
          profitAtP20: 20,
          profitAtP30: 40,
          expectedIncrementalProfit: 20,
          expectedGradingValue: 80,
          gradingOpportunityScore: 40,
          recommendation: "grade",
          p98Assumed: 0.2,
          vendorDerivedMultiple: true,
          pre1975PressRestorationRisk: true,
          yearBegan: 1970,
          flags: [
            "vendor_derived 9.8 multiple · confidence ≤ 0.75",
            "P(9.8)=0.2 assumed · unverified",
            "pre-1975 press/restoration risk",
          ],
          evidence: { intersectionQueue: true },
        },
      ],
      provenance: {
        source: "grading_p98_calibration",
        method: "inferred",
        ruleOrModelVersion: GRADING_P98_SET_RULE,
        verificationStatus: "unverified",
        notes: "first P(9.8) calibration set",
      },
    });
    expect(set.phase2Enabled).toBe(false);
    expect(set.records[0]?.flags.length).toBeGreaterThanOrEqual(2);
  });
});
