import { describe, expect, it } from "vitest";
import { exactMembership, proposeLots } from "./lots.js";
import type { SellingAssetInput } from "./schemas.js";

function card(id: string, player: string, mid: number, over: Partial<SellingAssetInput> = {}): SellingAssetInput {
  return {
    inventoryId: id,
    sourceRowId: id,
    category: "sports",
    playerSubject: player,
    setName: "Prizm",
    year: 2018,
    team: "Chiefs",
    ownershipBucket: "dealer_inventory",
    salesPathState: "available",
    quantity: 1,
    fmv: {
      low: mid,
      high: mid,
      mid,
      currency: "USD",
      confidence: 0.4,
      evidenceCount: 2,
      source: "test",
      method: "inferred",
      verificationStatus: "unverified",
      recencyDays: 1,
    },
    rookieFlag: false,
    autographFlag: false,
    relicFlag: false,
    parallelScarce: false,
    strongPlayerDemand: false,
    strongSearchability: false,
    playerTier: "star",
    saleVelocity: "stale",
    marketTrend: "unknown",
    pcThesis: false,
    holdThesis: false,
    gradeThesis: false,
    relatedLotCount: 5,
    ...over,
  };
}

describe("lot builder", () => {
  it("proposes player lots and keeps exact membership", () => {
    const assets = [
      card("a", "Patrick Mahomes", 3.2),
      card("b", "Patrick Mahomes", 2.1),
      card("c", "Patrick Mahomes", 1.8),
      card("d", "Patrick Mahomes", 2.4),
      card("pc", "Patrick Mahomes", 2.0, { currentDisposition: "PC" }),
    ];
    const lots = proposeLots(assets);
    expect(lots.length).toBeGreaterThan(0);
    const playerLot = lots.find((l) => l.groupingKey.startsWith("player:"));
    expect(playerLot).toBeTruthy();
    expect(playerLot?.inventoryIds).toEqual(["a", "b", "c", "d"]);
    expect(exactMembership(playerLot!)).not.toContain("pc");
    expect(playerLot?.netDollarsPerLaborMinute).toBeGreaterThan(0);
  });
});
