import { describe, expect, it } from "vitest";
import {
  MAP_INTEGRITY_ASK_MIN,
  MAP_INTEGRITY_RATIO_HIGH,
  MAP_INTEGRITY_RATIO_LOW,
  PHASE_D_CONFIDENCE_CEILING,
  PHASE_D_MIN_NIGHTLY_SNAPSHOTS,
  PhaseDContextSchema,
  PhaseDEvidenceBundleSchema,
  PHASE_D_RULE,
} from "./phase-d.js";

describe("Phase D evidence bundle", () => {
  it("caps confidence at 0.75 and stays cross-sectional", () => {
    const row = PhaseDEvidenceBundleSchema.parse({
      emitterKey: "ask_divergence_high",
      emitterVersion: PHASE_D_RULE,
      assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      conditionKey: "raw_ungraded",
      direction: "bullish",
      strength: 0.6,
      confidence: 0.75,
      firedAt: "2026-09-20T19:00:00.000Z",
      evidence: { medianAsk: 40, guidePrice: 20, listingCount: 6, ratio: 2 },
      notes: "cross-sectional only",
    });
    expect(row.confidence).toBeLessThanOrEqual(PHASE_D_CONFIDENCE_CEILING);
    expect(PHASE_D_MIN_NIGHTLY_SNAPSHOTS).toBe(30);
    expect(MAP_INTEGRITY_ASK_MIN).toBe(5);
    expect(MAP_INTEGRITY_RATIO_LOW).toBe(0.1);
    expect(MAP_INTEGRITY_RATIO_HIGH).toBe(10);
  });

  it("records deferred longitudinal emitters", () => {
    const ctx = PhaseDContextSchema.parse({
      nightlySnapshotDays: 1,
      deferredEmitters: ["price_acceleration", "lull_detected"],
      deferredUntilSnapshots: 30,
      askDivergence: [],
      gradePremiumCompression: [],
      gradingArbitrage: [],
      phase2Enabled: false,
      provenance: {
        source: "phase_d_cross_section",
        method: "inferred",
        ruleOrModelVersion: PHASE_D_RULE,
        verificationStatus: "unverified",
        confidenceCeiling: 0.75,
        notes: "wave 1",
      },
    });
    expect(ctx.phase2Enabled).toBe(false);
    expect(ctx.deferredEmitters).toEqual(["price_acceleration", "lull_detected"]);
  });
});
