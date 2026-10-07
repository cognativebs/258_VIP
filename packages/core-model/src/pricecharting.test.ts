import { describe, expect, it } from "vitest";
import {
  csvDollarsToPennies,
  mapPriceChartingProduct,
  verticalFromConsoleName,
} from "./pricecharting-map.js";
import {
  EVIDENCE_CLASS_CEILING,
  PriceChartingProductSchema,
} from "./pricecharting.js";

const comicRow = PriceChartingProductSchema.parse({
  status: "success",
  id: "12345",
  "product-name": "Absolute Batman #1",
  "console-name": "DC Comics",
  upc: null,
  "loose-price": 4200,
  "box-only-price": 9100,
  "manual-only-price": 15000,
  "graded-price": 5500,
  "sales-volume": 88,
});

const cardRow = PriceChartingProductSchema.parse({
  status: "success",
  id: "67890",
  "product-name": "Charizard #4",
  "console-name": "Pokemon Base Set",
  "loose-price": 25000,
  "box-only-price": 80000,
  "manual-only-price": 120000,
  "bgs-10-price": 200000,
  "condition-17-price": 175000,
});

describe("PriceCharting evidence class", () => {
  it("caps vendor_derived recommendations at 0.75", () => {
    expect(EVIDENCE_CLASS_CEILING.vendor_derived).toBe(0.75);
    expect(EVIDENCE_CLASS_CEILING.observed).toBe(1);
  });
});

describe("mapPriceChartingProduct", () => {
  it("skips when vertical cannot be resolved", () => {
    const result = mapPriceChartingProduct(comicRow, null);
    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.needsReview).toBe(true);
      expect(result.reason).toMatch(/vertical unresolved/i);
    }
  });

  it("maps the same JSON keys differently for comics vs cards", () => {
    const comic = mapPriceChartingProduct(comicRow, "comic");
    const card = mapPriceChartingProduct(cardRow, "pokemon");
    expect(comic.skipped).toBe(false);
    expect(card.skipped).toBe(false);
    if (comic.skipped || card.skipped) return;

    const comicBox = comic.observations.find((o) => o.vendorKey === "box-only-price");
    const cardBox = card.observations.find((o) => o.vendorKey === "box-only-price");
    expect(comicBox?.conditionKey).toBe("graded_9_2");
    expect(cardBox?.conditionKey).toBe("graded_9_5");

    const comicManual = comic.observations.find((o) => o.vendorKey === "manual-only-price");
    const cardManual = card.observations.find((o) => o.vendorKey === "manual-only-price");
    expect(comicManual?.conditionKey).toBe("graded_9_8");
    expect(cardManual?.conditionKey).toBe("graded_psa_10");

    const collapsed = comic.observations.filter(
      (o) => o.vendorKey !== "loose-price" && o.conditionKey === "raw_ungraded",
    );
    expect(collapsed).toEqual([]);
    expect(comic.observations.find((o) => o.vendorKey === "box-only-price")?.conditionKey).toBe(
      "graded_9_2",
    );
  });

  it("converts pennies to dollars and never treats sales-volume as a price", () => {
    const comic = mapPriceChartingProduct(comicRow, "comic");
    expect(comic.skipped).toBe(false);
    if (comic.skipped) return;
    const loose = comic.observations.find((o) => o.vendorKey === "loose-price");
    expect(loose?.priceUsd).toBe(42);
    expect(comic.annualUnits).toBe(88);
    expect(comic.observations.every((o) => o.evidenceClass === "vendor_derived")).toBe(true);
    expect(comic.observations.every((o) => o.channel === "pricecharting")).toBe(true);
  });

  it("does not invent observations for missing keys", () => {
    const slim = PriceChartingProductSchema.parse({
      id: "1",
      "product-name": "Only Loose",
      "loose-price": 100,
    });
    const result = mapPriceChartingProduct(slim, "comic");
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.conditionKey).toBe("raw_ungraded");
  });
});

describe("verticalFromConsoleName", () => {
  it("resolves comics and does not default unknown consoles", () => {
    expect(verticalFromConsoleName("Comic Books")).toBe("comic");
    expect(verticalFromConsoleName("Pokemon Base Set")).toBe("pokemon");
    expect(verticalFromConsoleName("Unknown Guide")).toBeNull();
  });
});

describe("csvDollarsToPennies", () => {
  it("parses dollar cells without treating them as pennies", () => {
    expect(csvDollarsToPennies("$42.00")).toBe(4200);
    expect(csvDollarsToPennies("1,250.50")).toBe(125050);
    expect(csvDollarsToPennies("")).toBeNull();
  });
});
