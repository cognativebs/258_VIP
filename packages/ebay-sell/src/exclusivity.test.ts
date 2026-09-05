import { describe, expect, it } from "vitest";
import { assertListingExclusivity, canEnterLot } from "./exclusivity.js";
import type { MarketplaceListing } from "./schemas.js";
import { markInferred } from "@vip/evidence";

function listing(over: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    price: 9.99,
    minimumOfferPrice: 8,
    quantity: 1,
    currency: "USD",
    paymentPolicyId: "p",
    returnPolicyId: "r",
    fulfillmentPolicyId: "f",
    merchantLocationKey: "home",
    promoted: false,
    fmvAtListing: null,
    listedAt: new Date("2026-09-01"),
    endedAt: null,
    lastSyncedAt: null,
    idempotencyKey: "h1:ebay:single",
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    provenance: markInferred({ source: "test", ruleOrModelVersion: "t@1" }),
    ...over,
  };
}

describe("lot / listing exclusivity", () => {
  it("blocks a second active single listing for qty 1", () => {
    expect(() =>
      assertListingExclusivity({
        inventoryId: "h1",
        quantity: 1,
        salesPathState: "listed_single",
        existingListings: [listing()],
        lotMemberships: [],
        next: { kind: "single" },
      }),
    ).toThrow(/already has an active single listing/);
  });

  it("blocks a single listing while the card sits in an active lot", () => {
    expect(() =>
      assertListingExclusivity({
        inventoryId: "h1",
        quantity: 1,
        salesPathState: "listed_lot",
        existingListings: [],
        lotMemberships: [{ lotId: "lot-1", inventoryId: "h1", lotStatus: "active" }],
        next: { kind: "single" },
      }),
    ).toThrow(/active lot/);
  });

  it("keeps exact membership exclusive across lots and excludes PC/HOLD/GRADE", () => {
    expect(canEnterLot("PC")).toBe(false);
    expect(canEnterLot("HOLD")).toBe(false);
    expect(canEnterLot("GRADE")).toBe(false);
    expect(canEnterLot("SINGLE")).toBe(true);
    expect(() =>
      assertListingExclusivity({
        inventoryId: "h1",
        quantity: 1,
        salesPathState: "available",
        existingListings: [],
        lotMemberships: [{ lotId: "lot-1", inventoryId: "h1", lotStatus: "accepted" }],
        next: { kind: "lot", lotId: "lot-2" },
      }),
    ).toThrow(/already belongs to lot/);
  });
});
