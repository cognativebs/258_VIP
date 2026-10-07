import { describe, expect, it } from "vitest";
import { classifyMapIntegrity } from "@vip/core-model";
import {
  formatMapIntegrityReport,
  identityFromRow,
  pickLargestNegativeGap,
  type MapIntegrityReport,
  type MapIntegrityRow,
} from "./mapIntegrity.js";

describe("map integrity report", () => {
  it("states trips against the comic baseline and does not mention Phase 2", () => {
    const report: MapIntegrityReport = {
      version: "map-integrity-ask-guide@0.1.0",
      baselineAssets: 1151,
      comicBaselineAssets: 1093,
      scoredN5: 541,
      trips: 1,
      tripsLow: 1,
      tripsHigh: 0,
      mapsDemoted: 1,
      mapsConfirmedBlocked: 0,
      observationsIneligible: 6,
      valueBaseline: 10000,
      valueComicBaseline: 9913,
      valueTripped: 12,
      valueWeightedImpact: 12 / 9913,
      samples: [
        {
          canonicalName: "America's Best Comics #1 (64 Page Giant)",
          ratio: 0.004,
          medianAsk: 3.9,
          guideRaw: 931,
          vendorProductName: "America's Best Comics #1 (1942)",
          clzValue: 12,
        },
      ],
    };
    const text = formatMapIntegrityReport(report);
    expect(text).toMatch(/trips=1/);
    expect(text).toMatch(/valueWeightedImpact/);
    expect(text).not.toMatch(/signals_normalized/);
    expect(classifyMapIntegrity({ listingCount: 20, medianAsk: 3.9, guideRaw: 931 }).verdict).toBe(
      "map_suspect",
    );
  });

  it("picks the -$927 gap and calls a 2000 vs 1942 map wrong_era", () => {
    const abc: MapIntegrityRow = {
      assetId: "f21cb885-c641-4f1f-95cc-556333bc8dda",
      canonicalName: "America's Best Comics #1 (64 Page Giant)",
      listingCount: 20,
      medianAsk: 3.895,
      guideRaw: 931,
      ratio: 0.0042,
      verdict: "map_suspect",
      reason: "flag map",
      clzValue: 55,
      vendorProductId: "2520217",
      vendorProductName: "America's Best Comics #1 (1942)",
      vendorConsoleName: "Comic Books America's Best Comics",
      needsReview: true,
      confirmedAt: null,
      matchMethod: "exact_name",
      seriesTitle: "America's Best Comics",
      publisher: "DC Comics",
      seriesVolume: 1,
      yearBegan: 2000,
      issueNumber: "1",
      coverLabel: "64 Page Giant",
    };
    const other: MapIntegrityRow = { ...abc, assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", medianAsk: 16, guideRaw: 122, ratio: 0.13, yearBegan: 2006, vendorProductName: "American Splendor #1 (1976)" };
    expect(pickLargestNegativeGap([other, abc])?.assetId).toBe(abc.assetId);
    expect(identityFromRow(abc).verdict).toBe("wrong_era");
    expect(identityFromRow(abc).dollarGap).toBeCloseTo(-927.105, 2);
  });
});
