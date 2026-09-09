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

  it("refreshes a stored refresh token before publish", async () => {
    const keys = [
      "EBAY_APP_ID",
      "EBAY_CERT_ID",
      "EBAY_REDIRECT_URI",
      "EBAY_PAYMENT_POLICY_ID",
      "EBAY_RETURN_POLICY_ID",
      "EBAY_FULFILLMENT_POLICY_ID",
      "EBAY_MERCHANT_LOCATION_KEY",
    ] as const;
    const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.EBAY_APP_ID = "app";
    process.env.EBAY_CERT_ID = "cert";
    process.env.EBAY_REDIRECT_URI = "https://example.test/ru";
    process.env.EBAY_PAYMENT_POLICY_ID = "pay";
    process.env.EBAY_RETURN_POLICY_ID = "ret";
    process.env.EBAY_FULFILLMENT_POLICY_ID = "ful";
    process.env.EBAY_MERCHANT_LOCATION_KEY = "home";
    try {
      const store = createMemoryEbaySellStore();
      await store.saveToken({
        accessToken: "",
        refreshToken: "refresh-1",
        expiresAt: new Date(0),
        scopes: [],
      });
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "live-access", refresh_token: "refresh-1", expires_in: 7200 }),
            { status: 200 },
          );
        }
        if (url.includes("/inventory_item/")) return new Response(null, { status: 204 });
        if (url.includes("/sell/inventory/v1/location/")) {
          return new Response(JSON.stringify({ merchantLocationKey: "home", merchantLocationStatus: "ENABLED" }), {
            status: 200,
          });
        }
        if (url.includes("/offer/") && url.endsWith("/publish")) {
          return new Response(JSON.stringify({ listingId: "LST-LIVE" }), { status: 200 });
        }
        if (url.includes("/sell/inventory/v1/offer") && (init?.method === "POST" || init?.method === "PUT")) {
          return new Response(JSON.stringify({ offerId: "OFF-LIVE" }), { status: 201 });
        }
        return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
      };
      const service = createEbaySellService({
        store,
        fetchImpl,
        autoPublishHighValue: true,
        highValueUsd: 50,
      });
      const card = holding();
      const { listing } = await service.draftFromHolding(card);
      const published = await service.approveAndPublish(card, listing.id);
      expect(published.published).toBe(true);
      expect(published.listing?.externalOfferId).toBe("OFF-LIVE");
      expect(published.listing?.externalListingId).toBe("LST-LIVE");
    } finally {
      for (const k of keys) {
        if (prior[k] == null) delete process.env[k];
        else process.env[k] = prior[k];
      }
    }
  });

  it("reports a preflight without touching eBay state", async () => {
    const keys = [
      "EBAY_APP_ID",
      "EBAY_CERT_ID",
      "EBAY_REDIRECT_URI",
      "EBAY_PAYMENT_POLICY_ID",
      "EBAY_RETURN_POLICY_ID",
      "EBAY_FULFILLMENT_POLICY_ID",
      "EBAY_MERCHANT_LOCATION_KEY",
    ] as const;
    const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.EBAY_APP_ID = "app";
    process.env.EBAY_CERT_ID = "cert";
    process.env.EBAY_REDIRECT_URI = "https://example.test/ru";
    process.env.EBAY_PAYMENT_POLICY_ID = "pay";
    process.env.EBAY_RETURN_POLICY_ID = "ret";
    process.env.EBAY_FULFILLMENT_POLICY_ID = "ful";
    process.env.EBAY_MERCHANT_LOCATION_KEY = "home";
    try {
      const store = createMemoryEbaySellStore();
      await store.saveToken({
        accessToken: "live-access",
        refreshToken: "refresh-1",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory"],
      });
      const methods: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        methods.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "app-token", expires_in: 7200 }), { status: 200 });
        }
        if (url.includes("/privilege")) {
          return new Response(JSON.stringify({ sellerRegistrationCompleted: true }), { status: 200 });
        }
        if (url.includes("/sell/inventory/v1/location/home")) {
          return new Response(JSON.stringify({ merchantLocationStatus: "ENABLED" }), { status: 200 });
        }
        if (url.includes("/return_policy")) {
          return new Response(JSON.stringify({ returnPolicies: [{ returnPolicyId: "OTHER", name: "30 day" }] }), {
            status: 200,
          });
        }
        if (url.includes("/payment_policy")) {
          return new Response(JSON.stringify({ paymentPolicies: [{ paymentPolicyId: "pay", name: "Pay" }] }), {
            status: 200,
          });
        }
        if (url.includes("/fulfillment_policy")) {
          return new Response(
            JSON.stringify({ fulfillmentPolicies: [{ fulfillmentPolicyId: "ful", name: "Ship" }] }),
            { status: 200 },
          );
        }
        if (url.includes("get_default_category_tree_id")) {
          return new Response(JSON.stringify({ categoryTreeId: "0" }), { status: 200 });
        }
        if (url.includes("get_item_aspects_for_category")) {
          return new Response(JSON.stringify({ aspects: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ errors: [{ message: `unmocked ${url}` }] }), { status: 404 });
      };
      const service = createEbaySellService({ store, fetchImpl });
      const card = holding();
      await service.draftFromHolding(card);
      const report = await service.preflight([card]);

      expect(report.ok).toBe(false);
      expect(report.checks.find((c) => c.id === "return-policy")?.detail).toMatch(/OTHER \(30 day\)/);
      expect(report.checks.find((c) => c.id === "payment-policy")?.status).toBe("pass");
      expect(report.checks.find((c) => c.id === "location")?.status).toBe("pass");
      expect(report.checks.find((c) => c.id === "draft")?.detail).toMatch(/Mahomes/);
      // Only the OAuth token mint may be a POST — every Sell call must be a read.
      const writes = methods.filter((m) => !m.startsWith("GET ") && !m.includes("/oauth2/token"));
      expect(writes).toEqual([]);
    } finally {
      for (const k of keys) {
        if (prior[k] == null) delete process.env[k];
        else process.env[k] = prior[k];
      }
    }
  });
});
