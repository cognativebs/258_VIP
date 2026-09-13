import { describe, expect, it } from "vitest";
import { applyVendorRematch, decideVendorMatch, normalizeVendorName } from "./vendor-match.js";

const unit = {
  candidatePricedUnitId: "11111111-1111-1111-1111-111111111111",
  candidateAssetId: "22222222-2222-2222-2222-222222222222",
};

describe("decideVendorMatch", () => {
  it("prefers UPC and auto-confirms at 0.98", () => {
    const d = decideVendorMatch({
      upcExact: true,
      nameSetExact: true,
      trgmSimilarity: 0.99,
      ...unit,
    });
    expect(d.matchMethod).toBe("upc");
    expect(d.matchConfidence).toBe(0.98);
    expect(d.needsReview).toBe(false);
  });

  it("uses exact name+set at 0.90 when UPC misses", () => {
    const d = decideVendorMatch({
      upcExact: false,
      nameSetExact: true,
      trgmSimilarity: 0.99,
      ...unit,
    });
    expect(d.matchMethod).toBe("exact_name");
    expect(d.matchConfidence).toBe(0.9);
    expect(d.needsReview).toBe(false);
  });

  it("queues trgm ≥ 0.82 for review and never auto-confirms", () => {
    const d = decideVendorMatch({
      upcExact: false,
      nameSetExact: false,
      trgmSimilarity: 0.82,
      ...unit,
    });
    expect(d.matchMethod).toBe("trgm");
    expect(d.needsReview).toBe(true);
    expect(d.matchConfidence).toBe(0.82);
  });

  it("leaves unmatched below the trgm floor with no unit attached", () => {
    const d = decideVendorMatch({
      upcExact: false,
      nameSetExact: false,
      trgmSimilarity: 0.81,
      ...unit,
    });
    expect(d.matchMethod).toBe("unmatched");
    expect(d.needsReview).toBe(true);
    expect(d.pricedUnitId).toBeNull();
    expect(d.assetId).toBeNull();
  });
});

describe("applyVendorRematch", () => {
  it("touches only lastSeenAt on a confirmed row", () => {
    const seen = new Date("2026-09-14T00:00:00Z");
    const next = applyVendorRematch(
      {
        confirmedAt: new Date("2026-09-13T00:00:00Z"),
        lastSeenAt: new Date("2026-09-13T00:00:00Z"),
        pricedUnitId: unit.candidatePricedUnitId,
        assetId: unit.candidateAssetId,
        matchMethod: "upc" as const,
        matchConfidence: 0.98,
        needsReview: false,
      },
      decideVendorMatch({
        upcExact: false,
        nameSetExact: false,
        trgmSimilarity: 0.99,
        ...unit,
      }),
      seen,
    );
    expect(next.lastSeenAt).toEqual(seen);
    expect(next.matchMethod).toBe("upc");
    expect(next.needsReview).toBe(false);
  });

  it("never auto-clears needs_review on an unconfirmed rematch", () => {
    const seen = new Date("2026-09-14T00:00:00Z");
    const next = applyVendorRematch(
      {
        confirmedAt: null,
        lastSeenAt: new Date("2026-09-13T00:00:00Z"),
        pricedUnitId: null,
        assetId: null,
        matchMethod: "unmatched" as const,
        matchConfidence: null,
        needsReview: true,
      },
      decideVendorMatch({
        upcExact: true,
        nameSetExact: false,
        trgmSimilarity: null,
        ...unit,
      }),
      seen,
    );
    expect(next.matchMethod).toBe("upc");
    expect(next.needsReview).toBe(true);
  });
});

describe("normalizeVendorName", () => {
  it("strips volume suffixes so Action Comics Vol. 1 matches the vendor title", () => {
    expect(normalizeVendorName("Action Comics, Vol. 1 #900")).toBe("action comics #900");
  });
});
