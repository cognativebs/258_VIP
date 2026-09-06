import { describe, expect, it } from "vitest";
import { markObserved } from "@vip/evidence";
import { createEbaySellService } from "./service.js";
import { createMemoryEbaySellStore } from "./store.js";
import type { ApiHolding } from "../holdings.js";

function holding(over: Partial<ApiHolding> = {}): ApiHolding {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    holdingUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    assetName: "2018 Prizm Patrick Mahomes #207",
    series: "Prizm",
    issue: "207",
    publisher: "Panini",
    quantity: 1,
    pillar: "General Inventory",
    inventoryBucket: "dealer_inventory",
    inventoryBucketAssignment: "inferred",
    museumScore: 20,
    investmentScore: 40,
    liquidityScore: 80,
    recommendationLabel: "Sell Duplicate",
    sellPriority: "High",
    needsGrading: false,
    needsPhoto: false,
    needsVerification: false,
    verificationNotes: null,
    currentPrice: 4.5,
    liveLow: 3.5,
    liveHigh: 5.5,
    liveListingCount: 6,
    assumedGrade: "NM",
    gradeRating: null,
    coverImageUrl: "https://img.example/front.jpg",
    frontImageUri: "https://img.example/front.jpg",
    backImageUri: "https://img.example/back.jpg",
    cardName: "Patrick Mahomes",
    playerSubject: "Patrick Mahomes",
    setName: "Prizm",
    year: 2018,
    cardNumber: "207",
    categoryKind: "sports",
    rarity: null,
    externalIds: [],
    provenance: markObserved({ source: "test", ruleOrModelVersion: "t@1", confidence: 0.8 }),
    ...over,
  };
}

describe("eBay sell service", () => {
  it("drafts a payload, refuses duplicate publish, and completes a sale into an observation", async () => {
    const store = createMemoryEbaySellStore();
    const service = createEbaySellService({ store, autoPublishHighValue: false, highValueUsd: 50 });
    const card = holding();
    const rec = await service.recommendFor(card);
    expect(["SINGLE", "LOT"]).toContain(rec.disposition);

    const { listing, payload } = await service.draftFromHolding(card);
    expect(payload.sku.startsWith("IQV-SPORTS-")).toBe(true);
    expect(listing.status).toBe("READY_FOR_REVIEW");
    expect(listing.fmvAtListing?.mid).toBe(4.5);
    expect(payload.publishBlockedReasons).toEqual([]);

    const published = await service.approveAndPublish(card, listing.id);
    expect(published.published).toBe(false);
    expect(published.listing?.status).toBe("APPROVED");
    expect(published.listing?.errorMessage ?? "").toMatch(/Cannot publish|USER_OAUTH|APP_CREDENTIALS/);

    const again = await service.draftFromHolding(card);
    expect(again.listing.id).toBe(listing.id);

    const ingested = await service.ingestOrderLines([card], {
      orders: [
        {
          orderId: "ORD-9",
          creationDate: "2026-09-05T00:00:00.000Z",
          orderFulfillmentStatus: "NOT_STARTED",
          lineItems: [
            {
              lineItemId: "LINE-9",
              sku: listing.sku,
              quantity: 1,
              lineItemCost: { value: "6.00", currency: "USD" },
            },
          ],
        },
      ],
    });
    expect(ingested.ingested).toBe(1);
    expect(ingested.completions[0]?.listingStatus).toBe("SOLD");
    expect(ingested.completions[0]?.fmvAtListing?.mid).toBe(4.5);
    expect(ingested.completions[0]?.observation.observationType).toBe("INTERNAL_SALE");
    const afterSale = await service.itemDetail([card], card.id);
    expect(afterSale?.holding.ebaySku).toBe(listing.sku);
    expect(afterSale?.holding.salesPathState).toBe("sold");
    expect(afterSale?.holding.soldAt).toBeTruthy();
    expect(afterSale?.disposition.reasonCodes).toContain("ALREADY_SOLD");

    const dup = await service.ingestOrderLines([card], {
      orders: [
        {
          orderId: "ORD-9",
          creationDate: "2026-09-05T00:00:00.000Z",
          lineItems: [
            {
              lineItemId: "LINE-9",
              sku: listing.sku,
              quantity: 1,
              lineItemCost: { value: "6.00" },
            },
          ],
        },
      ],
    });
    expect(dup.skipped).toBe(1);
    expect(dup.ingested).toBe(0);
  });

  it("builds a ranked queue and logs operator overrides", async () => {
    const store = createMemoryEbaySellStore();
    const service = createEbaySellService({ store });
    const items = await service.rebuildQueue([
      holding(),
      holding({
        id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        holdingUuid: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        inventoryBucket: "personal_collection",
      }),
    ]);
    expect(items.some((i) => i.inventoryId.includes("bbbbbbbb"))).toBe(false);
    expect(items.length).toBeGreaterThan(0);
    const acted = await service.actOnQueue(
      [holding()],
      items[0]!.id,
      "hold",
      "Operator parked this for a week",
      "HOLD",
    );
    expect(acted.item.operatorAction).toBe("hold");
  });
});
