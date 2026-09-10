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
    // eBay documents createInventoryLocation as POST. A PUT first would waste a
    // round trip and answer with a contentless "Invalid request".
    expect(paths.some((p) => p === `POST https://api.sandbox.ebay.com/sell/inventory/v1/location/home`)).toBe(true);
    expect(paths.some((p) => p.startsWith("PUT ") && p.includes("/location/home"))).toBe(false);
  });

  it("treats an already-existing location as created", async () => {
    let created = 0;
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/location/home") && (init?.method ?? "GET") === "GET") {
            return created
              ? new Response(JSON.stringify({ merchantLocationStatus: "ENABLED" }), { status: 200 })
              : new Response(JSON.stringify({ errors: [{ message: "not found" }] }), { status: 404 });
          }
          if (url.includes("/location/home")) {
            created += 1;
            return new Response(
              JSON.stringify({ errors: [{ errorId: 25801, message: "A location with that key already exists." }] }),
              { status: 400 },
            );
          }
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
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
    expect(created).toBe(1);
  });

  it("reports every location create attempt when eBay rejects them all", async () => {
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/location") && (init?.method ?? "GET") === "GET") {
            return new Response(JSON.stringify({ errors: [{ message: "not found" }] }), { status: 404 });
          }
          return new Response(
            JSON.stringify({ errors: [{ errorId: 2004, message: "Invalid request" }] }),
            { status: 400 },
          );
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
    expect(result.errorMessage).toMatch(/POST shape1/);
    expect(result.errorMessage).toMatch(/POST shape2/);
  });

  it("adopts the offer eBay already holds for the SKU when create is rejected", async () => {
    const paths: string[] = [];
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const method = init?.method ?? "GET";
          paths.push(`${method} ${url}`);
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
          if (url.includes("/location/")) {
            return new Response(JSON.stringify({ merchantLocationStatus: "ENABLED" }), { status: 200 });
          }
          if (url.includes("/offer/OFFER-7/publish")) {
            return new Response(JSON.stringify({ listingId: "LST-7" }), { status: 200 });
          }
          if (url.includes("/offer/OFFER-7") && method === "PUT") {
            return new Response(null, { status: 204 });
          }
          if (url.includes("sku=") && method === "GET") {
            return new Response(
              JSON.stringify({ offers: [{ offerId: "OFFER-7", sku: payload.sku, marketplaceId: "EBAY_US" }] }),
              { status: 200 },
            );
          }
          if (url.endsWith("/sell/inventory/v1/offer") && method === "POST") {
            return new Response(
              JSON.stringify({
                errors: [{ errorId: 25002, message: "A user error has occurred. The offer entity already exists." }],
              }),
              { status: 400 },
            );
          }
          return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
        },
      }),
    );
    const result = await adapter.publishListing({ listing, payload, policies });
    expect(result.status).toBe("PUBLISHED");
    expect(result.externalOfferId).toBe("OFFER-7");
    expect(result.externalListingId).toBe("LST-7");
    expect(paths.some((p) => p.startsWith("PUT ") && p.includes("/offer/OFFER-7"))).toBe(true);
  });

  it("reads back the listing id when publish reports an already-published offer", async () => {
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const method = init?.method ?? "GET";
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
          if (url.includes("/location/")) {
            return new Response(JSON.stringify({ merchantLocationStatus: "ENABLED" }), { status: 200 });
          }
          if (url.endsWith("/publish")) {
            return new Response(
              JSON.stringify({ errors: [{ errorId: 25002, message: "The offer is already published." }] }),
              { status: 400 },
            );
          }
          if (url.includes("/offer/OFFER-1") && method === "GET") {
            return new Response(
              JSON.stringify({ status: "PUBLISHED", listing: { listingId: "LST-3", listingStatus: "ACTIVE" } }),
              { status: 200 },
            );
          }
          if (url.endsWith("/sell/inventory/v1/offer") && method === "POST") {
            return new Response(JSON.stringify({ offerId: "OFFER-1" }), { status: 201 });
          }
          return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
        },
      }),
    );
    const result = await adapter.publishListing({ listing, payload, policies });
    expect(result.status).toBe("PUBLISHED");
    expect(result.externalListingId).toBe("LST-3");
    expect(result.errorMessage).toBeNull();
  });

  it("does not publish a stale offer when the update is rejected", async () => {
    const adapter = createInventoryAdapter(
      createEbayHttpClient({
        env: "sandbox",
        accessToken: "tok",
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const method = init?.method ?? "GET";
          if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
          if (url.includes("/location/")) {
            return new Response(JSON.stringify({ merchantLocationStatus: "ENABLED" }), { status: 200 });
          }
          if (url.includes("sku=") && method === "GET") {
            return new Response(JSON.stringify({ offers: [] }), { status: 200 });
          }
          if (url.includes("/offer/OFFER-9") && method === "PUT") {
            return new Response(
              JSON.stringify({ errors: [{ errorId: 25019, message: "The price is not allowed." }] }),
              { status: 400 },
            );
          }
          return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
        },
      }),
    );
    const result = await adapter.publishListing({
      listing: { ...listing, externalOfferId: "OFFER-9" },
      payload,
      policies,
    });
    expect(result.status).toBe("EBAY_ITEM_CREATED");
    expect(result.errorMessage).toMatch(/Update offer: .*price is not allowed/i);
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
