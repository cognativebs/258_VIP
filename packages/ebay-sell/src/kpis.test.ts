import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { computeEbayKpis } from "./kpis.js";
import type { MarketplaceListing } from "./schemas.js";

function listing(over: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    inventoryId: "h1",
    marketplace: "ebay",
    sku: "IQV-COMIC-AAAAAAAA",
    listingKind: "single",
    externalOfferId: "o",
    externalListingId: "l",
    listingFormat: "FIXED_PRICE",
    status: "SOLD",
    title: "Book",
    categoryId: "63",
    price: 12,
    minimumOfferPrice: 10,
    quantity: 1,
    currency: "USD",
    paymentPolicyId: "p",
    returnPolicyId: "r",
    fulfillmentPolicyId: "f",
    merchantLocationKey: "home",
    promoted: false,
    fmvAtListing: null,
    listedAt: new Date("2026-09-01"),
    endedAt: new Date("2026-09-05"),
    lastSyncedAt: null,
    idempotencyKey: "h1:ebay:single",
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-05"),
    provenance: markInferred({ source: "t", ruleOrModelVersion: "t@1" }),
    ...over,
  };
}

describe("eBay KPIs", () => {
  it("labels net as estimate and computes days-to-sale", () => {
    const kpis = computeEbayKpis({
      listings: [listing()],
      orders: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          marketplace: "ebay",
          externalOrderId: "ORD",
          orderCreatedAt: new Date("2026-09-05"),
          orderStatus: "FULFILLED",
          buyerReference: null,
          grossTotal: 12,
          shippingCollected: 4,
          taxAmount: 0,
          currency: "USD",
          fulfillmentStatus: "FULFILLED",
          shippedAt: null,
          deliveredAt: null,
          lastSyncedAt: null,
        },
      ],
      lines: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          marketplaceOrderId: "66666666-6666-4666-8666-666666666666",
          inventoryId: "h1",
          sku: "IQV-COMIC-AAAAAAAA",
          externalLineItemId: "LINE",
          quantity: 1,
          salePrice: 12,
          shippingAllocated: 4,
          feeAllocated: 1.6,
          promotionFeeAllocated: null,
          netProceeds: 10.4,
          feeIsEstimate: true,
        },
      ],
      metrics: [],
      unlistedSellable: 10,
    });
    expect(kpis.sales.netIsEstimate).toBe(true);
    expect(kpis.funnel.daysToSaleAvg).toBe(4);
    expect(kpis.economics.feesAreEstimates).toBe(true);
  });
});
