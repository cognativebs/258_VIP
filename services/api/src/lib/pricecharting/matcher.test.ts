import { describe, expect, it } from "vitest";
import { matchAssetToVendorProducts, matchVendorProduct, normalizeMatchText, setMatches } from "./matcher.js";
import { normalizeSeriesTitle, stripComicBooksPrefix } from "./normalize.js";

const batman = {
  assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  canonicalName: "Absolute Batman #1",
  seriesTitle: "Absolute Batman",
  issueNumber: "1",
  coverLabel: "A",
  upc: "761941378201",
};

describe("normalizeMatchText", () => {
  it("strips issue punctuation so PC and vault names compare", () => {
    expect(normalizeMatchText("Absolute Batman #1")).toBe("absolute batman 1");
    expect(normalizeMatchText("Absolute Batman 1")).toBe("absolute batman 1");
  });
});

describe("matchVendorProduct", () => {
  it("matches UPC exactly without review", () => {
    const row = matchVendorProduct(
      {
        vendorProductId: "pc-1",
        vendorProductName: "Absolute Batman 1",
        vendorUpc: "761941378201",
      },
      [batman],
    );
    expect(row.matchMethod).toBe("upc");
    expect(row.assetId).toBe(batman.assetId);
    expect(row.needsReview).toBe(false);
    expect(row.matchConfidence).toBe(0.98);
  });

  it("matches normalized name + set without review", () => {
    const row = matchVendorProduct(
      {
        vendorProductId: "pc-2",
        vendorProductName: "Absolute Batman #1",
        vendorConsoleName: "Absolute Batman",
      },
      [batman],
    );
    expect(row.matchMethod).toBe("exact_name");
    expect(row.needsReview).toBe(false);
    expect(row.matchConfidence).toBe(0.9);
  });

  it("flags trgm matches for review", () => {
    const row = matchVendorProduct(
      {
        vendorProductId: "pc-3",
        vendorProductName: "Absolut Batman 1",
      },
      [{ ...batman, similarity: 0.86 }],
    );
    expect(row.matchMethod).toBe("trgm");
    expect(row.needsReview).toBe(true);
    expect(row.matchConfidence).toBe(0.86);
  });

  it("leaves unmatched rows in review with no asset", () => {
    const row = matchVendorProduct(
      { vendorProductId: "pc-4", vendorProductName: "Unrelated Title" },
      [batman],
    );
    expect(row.matchMethod).toBe("unmatched");
    expect(row.assetId).toBeNull();
    expect(row.needsReview).toBe(true);
  });

  it("never overwrites a confirmed row", () => {
    const row = matchVendorProduct(
      {
        vendorProductId: "pc-1",
        vendorProductName: "Changed Name",
        vendorUpc: "761941378201",
      },
      [batman],
      {
        assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        matchMethod: "manual",
        matchConfidence: 1,
        needsReview: false,
        confirmedAt: new Date("2026-09-01T00:00:00Z"),
      },
    );
    expect(row.assetId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(row.matchMethod).toBe("manual");
    expect(row.confirmedAt).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("strips Comic Books prefix and matches series + issue", () => {
    const row = matchVendorProduct(
      {
        vendorProductId: "pc-6",
        vendorProductName: "Absolute Batman #1",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
      [batman],
    );
    expect(stripComicBooksPrefix("Comic Books Absolute Batman")).toBe("Absolute Batman");
    expect(normalizeSeriesTitle("The Amazing Spider-Man, Vol. 1")).toBe("amazing spider man");
    expect(normalizeSeriesTitle("Comic Books The Amazing Spider-Man")).toBe("amazing spider man");
    expect(row.matchMethod).toBe("exact_name");
    expect(row.needsReview).toBe(false);
    expect(row.assetId).toBe(batman.assetId);
  });

  it("rejects a high-confidence auto-match below 0.90 when not UPC/exact", () => {
    const row = matchVendorProduct(
      { vendorProductId: "pc-5", vendorProductName: "Close" },
      [{ ...batman, similarity: 0.89 }],
    );
    expect(row.matchMethod).toBe("trgm");
    expect(row.needsReview).toBe(true);
    expect((row.matchConfidence ?? 0) < 0.9).toBe(true);
  });
});

describe("setMatches", () => {
  it("treats Pokemon prefix and subset names as the same set", () => {
    expect(setMatches("Pokemon Chaos Rising", "Chaos Rising")).toBe(true);
    expect(setMatches("Pokemon Mega Evolution Chaos Rising", "Chaos Rising")).toBe(true);
  });
});

describe("matchAssetToVendorProducts", () => {
  it("picks the vendor product for one asset and counts series candidates", () => {
    const hit = matchAssetToVendorProducts(batman, [
      {
        vendorProductId: "1",
        vendorProductName: "Absolute Batman #1",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
      {
        vendorProductId: "2",
        vendorProductName: "Absolute Batman #2",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
      {
        vendorProductId: "3",
        vendorProductName: "Spawn #1",
        vendorConsoleName: "Comic Books Spawn",
      },
    ]);
    expect(hit.matchMethod).toBe("exact_name");
    expect(hit.vendor?.vendorProductId).toBe("1");
    expect(hit.candidatesAfterSeries).toBe(2);
    expect(hit.candidatesAfterIssue).toBe(1);
    expect(hit.needsReview).toBe(false);
  });

  it("parks vendor-plain + asset-tokened in review and rejects the reverse", () => {
    const vendors = [
      {
        vendorProductId: "plain",
        vendorProductName: "Absolute Batman #1",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
      {
        vendorProductId: "virgin",
        vendorProductName: "Absolute Batman #1 Virgin",
        vendorConsoleName: "Comic Books Absolute Batman",
      },
    ];
    const tokened = matchAssetToVendorProducts(
      { ...batman, coverLabel: "Virgin", canonicalName: "Absolute Batman #1 Virgin" },
      vendors,
    );
    expect(tokened.matchMethod).toBe("exact_name");
    expect(tokened.vendor?.vendorProductId).toBe("virgin");
    expect(tokened.needsReview).toBe(false);

    const tokenedPlainOnly = matchAssetToVendorProducts(
      { ...batman, coverLabel: "Virgin", canonicalName: "Absolute Batman #1 Virgin" },
      [vendors[0]!],
    );
    expect(tokenedPlainOnly.matchMethod).toBe("exact_name");
    expect(tokenedPlainOnly.vendor?.vendorProductId).toBe("plain");
    expect(tokenedPlainOnly.needsReview).toBe(true);

    const plainAsset = matchAssetToVendorProducts({ ...batman, coverLabel: "A" }, [vendors[1]!]);
    expect(plainAsset.matchMethod).not.toBe("exact_name");
    expect(plainAsset.needsReview).toBe(true);
  });
});
