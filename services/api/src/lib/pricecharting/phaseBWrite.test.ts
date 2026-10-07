import { describe, expect, it } from "vitest";
import {
  classifyComicMatches,
  productHasGradedLadder,
  seriesCandidateReport,
} from "./phaseBWrite.js";
import { matchAssetToVendorProducts, type AssetMatchResult, type MatchCandidate } from "./matcher.js";
import { PriceChartingProductSchema } from "@vip/core-model";

function comicMatch(overrides: Partial<AssetMatchResult> & { assetId: string }): AssetMatchResult {
  return {
    vendor: {
      vendorProductId: "1",
      vendorProductName: "Title #1",
      vendorConsoleName: "Comic Books Title",
    },
    matchMethod: "exact_name",
    matchConfidence: 0.9,
    needsReview: false,
    candidatesAfterSeries: 1,
    candidatesAfterIssue: 1,
    ...overrides,
  };
}

describe("classifyComicMatches", () => {
  it("keeps unambiguous exact_name and parks ambiguous in review", () => {
    const classified = classifyComicMatches([
      comicMatch({ assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", needsReview: false }),
      comicMatch({
        assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        needsReview: true,
        candidatesAfterIssue: 4,
      }),
      comicMatch({
        assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        matchMethod: "trgm",
        needsReview: true,
      }),
    ]);
    expect(classified.unambiguous).toHaveLength(1);
    expect(classified.ambiguous).toHaveLength(1);
    expect(classified.ambiguous[0]?.assetId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});

describe("seriesCandidateReport", () => {
  it("shows 21+ after series is vendor-pool size, not missing issue numbers", () => {
    const assets: MatchCandidate[] = Array.from({ length: 3 }, (_, i) => ({
      assetId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`,
      canonicalName: `Absolute Batman #${i + 1}`,
      seriesTitle: "Absolute Batman",
      issueNumber: String(i + 1),
    }));
    const matches: AssetMatchResult[] = assets.map((asset, i) => ({
      assetId: asset.assetId,
      vendor: {
        vendorProductId: String(i + 1),
        vendorProductName: `Absolute Batman #${i + 1}`,
        vendorConsoleName: "Comic Books Absolute Batman",
      },
      matchMethod: "exact_name",
      matchConfidence: 0.9,
      needsReview: i === 0,
      candidatesAfterSeries: 80,
      candidatesAfterIssue: i === 0 ? 24 : 1,
    }));
    const report = seriesCandidateReport(matches, assets);
    expect(report.series21Plus).toBe(3);
    expect(report.numericIssueInSeries21).toBe(3);
    expect(report.afterIssue21Plus).toBe(1);
    expect(report.longestOwnedSeriesAssets).toBe(3);
    expect(report.top[0]?.series).toBe("Absolute Batman");
  });
});

describe("productHasGradedLadder", () => {
  it("rejects loose-only search stubs", () => {
    const looseOnly = PriceChartingProductSchema.parse({
      id: "1",
      "product-name": "Spawn #9",
      "console-name": "Comic Books Spawn",
      "loose-price": 900,
    });
    expect(productHasGradedLadder(looseOnly)).toBe(false);
  });

  it("accepts a doc-mapped graded column", () => {
    const full = PriceChartingProductSchema.parse({
      id: "1",
      "product-name": "Spawn #9",
      "console-name": "Comic Books Spawn",
      "loose-price": 900,
      "manual-only-price": 6528,
    });
    expect(productHasGradedLadder(full)).toBe(true);
  });
});

describe("long-run issue filter", () => {
  it("still isolates one issue when the series pool is huge", () => {
    const vendors = [
      ...Array.from({ length: 40 }, (_, i) => ({
        vendorProductId: `n${i + 1}`,
        vendorProductName: `Legends of the Dark Knight #${i + 1}`,
        vendorConsoleName: "Comic Books Batman: Legends of the Dark Knight",
      })),
      {
        vendorProductId: "v1",
        vendorProductName: "Legends of the Dark Knight #12 [Variant]",
        vendorConsoleName: "Comic Books Batman: Legends of the Dark Knight",
      },
    ];
    const hit = matchAssetToVendorProducts(
      {
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        canonicalName: "Batman: Legends of the Dark Knight #12",
        seriesTitle: "Batman: Legends of the Dark Knight",
        issueNumber: "12",
        coverLabel: "A",
      },
      vendors,
    );
    expect(hit.candidatesAfterSeries).toBe(41);
    expect(hit.candidatesAfterIssue).toBeGreaterThanOrEqual(1);
    expect(hit.matchMethod).toBe("exact_name");
  });
});
