import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { completeSale, daysToSale, preserveFmvSnapshot } from "./sale-completion.js";
import { fmvErrorPct } from "./fmv.js";
import type { FmvSnapshot, MarketplaceListing } from "./schemas.js";

const fmv: FmvSnapshot = {
  low: 8,
  high: 12,
  mid: 10,
  currency: "USD",
  confidence: 0.5,
  evidenceCount: 4,
  source: "ebay_browse",
  method: "inferred",
  verificationStatus: "unverified",
  recencyDays: 3,
};

function listing(over: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    inventoryId: "h1",
    marketplace: "ebay",
    sku: "IQV-SPORTS-AAAAAAAA",
    listingKind: "single",
    externalOfferId: "off-1",
    externalListingId: "lst-1",
    listingFormat: "FIXED_PRICE",
    status: "ACTIVE",
    title: "Card",
    categoryId: "212",
    price: 11,
    minimumOfferPrice: 9,
    quantity: 1,
    currency: "USD",
    paymentPolicyId: "p",
    returnPolicyId: "r",
    fulfillmentPolicyId: "f",
    merchantLocationKey: "home",
    promoted: false,
    fmvAtListing: fmv,
    listedAt: new Date("2026-09-01T00:00:00Z"),
    endedAt: null,
    lastSyncedAt: null,
    idempotencyKey: "h1:ebay:single",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    provenance: markInferred({ source: "test", ruleOrModelVersion: "t@1" }),
    ...over,
  };
}

describe("sale completion", () => {
  it("preserves listing-time FMV and computes error + days-to-sale", () => {
    const laterFmv = { ...fmv, mid: 99, low: 90, high: 110 };
    const listed = listing();
    expect(preserveFmvSnapshot(listed, laterFmv)).toEqual(fmv);
    const soldAt = new Date("2026-09-11T00:00:00Z");
    const result = completeSale({
      inventoryId: "h1",
      sku: "IQV-SPORTS-AAAAAAAA",
      listing: listed,
      actualSalePrice: 12,
      soldAt,
      feeAllocated: 1.6,
      shippingAllocated: 0,
      feeIsEstimate: true,
      currency: "USD",
      externalOrderId: "ord-1",
      externalLineItemId: "line-1",
    });
    expect(result.fmvAtListing).toEqual(fmv);
    expect(result.fmvErrorPct).toBeCloseTo(0.2, 5);
    expect(fmvErrorPct(12, fmv)).toBeCloseTo(0.2, 5);
    expect(result.daysToSale).toBe(10);
    expect(daysToSale(listed.listedAt, soldAt)).toBe(10);
    expect(result.observation.observationType).toBe("INTERNAL_SALE");
    expect(result.listingStatus).toBe("SOLD");
    expect(result.feeIsEstimate).toBe(true);
  });

  it("refuses a duplicate sale on an already-sold listing", () => {
    expect(() =>
      completeSale({
        inventoryId: "h1",
        sku: "IQV-SPORTS-AAAAAAAA",
        listing: listing({ status: "SOLD" }),
        actualSalePrice: 12,
        soldAt: new Date(),
        currency: "USD",
        externalOrderId: "ord-2",
        externalLineItemId: "line-2",
      }),
    ).toThrow(/already SOLD/);
  });
});
