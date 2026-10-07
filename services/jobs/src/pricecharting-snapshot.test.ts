import { describe, expect, it } from "vitest";
import {
  GUIDE_PRICE_CONFIDENCE_CEILING,
  PriceChartingProductSchema,
} from "@vip/core-model";
import { parsePriceChartingCsv, productsToCsv } from "./pricechartingCsv.js";
import {
  chicagoDate,
  observationsFromMappedProduct,
  redactPriceChartingUrl,
} from "./pricecharting-snapshot.js";

const csv = `id,product-name,console-name,loose-price,cib-price,new-price,graded-price,box-only-price,manual-only-price,bgs-10-price
99,Absolute Batman #1,Comic Books,12.00,18.00,25.00,40.00,80.00,150.00,400.00
`;

describe("parsePriceChartingCsv", () => {
  it("reads dollar columns into pennies", () => {
    const rows = parsePriceChartingCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("99");
    expect(rows[0]?.["loose-price"]).toBe(1200);
    expect(rows[0]?.["bgs-10-price"]).toBe(40000);
  });

  it("round-trips products through CSV dollars", () => {
    const first = parsePriceChartingCsv(csv);
    const again = parsePriceChartingCsv(productsToCsv(first));
    expect(again[0]?.["loose-price"]).toBe(1200);
    expect(again[0]?.["product-name"]).toBe("Absolute Batman #1");
  });
});

describe("observationsFromMappedProduct", () => {
  it("writes one observation per mapped condition, not raw_ungraded only", () => {
    const product = PriceChartingProductSchema.parse({
      id: "99",
      "product-name": "Absolute Batman #1",
      "console-name": "Comic Books",
      "loose-price": 1200,
      "cib-price": 1800,
      "new-price": 2500,
      "graded-price": 4000,
      "box-only-price": 8000,
      "manual-only-price": 15000,
      "bgs-10-price": 40000,
    });
    const rows = observationsFromMappedProduct({
      product,
      assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      snapshotOn: "2026-09-20",
      observedAt: new Date("2026-09-20T08:00:00Z"),
      rawSnapshotId: null,
    });
    const keys = rows.map((r) => r.conditionKey).sort();
    expect(keys).toEqual([
      "graded_10",
      "graded_4",
      "graded_6",
      "graded_8",
      "graded_9_2",
      "graded_9_8",
      "raw_ungraded",
    ]);
    expect(rows.every((r) => r.evidenceClass === "vendor_derived")).toBe(true);
    expect(rows.every((r) => r.provConfidence <= GUIDE_PRICE_CONFIDENCE_CEILING)).toBe(true);
    expect(rows.every((r) => r.baselineEligible)).toBe(true);
    const reviewOnly = observationsFromMappedProduct({
      product,
      assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      snapshotOn: "2026-09-20",
      observedAt: new Date("2026-09-20T08:00:00Z"),
      rawSnapshotId: null,
      baselineEligible: false,
    });
    expect(reviewOnly.every((r) => r.baselineEligible === false)).toBe(true);
    expect(rows.every((r) => r.pricedUnitId === null)).toBe(true);
    expect(rows[0]?.holdingSourceRowId).toBe("pc:99:asset:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const box = rows.find((r) => r.providerIds.vendor_key === "box-only-price");
    expect(box?.conditionKey).toBe("graded_9_2");
    expect(
      rows.some((r) => r.providerIds.vendor_key !== "loose-price" && r.conditionKey === "raw_ungraded"),
    ).toBe(false);
  });

  it("skips products with unresolved vertical", () => {
    const product = PriceChartingProductSchema.parse({
      id: "1",
      "product-name": "Unknown",
      "console-name": "Widgets",
      "loose-price": 100,
    });
    expect(
      observationsFromMappedProduct({
        product,
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        snapshotOn: "2026-09-20",
        observedAt: new Date("2026-09-20T08:00:00Z"),
        rawSnapshotId: null,
      }),
    ).toEqual([]);
  });
});

describe("chicagoDate", () => {
  it("formats an America/Chicago calendar day", () => {
    expect(chicagoDate(new Date("2026-09-20T10:00:00-05:00"))).toBe("2026-09-20");
  });
});

describe("redactPriceChartingUrl", () => {
  it("never echoes the token", () => {
    expect(
      redactPriceChartingUrl("https://www.pricecharting.com/console/x?format=csv&t=secret-token"),
    ).toBe("https://www.pricecharting.com/console/x?format=csv&t=REDACTED");
  });
});
