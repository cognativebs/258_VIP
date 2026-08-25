import { afterEach, describe, expect, it } from "vitest";
import { mapInventoryRow } from "./holdings.js";
import {
  buildRecommendation,
  COMPS_HOLDING_CAP,
  MIN_SALES_FOR_MARKET_EVIDENCE,
  parseHoldingIdsQuery,
  selectHoldingsForRecommendations,
} from "./recommendations.js";

afterEach(() => {
  delete process.env.VIP_COMPS_USE_FIXTURE;
  delete process.env.VIP_COMPS_FIXTURE_JSON;
});

const comic = mapInventoryRow(
  {
    Series: "Absolute Batman",
    "Issue Full": "1A",
    Publisher: "DC Comics",
    "CLZ Hash": "test-ab1",
    "Assumed Grade": "NM assumed",
    "Slab Status": "Raw",
    "Grade Rating": 0,
    Quantity: 1,
    "Current Price": 40,
  },
  0,
);

function sale(id: string, price: number, daysAgo: number) {
  const d = new Date("2026-08-25T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return {
    id,
    price,
    saleDate: d.toISOString(),
    source: "ebay.com/sold",
    provenance: {
      method: "api" as const,
      ruleOrModelVersion: "fixture",
      verificationStatus: "verified" as const,
      confidence: 0.9,
    },
  };
}

describe("recommendations holding selection", () => {
  it("parses, dedupes, and caps holdingIds", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    const parsed = parseHoldingIdsQuery(`${ids.join(",")},id-0,`);
    expect(parsed).toHaveLength(COMPS_HOLDING_CAP);
    expect(parsed[0]).toBe("id-0");
    expect(parsed.at(-1)).toBe("id-11");
  });

  it("selects requested holdings and reports missing ids", () => {
    const a = { ...comic, id: "a" };
    const b = { ...comic, id: "b" };
    const { selected, missingIds } = selectHoldingsForRecommendations([a, b], ["b", "nope"], 12);
    expect(selected.map((h) => h.id)).toEqual(["b"]);
    expect(missingIds).toEqual(["nope"]);
  });

  it("falls back to limit when no holdingIds", () => {
    const holdings = [comic, { ...comic, id: "two" }, { ...comic, id: "three" }];
    const { selected, missingIds } = selectHoldingsForRecommendations(holdings, [], 2);
    expect(selected).toHaveLength(2);
    expect(missingIds).toEqual([]);
  });
});

describe("buildRecommendation market evidence", () => {
  it("treats idle adapters as insufficient with unverified provenance", async () => {
    const rec = await buildRecommendation(comic);
    expect(rec.insufficientMarketEvidence).toBe(true);
    expect(rec.minSalesRequired).toBe(MIN_SALES_FOR_MARKET_EVIDENCE);
    expect(rec.compsSource).toBe("none");
    expect(rec.provenance.verificationStatus).toBe("unverified");
    expect(rec.reasonCodes).toContain("INSUFFICIENT_MARKET_EVIDENCE");
  });

  it("still flags 2 matched sales as insufficient", async () => {
    process.env.VIP_COMPS_USE_FIXTURE = "1";
    process.env.VIP_COMPS_FIXTURE_JSON = JSON.stringify([sale("s1", 20, 3), sale("s2", 24, 10)]);
    const rec = await buildRecommendation(comic);
    expect(rec.marketRange?.matchedSales).toBe(2);
    expect(rec.insufficientMarketEvidence).toBe(true);
  });

  it("clears insufficient only at minSalesRequired", async () => {
    process.env.VIP_COMPS_USE_FIXTURE = "1";
    process.env.VIP_COMPS_FIXTURE_JSON = JSON.stringify([
      sale("s1", 20, 3),
      sale("s2", 24, 10),
      sale("s3", 22, 4),
    ]);
    const rec = await buildRecommendation(comic);
    expect(rec.marketRange?.matchedSales).toBe(3);
    expect(rec.insufficientMarketEvidence).toBe(false);
    expect(rec.compsSource).toBe("ebay.com/sold");
    expect(rec.marketRange?.low).toBeGreaterThan(0);
    expect(rec.marketRange?.high).toBeGreaterThanOrEqual(rec.marketRange?.low ?? 0);
  });
});
