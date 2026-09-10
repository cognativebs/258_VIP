import { describe, expect, it } from "vitest";
import { recommendDisposition } from "./disposition.js";
import type { SellingAssetInput } from "./schemas.js";

function asset(over: Partial<SellingAssetInput> = {}): SellingAssetInput {
  return {
    inventoryId: "h1",
    sourceRowId: "h1",
    category: "sports",
    ownershipBucket: "dealer_inventory",
    salesPathState: "available",
    quantity: 1,
    fmv: {
      low: 6,
      high: 8,
      mid: 7,
      currency: "USD",
      confidence: 0.5,
      evidenceCount: 4,
      source: "ebay_browse",
      method: "inferred",
      verificationStatus: "unverified",
      recencyDays: 2,
    },
    rookieFlag: false,
    autographFlag: false,
    relicFlag: false,
    parallelScarce: false,
    strongPlayerDemand: false,
    strongSearchability: false,
    playerTier: "unknown",
    saleVelocity: "unknown",
    marketTrend: "unknown",
    pcThesis: false,
    holdThesis: false,
    gradeThesis: false,
    relatedLotCount: 0,
    ...over,
  };
}

describe("disposition boundary rules", () => {
  it("defaults LOT/BULK below $2", () => {
    const lot = recommendDisposition(asset({ fmv: fmv(1.5), relatedLotCount: 6 }));
    expect(lot.disposition).toBe("LOT");
    expect(lot.reasonCodes).toContain("FMV_LT_2");
    const bulk = recommendDisposition(asset({ fmv: fmv(1.5), relatedLotCount: 0 }));
    expect(bulk.disposition).toBe("BULK");
  });

  it("uses demand to split $2–$5 between SINGLE and LOT", () => {
    const single = recommendDisposition(
      asset({
        fmv: fmv(3.2),
        strongPlayerDemand: true,
        strongSearchability: true,
        playerSubject: "Mahomes",
        setName: "Prizm",
      }),
    );
    expect(single.disposition).toBe("SINGLE");
    const lot = recommendDisposition(asset({ fmv: fmv(3.2) }));
    expect(lot.disposition).toBe("LOT");
  });

  it("defaults SINGLE from $5 and at/above $15 unless a thesis overrides", () => {
    expect(recommendDisposition(asset({ fmv: fmv(9) })).disposition).toBe("SINGLE");
    expect(recommendDisposition(asset({ fmv: fmv(20) })).disposition).toBe("SINGLE");
    expect(recommendDisposition(asset({ fmv: fmv(20), holdThesis: true })).disposition).toBe("HOLD");
    expect(recommendDisposition(asset({ fmv: fmv(20), gradeThesis: true })).disposition).toBe("GRADE");
    expect(
      recommendDisposition(asset({ fmv: fmv(20), ownershipBucket: "personal_collection" })).disposition,
    ).toBe("PC");
  });

  it("treats a completed sale as terminal even for personal collection", () => {
    const rec = recommendDisposition(
      asset({
        fmv: fmv(20),
        ownershipBucket: "personal_collection",
        salesPathState: "sold",
      }),
    );
    expect(rec.disposition).toBe("HOLD");
    expect(rec.reasonCodes).toContain("ALREADY_SOLD");
  });

  it("logs a human override as USER and does not silently ignore it", () => {
    const rec = recommendDisposition(asset({ fmv: fmv(1) }), {
      disposition: "SINGLE",
      reasonText: "Operator wants this as a single despite low FMV",
    });
    expect(rec.disposition).toBe("SINGLE");
    expect(rec.recommendedBy).toBe("USER");
    expect(rec.reasonCodes).toEqual(["USER_OVERRIDE"]);
  });
});

function fmv(mid: number) {
  return {
    low: mid,
    high: mid,
    mid,
    currency: "USD" as const,
    confidence: 0.4,
    evidenceCount: 2,
    source: "test",
    method: "inferred" as const,
    verificationStatus: "unverified" as const,
    recencyDays: 1,
  };
}
