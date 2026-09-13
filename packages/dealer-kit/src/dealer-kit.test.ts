import { describe, expect, it } from "vitest";
import { centsToDollars } from "./cents.js";
import { COMP_RED_FLAGS, COMP_SOURCES } from "./comp-check.js";
import { runFlipExamples } from "./examples.js";
import { scoreFlipDeal } from "./flip-score.js";
import { evaluateBreakEven, minSaleToBreakEven } from "./grading-breakeven.js";
import { listTiers, resolveTier } from "./grading-fees.js";
import { parsePriceChartingProduct } from "./pricecharting.js";
import { populationRedFlags } from "./pop-red-flags.js";
import { SAMPLE_STORE_SKUS, scoreStoreBook } from "./store-inventory.js";

const asOf = new Date("2026-09-13T15:00:00Z");

describe("centsToDollars", () => {
  it("converts pennies and refuses to invent zero", () => {
    expect(centsToDollars(17244)).toBe(172.44);
    expect(centsToDollars(0)).toBeNull();
    expect(centsToDollars(null)).toBeNull();
  });
});

describe("pricecharting parse", () => {
  it("maps condition keys and labels missing prices", () => {
    const p = parsePriceChartingProduct(
      {
        status: "success",
        id: "630417",
        "product-name": "Charizard #4",
        "console-name": "Pokemon Base Set",
        "loose-price": 25000,
        "manual-only-price": 400000,
      },
      "https://www.pricecharting.com",
    );
    expect(p.prices.ungraded).toBe(250);
    expect(p.prices.psa10).toBe(4000);
    expect(p.prices.grade9).toBeNull();
    expect(p.provenance.verificationStatus).toBe("unverified");
    expect(p.provenance.method).toBe("normalized");
  });

  it("does not treat an identity-only payload as a price", () => {
    const p = parsePriceChartingProduct(
      {
        status: "success",
        id: "630417",
        "product-name": "Charizard #4",
        "console-name": "Pokemon Base Set",
      },
      "https://www.pricecharting.com",
    );
    expect(p.rawKeysPresent).toEqual([]);
    expect(p.provenance.notes).toMatch(/Identity only/);
  });
});

describe("flip score", () => {
  it("buys when ask is under a real sold band", () => {
    const r = scoreFlipDeal({
      assetName: "Test under",
      ageYears: 30,
      popCount: 80,
      listingPrice: 80,
      asOf,
      comps: [
        { price: 120, saleDate: new Date("2026-09-01"), source: "ebay-sold" },
        { price: 125, saleDate: new Date("2026-08-20"), source: "ebay-sold" },
        { price: 118, saleDate: new Date("2026-08-10"), source: "ebay-sold" },
        { price: 122, saleDate: new Date("2026-07-28"), source: "ebay-sold" },
      ],
    });
    expect(r.action).toBe("buy_now");
    expect(r.flipScore).toBeGreaterThanOrEqual(55);
    expect(r.targetResaleLow).not.toBeNull();
    expect(r.targetResaleHigh).toBeGreaterThanOrEqual(r.targetResaleLow!);
    expect(r.provenance.verificationStatus).toBe("unverified");
  });

  it("passes when ask is above the high", () => {
    const r = scoreFlipDeal({
      assetName: "Test over",
      ageYears: 2,
      popCount: 20000,
      listingPrice: 400,
      asOf,
      comps: [
        { price: 50, saleDate: new Date("2026-09-01"), source: "ebay-sold" },
        { price: 55, saleDate: new Date("2026-08-20"), source: "ebay-sold" },
        { price: 48, saleDate: new Date("2026-08-10"), source: "ebay-sold" },
      ],
    });
    expect(r.action).toBe("pass");
    expect(r.reasonCodes).toContain("ASK_ABOVE_HIGH");
  });

  it("treats missing pop as unknown, not scarce", () => {
    const known = scoreFlipDeal({
      assetName: "Pop known",
      ageYears: 20,
      popCount: 20,
      listingPrice: 100,
      asOf,
      comps: [
        { price: 100, saleDate: new Date("2026-09-01"), source: "ebay-sold" },
        { price: 110, saleDate: new Date("2026-08-20"), source: "ebay-sold" },
        { price: 90, saleDate: new Date("2026-08-10"), source: "ebay-sold" },
      ],
    });
    const unknown = scoreFlipDeal({
      assetName: "Pop unknown",
      ageYears: 20,
      popCount: null,
      listingPrice: 100,
      asOf,
      comps: [
        { price: 100, saleDate: new Date("2026-09-01"), source: "ebay-sold" },
        { price: 110, saleDate: new Date("2026-08-20"), source: "ebay-sold" },
        { price: 90, saleDate: new Date("2026-08-10"), source: "ebay-sold" },
      ],
    });
    expect(unknown.breakdown.popPts).toBe(5);
    expect(known.breakdown.popPts).toBeGreaterThan(unknown.breakdown.popPts);
  });
});

