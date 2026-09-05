import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { createEbayHttpClient } from "./client.js";
import { createInventoryAdapter } from "./inventory.js";
import type { ListingDraftPayload, MarketplaceListing } from "../schemas.js";

const payload: ListingDraftPayload = {
  sku: "IQV-SPORTS-AAAAAAAA",
  title: "2018 Prizm Patrick Mahomes #207",
  description: "Exact identity.",
  categoryId: "212",
  format: "FIXED_PRICE",
  condition: "USED_VERY_GOOD",
  imageUrls: ["https://img.example/front.jpg"],
  aspects: { Player: ["Patrick Mahomes"] },
  marketplaceId: "EBAY_US",
  quantity: 1,
  recommendedListPrice: 29.99,
  minimumAcceptablePrice: 24.99,
  currency: "USD",
  publishBlockedReasons: [],
};

const listing: MarketplaceListing = {
  id: "33333333-3333-4333-8333-333333333333",
  inventoryId: "h1",
  marketplace: "ebay",
  sku: payload.sku,
  listingKind: "single",
  externalOfferId: null,
  externalListingId: null,
  listingFormat: "FIXED_PRICE",
  status: "APPROVED",
  title: payload.title,
  categoryId: "212",
  price: 29.99,
  minimumOfferPrice: 24.99,
  quantity: 1,
  currency: "USD",
  paymentPolicyId: "pay",
  returnPolicyId: "ret",
  fulfillmentPolicyId: "ful",
  merchantLocationKey: "home",
  promoted: false,
  fmvAtListing: null,
  listedAt: null,
  endedAt: null,
  lastSyncedAt: null,
  idempotencyKey: "h1:ebay:single",
  createdAt: new Date(),
  updatedAt: new Date(),
  provenance: markInferred({ source: "test", ruleOrModelVersion: "t@1" }),
};

const policies = {
  paymentPolicyId: "pay",
  returnPolicyId: "ret",
  fulfillmentPolicyId: "ful",
  merchantLocationKey: "home",
};

describe("Inventory API adapter", () => {
  it("creates item + offer + publish and is idempotent on retry", async () => {
    const paths: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      paths.push(`${init?.method} ${url}`);
      if (url.includes("/inventory_item/")) return new Response("{}", { status: 204 });
      if (url.endsWith("/offer") && init?.method === "POST") {
        return new Response(JSON.stringify({ offerId: "OFFER-1" }), { status: 201 });
      }
      if (url.includes("/offer/OFFER-1/publish")) {
        return new Response(JSON.stringify({ listingId: "LST-1" }), { status: 200 });
      }
      if (url.includes("/offer/OFFER-1")) return new Response("{}", { status: 200 });
      return new Response("no", { status: 404 });
    };
    const client = createEbayHttpClient({
      env: "sandbox",
      accessToken: "tok",
      fetchImpl,
    });
    const adapter = createInventoryAdapter(client);
    const first = await adapter.publishListing({ listing, payload, policies });
    expect(first.status).toBe("PUBLISHED");
    expect(first.externalOfferId).toBe("OFFER-1");
    expect(first.externalListingId).toBe("LST-1");

    const second = await adapter.publishListing({
      listing: { ...listing, externalOfferId: "OFFER-1", externalListingId: "LST-1" },
      payload,
      policies,
    });
    expect(second.externalListingId).toBe("LST-1");
    expect(paths.filter((p) => p.includes("/publish")).length).toBe(1);
  });

  it("does not publish when required fields are missing", async () => {
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async () => new Response("should-not-run", { status: 500 }),
      }),
    );
    const result = await adapter.publishListing({
      listing,
      payload: { ...payload, publishBlockedReasons: ["IMAGE_REQUIRED"] },
      policies,
    });
    expect(result.status).toBe("ERROR");
    expect(result.errorClass).toBe("non_retryable");
  });
});
