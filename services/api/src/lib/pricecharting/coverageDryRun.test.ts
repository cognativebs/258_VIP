import { describe, expect, it } from "vitest";
import { matchAssetToVendorProducts } from "./matcher.js";
import { formatAssetCoverageReport, summarizeAssetCoverage } from "./coverageDryRun.js";

const cheap = {
  assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  canonicalName: "Absolute Batman #1",
  seriesTitle: "Absolute Batman",
  issueNumber: "1",
  coverLabel: "A",
  clzValue: 10,
};
const expensive = {
  assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  canonicalName: "Spawn #9",
  seriesTitle: "Spawn",
  issueNumber: "9",
  coverLabel: "Newsstand Edition",
  clzValue: 90,
};

describe("summarizeAssetCoverage", () => {
  it("reports asset, value, and top-100 coverage without enabling Phase 2", () => {
    const vendors = [
      {
        vendorProductId: "1",
        vendorProductName: "Absolute Batman #1",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
    ];
    const matches = [
      matchAssetToVendorProducts(cheap, vendors),
      matchAssetToVendorProducts(expensive, vendors),
    ];
    const report = summarizeAssetCoverage(matches, [cheap, expensive], vendors.length, "comic", "comics");
    expect(report.matchedAssets).toBe(1);
    expect(report.assetCoverage).toBe(0.5);
    expect(report.valueCoverage).toBe(0.1);
    expect(report.top100Matched).toBe(1);
    expect(report.top100Coverage).toBe(0.5);
    expect(report.byMethod.exact_name).toBe(1);
    expect(report.byMethod.unmatched).toBe(1);
    expect(report.wroteObservations).toBe(false);
    expect(report.phase2Enabled).toBe(false);
    expect(formatAssetCoverageReport(report)).toMatch(/assetCoverage=1\/2/);
  });
});