describe("pre-filled examples", () => {
  it("covers ten decisions and all three actions", () => {
    const runs = runFlipExamples();
    expect(runs).toHaveLength(10);
    const actions = new Set(runs.map((r) => r.result.action));
    expect(actions.has("buy_now")).toBe(true);
    expect(actions.has("hold")).toBe(true);
    expect(actions.has("pass")).toBe(true);
    expect(runs.every((r) => r.result.supporting.length >= 1 && r.result.opposing.length >= 1)).toBe(
      true,
    );
  });
});

describe("grading break-even", () => {
  it("solves min sale as all-in / (1 - fee%)", () => {
    expect(minSaleToBreakEven(174.99, 0.13)).toBe(201.14);
  });

  it("uses the PSA Standard fee and flags a paused tier", () => {
    const r = evaluateBreakEven({
      rawCost: 100,
      grader: "PSA",
      category: "cards",
      tierId: "psa-cards-standard",
      shippingCost: 15,
      insuranceCost: 0,
      gradeValues: [
        { grade: "7", marketValue: 90, probability: 0.1 },
        { grade: "8", marketValue: 120, probability: 0.25 },
        { grade: "9", marketValue: 180, probability: 0.45 },
        { grade: "9.5", marketValue: 220, probability: 0.1 },
        { grade: "10", marketValue: 400, probability: 0.1 },
      ],
    });
    expect(r.tier.feeUsd).toBe(59.99);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[4]?.coversCosts).toBe(true);
    expect(r.expectedIncrementalProfit).not.toBeNull();
  });

  it("lists active CGC and BGS lanes", () => {
    expect(listTiers({ grader: "CGC", category: "cards" }).length).toBeGreaterThan(0);
    expect(resolveTier({ grader: "BGS", category: "cards", lane: "express" }).feeUsd).toBe(79.95);
  });
});

describe("pop red flags", () => {
  it("flags high pop and a thin gem spread", () => {
    const flags = populationRedFlags({
      popCount: 12000,
      ageYears: 2,
      gradeValues: [
        { grade: "9", marketValue: 100 },
        { grade: "10", marketValue: 120 },
      ],
    });
    expect(flags.some((f) => f.startsWith("HIGH_POP"))).toBe(true);
    expect(flags.some((f) => f.startsWith("THIN_GEM_SPREAD"))).toBe(true);
  });
});

describe("comp check", () => {
  it("puts PriceCharting last and names the three traps", () => {
    expect(COMP_SOURCES.at(-1)?.id).toBe("pricecharting");
    expect(COMP_RED_FLAGS.map((f) => f.id).sort()).toEqual(
      ["doctored-comic", "regraded-slab", "reprint-tcg"].sort(),
    );
  });
});

describe("store inventory", () => {
  it("marks leftover sealed as liquidate when secondary is below list", () => {
    const book = scoreStoreBook(SAMPLE_STORE_SKUS);
    const dead = book.rows.find((r) => r.sku === "CZ-ETB-DEAD");
    expect(dead?.deadStock).toBe("liquidate");
    expect(dead?.listVsSecondary).toBe("over");
    expect(book.liquidateCount).toBeGreaterThanOrEqual(1);
    expect(book.provenance.verificationStatus).toBe("unverified");
  });
});
