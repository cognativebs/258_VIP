import { describe, expect, it } from "vitest";
import {
  dryRunMatchVendorProduct,
  formatComicsDryRunReport,
  productFromSnapshotPayload,
  productsFromSnapshotPayload,
  summarizeComicsDryRun,
} from "./comicsDryRun.js";

const batman = {
  assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  canonicalName: "Absolute Batman #1",
  seriesTitle: "Absolute Batman",
  upc: "761941378201",
};

describe("dryRunMatchVendorProduct", () => {
  it("matches UPC without inventing a confirmed_at", () => {
    const row = dryRunMatchVendorProduct(
      {
        vendorProductId: "99",
        vendorProductName: "Absolute Batman 1",
        vendorUpc: "761941378201",
      },
      [batman],
    );
    expect(row.matchMethod).toBe("upc");
    expect(row.needsReview).toBe(false);
    expect(row.confirmedAt).toBeUndefined();
    expect(row.confirmedBelowFloor).toBe(false);
  });

  it("flags fuzzy matches for review", () => {
    const row = dryRunMatchVendorProduct(
      { vendorProductId: "1", vendorProductName: "Absolut Batman 1" },
      [batman],
    );
    expect(row.needsReview).toBe(true);
  });
});

describe("summarizeComicsDryRun", () => {
  it("reports match rate and never enables Phase 2", () => {
    const rows = [
      dryRunMatchVendorProduct(
        { vendorProductId: "1", vendorProductName: "Absolute Batman #1", vendorUpc: "761941378201" },
        [batman],
      ),
      dryRunMatchVendorProduct({ vendorProductId: "2", vendorProductName: "Unrelated" }, [batman]),
    ];
    const report = summarizeComicsDryRun(rows, 1);
    expect(report.matched).toBe(1);
    expect(report.matchedAssets).toBe(1);
    expect(report.needsReview).toBe(1);
    expect(report.matchRate).toBe(0.5);
    expect(report.wroteMaps).toBe(false);
    expect(report.phase2Enabled).toBe(false);
    expect(report.confirmedBelowFloor).toEqual([]);
    expect(formatComicsDryRunReport(report)).toMatch(/confirmed_below_0\.90=0/);
  });
});

describe("productFromSnapshotPayload", () => {
  it("parses PriceCharting product JSON and rejects unrelated payloads", () => {
    const ok = productFromSnapshotPayload(
      JSON.stringify({ id: "9", "product-name": "Absolute Batman #1", "loose-price": 1200 }),
    );
    expect(ok?.id).toBe("9");
    expect(productFromSnapshotPayload('{"hello":true}')).toBeNull();
  });

  it("flattens search-result snapshots", () => {
    const products = productsFromSnapshotPayload(
      JSON.stringify({
        status: "success",
        products: [
          { id: "1", "product-name": "A #1", "loose-price": 100 },
          { id: "2", "product-name": "B #2", "loose-price": 200 },
        ],
      }),
    );
    expect(products.map((p) => p.id)).toEqual(["1", "2"]);
  });
});
