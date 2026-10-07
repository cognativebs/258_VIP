import { describe, expect, it } from "vitest";
import { PHASE_D_CONFIDENCE_CEILING } from "@vip/core-model";
import { emitAskDivergence, emitGradePremiumCompression, emitGradingArbitrage } from "./phaseD.js";

describe("emitAskDivergence", () => {
  it("fires high/low only with >=5 listings and ranks by dollar gap", () => {
    const rows = emitAskDivergence([
      {
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conditionKey: "raw_ungraded",
        medianAsk: 40,
        listingCount: 6,
        guidePrice: 20,
      },
      {
        assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        conditionKey: "raw_ungraded",
        medianAsk: 10,
        listingCount: 5,
        guidePrice: 20,
      },
      {
        assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        conditionKey: "raw_ungraded",
        medianAsk: 50,
        listingCount: 4,
        guidePrice: 20,
      },
      {
        assetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        conditionKey: "raw_ungraded",
        medianAsk: 8,
        listingCount: 8,
        guidePrice: 1,
      },
    ]);
    expect(rows.map((r) => r.emitterKey).sort()).toEqual([
      "ask_divergence_high",
      "ask_divergence_high",
      "ask_divergence_low",
    ]);
    expect(rows[0]?.assetId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(rows[0]?.evidence.dollarDivergence).toBe(20);
    expect(rows.every((r) => r.confidence <= PHASE_D_CONFIDENCE_CEILING)).toBe(true);
  });
});

describe("emitGradePremiumCompression", () => {
  it("fires only when the within-snapshot 9.8/raw spread is tight", () => {
    const rows = emitGradePremiumCompression([
      {
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        raw: 100,
        high: 120,
        highKey: "graded_9_8",
      },
      {
        assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        raw: 100,
        high: 400,
        highKey: "graded_9_8",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emitterKey).toBe("grade_premium_compression");
    expect(rows[0]?.evidence.ratio).toBe(1.2);
  });
});

describe("emitGradingArbitrage", () => {
  it("keeps only the P(9.8) 0.10/0.20/0.30 intersection and flags vendor-derived + pre-1975", () => {
    const rows = emitGradingArbitrage([
      {
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        raw: 20,
        high: 2000,
        highKey: "graded_9_8",
        yearBegan: 1963,
        publisher: "Marvel",
        canonicalName: "Amazing Fantasy #15",
      },
      {
        assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        raw: 100,
        high: 110,
        highKey: "graded_9_8",
        yearBegan: 2016,
        publisher: "Marvel",
        canonicalName: "modern filler",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assetId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(rows[0]?.evidence.intersectionQueue).toBe(true);
    expect(rows[0]?.evidence.vendorDerivedMultiple).toBe(true);
    expect(rows[0]?.evidence.p98Assumed).toBe(true);
    expect(rows[0]?.evidence.pre1975PressRestorationRisk).toBe(true);
    expect(rows[0]?.notes).toMatch(/vendor_derived 9\.8 multiple/);
    expect(rows[0]?.notes).toMatch(/pre-1975 press\/restoration risk/);
    expect(rows[0]?.confidence).toBeLessThanOrEqual(PHASE_D_CONFIDENCE_CEILING);
  });
});
