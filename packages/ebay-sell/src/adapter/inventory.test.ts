import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { createEbayHttpClient } from "./client.js";
import { createInventoryAdapter, listingIdFromOffer, listingStatusFromOffer } from "./inventory.js";
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
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      expect(headers.get("Accept-Language")).toBe("en-US");
      expect(headers.get("X-EBAY-C-MARKETPLACE-ID")).toBe("EBAY_US");
      if (init?.body != null) {
        expect(headers.get("Content-Language")).toBe("en-US");
      }
      paths.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/inventory_item/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          availability?: { shipToLocationAvailability?: { availabilityDistributions?: { merchantLocationKey: string }[] } };
        };
        expect(body.availability?.shipToLocationAvailability?.availabilityDistributions?.[0]?.merchantLocationKey).toBe(
          "home",
        );
        return new Response(null, { status: 204 });
      }
      if (url.includes("/sell/inventory/v1/location/")) {
        return new Response(JSON.stringify({ merchantLocationKey: "home", merchantLocationStatus: "ENABLED" }), {
          status: 200,
        });
      }
      if (url.includes("/offer/") && url.endsWith("/publish")) {
        return new Response(JSON.stringify({ listingId: "LST-1" }), { status: 200 });
      }
      if (url.includes("/sell/inventory/v1/offer") && (init?.method === "POST" || init?.method === "PUT")) {
        return new Response(JSON.stringify({ offerId: "OFFER-1" }), { status: 201 });
      }
      if (url.includes("/offer/OFFER-1")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
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

  it("stops before offer create when the merchant location is missing", async () => {
    const paths: string[] = [];
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          paths.push(`${init?.method ?? "GET"} ${url}`);
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
          if (url.includes("/location/")) {
            return new Response(JSON.stringify({ errors: [{ message: "Location not found" }] }), { status: 404 });
          }
          return new Response("should-not-create-offer", { status: 500 });
        },
      }),
    );
    const result = await adapter.publishListing({ listing, payload, policies });
    expect(result.status).toBe("EBAY_ITEM_CREATED");
    expect(result.errorMessage).toMatch(/Location not found/);
    expect(paths.some((p) => p.includes("/offer"))).toBe(false);
  });

  it("creates a missing Sandbox merchant location then publishes", async () => {
    const paths: string[] = [];
    let locationCreated = false;
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          paths.push(`${init?.method ?? "GET"} ${url}`);
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
          if (url.includes("/location/home") && (init?.method ?? "GET") === "GET") {
            if (!locationCreated) {
              return new Response(JSON.stringify({ errors: [{ message: "merchantLocationKey not found." }] }), {
                status: 404,
              });
            }
            return new Response(JSON.stringify({ merchantLocationKey: "home", merchantLocationStatus: "ENABLED" }), {
              status: 200,
            });
          }
          if (url.includes("/location/home") && (init?.method === "PUT" || init?.method === "POST")) {
            const body = JSON.parse(String(init.body ?? "{}")) as { locationTypes?: string[] };
            expect(body.locationTypes).toEqual(["WAREHOUSE"]);
            locationCreated = true;
            return new Response(null, { status: 204 });
          }
          if (url.includes("/offer/") && url.endsWith("/publish")) {
            return new Response(JSON.stringify({ listingId: "LST-1" }), { status: 200 });
          }
          if (url.includes("/sell/inventory/v1/offer")) {
            return new Response(JSON.stringify({ offerId: "OFFER-1" }), { status: 201 });
          }
          return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
        },
      }),
    );
    const result = await adapter.publishListing({
      listing,
      payload,
      policies,
      ensureLocation: {
        addressLine1: "500 Main Street",
        city: "San Jose",
        stateOrProvince: "CA",
        postalCode: "95131",
        country: "US",
      },
    });
    expect(result.status).toBe("PUBLISHED");
    expect(paths.some((p) => p.startsWith("PUT ") && p.includes("/location/home"))).toBe(true);
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

  it("maps GET offer status without inventing a sale", () => {
    expect(
      listingStatusFromOffer(
        { status: "PUBLISHED", listing: { listingId: "LST-9", listingStatus: "ACTIVE" } },
        "PUBLISHED",
      ),
    ).toBe("ACTIVE");
    expect(listingIdFromOffer({ listing: { listingId: "LST-9" } })).toBe("LST-9");
    expect(listingStatusFromOffer({ status: "UNPUBLISHED" }, "ACTIVE")).toBe("ENDED");
    expect(listingStatusFromOffer({ status: "UNPUBLISHED" }, "SOLD")).toBe("SOLD");
  });
});
