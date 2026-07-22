import { describe, expect, it } from "vitest";
import { allInCost } from "./cost.js";
import { marketRange } from "./market-range.js";
import { recommend } from "./recommend.js";

const asOf = new Date("2026-07-01T12:00:00Z");

describe("allInCost", () => {
  it("sums ask + fees without hiding components", () => {
    const r = allInCost(
      { askPrice: 100, tax: 8, shipping: 5, grading: 20, expectedSellingFees: 13 },
      {},
    );
    expect(r.allIn).toBe(146);
    expect(r.components.length).toBeGreaterThan(3);
  });
});

describe("marketRange", () => {
  it("returns a range with evidence count — never a lone fake point", () => {
    const r = marketRange({
      asOf,
      windowDays: 90,
      sales: [
        { id: "1", price: 20, saleDate: new Date("2026-06-20"), source: "ebay" },
        { id: "2", price: 24, saleDate: new Date("2026-06-10"), source: "ebay" },
        { id: "3", price: 22, saleDate: new Date("2026-05-15"), source: "ebay" },
      ],
    });
    expect(r.matchedSales).toBe(3);
    expect(r.low).toBeLessThanOrEqual(r.high);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.evidenceIds).toHaveLength(3);
  });
});

describe("recommend", () => {
  it("always cites supporting and opposing evidence", () => {
    const rec = recommend({
      assetId: "a1",
      assetName: "Test",
      askPrice: 10,
      asOf,
      sales: [
        { id: "1", price: 14, saleDate: new Date("2026-06-20"), source: "ebay" },
        { id: "2", price: 15, saleDate: new Date("2026-06-10"), source: "ebay" },
        { id: "3", price: 13, saleDate: new Date("2026-06-01"), source: "ebay" },
      ],
      constraints: { budget: 50, riskTolerance: "medium", collectionGoals: [] },
    });
    expect(rec.supportingEvidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.opposingEvidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.constraintsSnapshot.budget).toBe(50);
    expect(["Buy", "Watch", "Pass"]).toContain(rec.stance);
  });

  it("threads constraints so same comps can Pass on low budget", () => {
    const sales = [
      { id: "1", price: 40, saleDate: new Date("2026-06-20"), source: "ebay" },
      { id: "2", price: 42, saleDate: new Date("2026-06-10"), source: "ebay" },
      { id: "3", price: 38, saleDate: new Date("2026-06-01"), source: "ebay" },
    ];
    const rich = recommend({
      assetId: "a",
      assetName: "X",
      askPrice: 30,
      asOf,
      sales,
      constraints: { budget: 100, riskTolerance: "high", collectionGoals: [] },
    });
    const poor = recommend({
      assetId: "a",
      assetName: "X",
      askPrice: 30,
      asOf,
      sales,
      constraints: { budget: 20, riskTolerance: "high", collectionGoals: [] },
    });
    expect(poor.stance).toBe("Pass");
    expect(poor.reasonCodes).toContain("OVER_BUDGET");
    expect(rich.stance).not.toBe("Pass");
  });

  it("maps Watch stance to canonical Hold action", () => {
    const rec = recommend({
      assetId: "a",
      assetName: "X",
      askPrice: 14,
      asOf,
      sales: [
        { id: "1", price: 12, saleDate: new Date("2026-06-20"), source: "ebay" },
        { id: "2", price: 15, saleDate: new Date("2026-06-10"), source: "ebay" },
        { id: "3", price: 13, saleDate: new Date("2026-06-01"), source: "ebay" },
      ],
      constraints: { budget: 40, riskTolerance: "medium", collectionGoals: [] },
    });
    if (rec.stance === "Watch") {
      expect(rec.action).toBe("Hold");
      expect(rec.reasonCodes).toContain("WATCH");
    }
  });
});
