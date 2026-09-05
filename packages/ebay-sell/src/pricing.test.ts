import { describe, expect, it } from "vitest";
import { netPerLaborMinute, pickDefaultStrategy, quotePrice } from "./pricing.js";
import type { FmvSnapshot } from "./schemas.js";

const fmv: FmvSnapshot = {
  low: 10,
  high: 12,
  mid: 10,
  currency: "USD",
  confidence: 0.5,
  evidenceCount: 3,
  source: "ebay_browse",
  method: "inferred",
  verificationStatus: "unverified",
  recencyDays: 1,
};

describe("pricing strategy math", () => {
  it("applies named multiplier bands without overwriting FMV", () => {
    const q = quotePrice({ fmv, strategy: "NORMAL" });
    expect(q.currentFmv).toEqual(fmv);
    expect(q.recommendedListPrice).toBe(10.5);
    expect(q.minimumAcceptablePrice).toBe(10);
    expect(q.feeIsEstimate).toBe(true);
    expect(q.estimatedFee).toBeCloseTo(1.39, 2);
  });

  it("covers liquidate, best-offer, scarce, and reluctant bands", () => {
    expect(quotePrice({ fmv, strategy: "LIQUIDATE" }).recommendedListPrice).toBe(9.5);
    expect(quotePrice({ fmv, strategy: "BEST_OFFER_TARGET" }).minimumAcceptablePrice).toBe(10.5);
    expect(quotePrice({ fmv, strategy: "SCARCE_LOW_POP" }).recommendedListPrice).toBe(14);
    expect(quotePrice({ fmv, strategy: "RELUCTANT_SELLER" }).minimumAcceptablePrice).toBe(15);
  });

  it("computes net per labor minute", () => {
    expect(netPerLaborMinute(21.8, 6)).toBeCloseTo(3.63, 2);
    expect(pickDefaultStrategy({ fmvMid: 3 })).toBe("LIQUIDATE");
    expect(pickDefaultStrategy({ fmvMid: 20, scarce: true })).toBe("SCARCE_LOW_POP");
  });
});
