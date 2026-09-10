import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { createApp } from "../app.js";
import { createEbaySellService } from "../lib/ebaySell/service.js";
import { createMemoryEbaySellStore } from "../lib/ebaySell/store.js";
import { mapInventoryRow } from "../lib/holdings.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarketplaceListing } from "@vip/ebay-sell";

const here = dirname(fileURLToPath(import.meta.url));

function fixtureHoldings() {
  const rows = JSON.parse(
    readFileSync(join(here, "..", "seeds", "inventory-sample.json"), "utf8"),
  ) as Record<string, unknown>[];
  return rows.slice(0, 8).map(mapInventoryRow);
}

async function withSellServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const holdings = fixtureHoldings();
  const app = createApp({
    loadComics: async () => ({
      available: true,
      holdings,
      snapshot: null,
      error: null,
      dsn: "fixture",
    }),
    loadScanHoldings: async () => [],
    ebaySellService: createEbaySellService({ store: createMemoryEbaySellStore() }),
  });
  const server = app.listen(0);
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("eBay sell routes", () => {
  it("reports idle sell health and a dashboard without faking a connection", async () => {
    await withSellServer(async (base) => {
      const health = await fetch(`${base}/api/ebay/sell/health`);
      const body = (await health.json()) as {
        status: { connected: boolean; mode: string };
        canPublish: boolean;
      };
      expect(health.status).toBe(200);
      expect(body.status.connected).toBe(false);
      expect(body.canPublish).toBe(false);

      const dash = await fetch(`${base}/api/ebay/sell/dashboard`);
      const dashBody = (await dash.json()) as { connection: { canPublish: boolean }; cards: { activeListings: number } };
      expect(dash.status).toBe(200);
      expect(dashBody.connection.canPublish).toBe(false);
      expect(dashBody.cards.activeListings).toBe(0);
    });
  });

  it("creates a reviewable draft from a real fixture holding", async () => {
    await withSellServer(async (base) => {
      const inv = await fetch(`${base}/api/inventory`);
      const invBody = (await inv.json()) as { holdings: { id: string }[] };
      const id = invBody.holdings[0]?.id;
      expect(id).toBeTruthy();
      const draft = await fetch(`${base}/api/ebay/sell/item/${id}/draft`, { method: "POST" });
      const body = (await draft.json()) as {
        listing: { status: string; sku: string };
        payload: { publishBlockedReasons: string[] };
      };
      expect(draft.status).toBe(200);
      expect(body.listing.status).toBe("READY_FOR_REVIEW");
      expect(body.listing.sku.startsWith("IQV-")).toBe(true);

      const item = await fetch(`${base}/api/ebay/sell/item/${id}`);
      const detail = (await item.json()) as { holding: { ebaySku: string | null }; asset: { sku?: string } };
      expect(detail.holding.ebaySku).toBe(body.listing.sku);
      expect(detail.asset.sku).toBe(body.listing.sku);
    });
  });

  it("ingests an order by SKU, marks the holding sold, and keeps listing-sync idle without OAuth", async () => {
    await withSellServer(async (base) => {
      const inv = await fetch(`${base}/api/inventory`);
      const invBody = (await inv.json()) as { holdings: { id: string }[] };
      const id = invBody.holdings[0]?.id;
      const draft = await fetch(`${base}/api/ebay/sell/item/${id}/draft`, { method: "POST" });
      const drafted = (await draft.json()) as { listing: { sku: string } };
      const sku = drafted.listing.sku;

      const ingest = await fetch(`${base}/api/ebay/sell/orders/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: [
            {
              orderId: "ORD-TEST-1",
              creationDate: "2026-09-06T12:00:00.000Z",
              orderFulfillmentStatus: "NOT_STARTED",
              pricingSummary: { total: { currency: "USD" } },
              buyer: { username: "sandbox-buyer" },
              lineItems: [
                {
                  sku,
                  lineItemId: "LI-1",
                  quantity: 1,
                  lineItemCost: { value: "12.00" },
                },
              ],
            },
          ],
        }),
      });
      const ingested = (await ingest.json()) as {
        ingested: number;
        completions: { salesPathState: string; listingStatus: string }[];
      };
      expect(ingest.status).toBe(200);
      expect(ingested.ingested).toBe(1);
      expect(ingested.completions[0]?.salesPathState).toBe("sold");

      const item = await fetch(`${base}/api/ebay/sell/item/${id}`);
      const detail = (await item.json()) as {
        holding: { ebaySku: string | null; salesPathState: string; soldAt: string | null };
        listings: { status: string }[];
        observations: { observationType: string }[];
        disposition: { disposition: string; reasonCodes: string[] };
      };
      expect(detail.holding.ebaySku).toBe(sku);
      expect(detail.holding.salesPathState).toBe("sold");
      expect(detail.holding.soldAt).toBeTruthy();
      expect(detail.listings[0]?.status).toBe("SOLD");
      expect(detail.observations.some((o) => o.observationType === "INTERNAL_SALE")).toBe(true);
      expect(detail.disposition.disposition).toBe("HOLD");
      expect(detail.disposition.reasonCodes).toContain("ALREADY_SOLD");

      const sync = await fetch(`${base}/api/ebay/sell/jobs/listing-sync`, { method: "POST" });
      const syncBody = (await sync.json()) as { ok: boolean; synced: number; reason?: string };
      expect(sync.status).toBe(200);
      expect(syncBody.ok).toBe(false);
      expect(syncBody.synced).toBe(0);
      expect(syncBody.reason).toMatch(/idle/i);
    });
  });

  it("walks GET offer when Sell OAuth and policies are present", async () => {
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
    process.env.EBAY_MERCHANT_LOCATION_KEY = "loc";
    try {
      const store = createMemoryEbaySellStore();
      await store.saveToken({
        accessToken: "tok",
        refreshToken: "ref",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: [],
      });
      const listing: MarketplaceListing = {
        id: "33333333-3333-4333-8333-333333333333",
        inventoryId: "h1",
        marketplace: "ebay",
        sku: "IQV-COMIC-TEST",
        listingKind: "single",
        externalOfferId: "OFF-1",
        externalListingId: null,
        listingFormat: "FIXED_PRICE",
        status: "PUBLISHED",
        title: "Test",
        categoryId: "63",
        price: 12,
        minimumOfferPrice: 10,
        quantity: 1,
        currency: "USD",
        paymentPolicyId: "pay",
        returnPolicyId: "ret",
        fulfillmentPolicyId: "ful",
        merchantLocationKey: "loc",
        promoted: false,
        fmvAtListing: null,
        listedAt: new Date("2026-09-01T00:00:00.000Z"),
        endedAt: null,
        lastSyncedAt: null,
        idempotencyKey: "h1:ebay:single",
        createdAt: new Date(),
        updatedAt: new Date(),
        provenance: markInferred({ source: "test", ruleOrModelVersion: "t@1" }),
      };
      await store.upsertListing(listing);
      const service = createEbaySellService({
        store,
        fetchImpl: async (input) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/offer/OFF-1")) {
            return new Response(
              JSON.stringify({
                status: "PUBLISHED",
                listing: { listingId: "LST-SYNC", listingStatus: "ACTIVE" },
              }),
              { status: 200 },
            );
          }
          return new Response("unmocked", { status: 404 });
        },
      });
      const result = await service.syncListingStates();
      expect(result.ok).toBe(true);
      expect(result.synced).toBe(1);
      const next = await store.getListing(listing.id);
      expect(next?.status).toBe("ACTIVE");
      expect(next?.externalListingId).toBe("LST-SYNC");
      expect(next?.lastSyncedAt).toBeTruthy();
    } finally {
      for (const k of keys) {
        if (prior[k] == null) delete process.env[k];
        else process.env[k] = prior[k];
      }
    }
  });
});
