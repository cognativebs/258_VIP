import { describe, expect, it } from "vitest";
import { buildDailyListingQueue } from "./queue.js";
import type { SellingAssetInput } from "./schemas.js";

function asset(id: string, mid: number, over: Partial<SellingAssetInput> = {}): SellingAssetInput {
  return {
    inventoryId: id,
    sourceRowId: id,
    category: "sports",
    playerSubject: id,
    setName: "Prizm",
    year: 2020,
    ownershipBucket: "dealer_inventory",
    salesPathState: "available",
    quantity: 1,
    fmv: {
      low: mid,
      high: mid,
      mid,
      currency: "USD",
      confidence: 0.5,
      evidenceCount: 4,
      source: "test",
      method: "inferred",
      verificationStatus: "unverified",
      recencyDays: 1,
    },
    rookieFlag: false,
    autographFlag: false,
    relicFlag: false,
    parallelScarce: false,
    strongPlayerDemand: true,
    strongSearchability: true,
    playerTier: "star",
    saleVelocity: "hot",
    marketTrend: "up",
    pcThesis: false,
    holdThesis: false,
    gradeThesis: false,
    relatedLotCount: 0,
    ...over,
  };
}

describe("daily listing queue", () => {
  it("ranks a mixed queue and excludes PC/HOLD", () => {
    const items = buildDailyListingQueue({
      target: 10,
      assets: [
        asset("liq", 8),
        asset("stale", 6, { saleVelocity: "stale", daysInInventory: 120 }),
        asset("scarce", 22, { serialNumber: "12/25", parallelScarce: true }),
        asset("pc", 30, { ownershipBucket: "personal_collection" }),
        ...Array.from({ length: 8 }, (_, i) => asset(`x${i}`, 7)),
      ],
      events: [
        {
          eventId: "e1",
          subjectType: "player",
          subjectId: "liq",
          eventType: "BREAKOUT_PERFORMANCE",
          eventTime: new Date(),
          severity: 0.8,
          confidence: 0.7,
          source: "manual",
          summary: "Breakout game",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(items.some((i) => i.inventoryId === "pc")).toBe(false);
    expect(items.every((i) => i.confidence > 0)).toBe(true);
    expect(items.every((i) => (i.title ?? "").length > 0)).toBe(true);
  });
});
