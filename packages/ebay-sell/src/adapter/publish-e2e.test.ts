import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { createEbayHttpClient } from "./client.js";
import { createInventoryAdapter } from "./inventory.js";
import { buildListingDraftPayload } from "../listing-builder.js";
import type { MarketplaceListing, SellingAssetInput } from "../schemas.js";

/**
 * End-to-end publish against a local server that enforces the documented
 * Inventory API contract: POST-only location create, 204 empty-body success,
 * warehouse address rules, and an offer entity that cannot be created twice.
 * A wrong verb or an unrecognised field is answered exactly the way eBay
 * answers it — a contentless `#2004 Invalid request` — so a regression here
 * reproduces the Sandbox failure instead of hiding behind a lenient mock.
 */

type Call = { method: string; path: string; status: number };

const ALLOWED_LOCATION_FIELDS = new Set([
  "location",
  "locationAdditionalInformation",
  "locationInstructions",
  "locationTypes",
  "locationWebUrl",
  "merchantLocationStatus",
  "name",
  "operatingHours",
  "phone",
  "specialHours",
  "timeZoneId",
]);

const ALLOWED_ADDRESS_FIELDS = new Set([
  "addressLine1",
  "addressLine2",
  "city",
  "country",
  "county",
  "postalCode",
  "stateOrProvince",
]);

/**
 * Leaf categories in this fake's tree. eBay accepts an offer under any
 * category and only refuses at publish, which is why the operator ended up
 * with a created offer and no listing.
 */
const LEAF_CATEGORIES = new Set(["259104", "259105", "121889", "261328", "183454"]);

function notALeafCategory() {
  return {
    status: 400,
    body: {
      errors: [
        {
          errorId: 25005,
          domain: "API_INVENTORY",
          subdomain: "Selling",
          category: "Request",
          message:
            "The eBay listing associated with the inventory item, or the unpublished offer has an invalid category ID. The category selected is not a leaf category.",
        },
      ],
    },
  };
}

function invalidRequest() {
  return {
    status: 400,
    body: {
      errors: [
        {
          errorId: 2004,
          domain: "ACCESS",
          category: "REQUEST",
          message: "Invalid request",
          longMessage: "The request has errors. For help, see the documentation for this API.",
        },
      ],
    },
  };
}

class FakeEbay {
  readonly calls: Call[] = [];
  locations = new Map<string, Record<string, unknown>>();
  offers = new Map<
    string,
    { offerId: string; sku: string; marketplaceId: string; listingId: string | null; categoryId: string | null }
  >();
  items = new Map<string, unknown>();
  private nextOffer = 1;
  private nextListing = 1;

  handle(method: string, path: string, headers: Record<string, string | string[] | undefined>, raw: string) {
    const result = this.route(method, path, headers, raw);
    this.calls.push({ method, path, status: result.status });
    return result;
  }

  private route(
    method: string,
    path: string,
    headers: Record<string, string | string[] | undefined>,
    raw: string,
  ): { status: number; body?: unknown } {
    if (!String(headers.authorization ?? "").startsWith("Bearer ")) {
      return { status: 401, body: { errors: [{ errorId: 1001, message: "Invalid access token" }] } };
    }
    if (raw && headers["content-type"] !== "application/json") return invalidRequest();
    const language = headers["accept-language"];
    if (language !== undefined && language !== "en-US") {
      return { status: 400, body: { errors: [{ errorId: 2003, message: "Invalid value for header Accept-Language." }] } };
    }
    const [pathname, query] = path.split("?");
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return invalidRequest();
      }
    }

    const locationMatch = /^\/sell\/inventory\/v1\/location\/([^/]+)$/.exec(pathname);
    if (locationMatch) {
      const key = decodeURIComponent(locationMatch[1]);
      if (method === "GET") {
        const found = this.locations.get(key);
        return found
          ? { status: 200, body: found }
          : { status: 404, body: { errors: [{ errorId: 25804, message: "merchantLocationKey not found." }] } };
      }
      // Only POST creates a location. Any other verb is a gateway-level reject.
      if (method !== "POST") return invalidRequest();
      if (this.locations.has(key)) {
        return {
          status: 400,
          body: { errors: [{ errorId: 25801, message: "A location with that merchant location key already exists." }] },
        };
      }
      const invalid = this.validateLocation(body);
      if (invalid) return invalid;
      this.locations.set(key, { merchantLocationKey: key, merchantLocationStatus: "ENABLED", ...body });
      return { status: 204 };
    }

    if (pathname === "/sell/inventory/v1/location" && method === "GET") {
      return { status: 200, body: { locations: [...this.locations.values()] } };
    }

    const itemMatch = /^\/sell\/inventory\/v1\/inventory_item\/([^/]+)$/.exec(pathname);
    if (itemMatch && method === "PUT") {
      const distributions = (
        (body.availability as Record<string, Record<string, unknown>> | undefined)
          ?.shipToLocationAvailability?.availabilityDistributions as { merchantLocationKey?: string }[] | undefined
      ) ?? [];
      for (const dist of distributions) {
        if (dist.merchantLocationKey && !this.locations.has(dist.merchantLocationKey)) {
          return { status: 400, body: { errors: [{ errorId: 25804, message: "merchantLocationKey not found." }] } };
        }
      }
      this.items.set(decodeURIComponent(itemMatch[1]), body);
      return { status: 204 };
    }

    if (pathname === "/sell/inventory/v1/offer" && method === "GET") {
      const sku = new URLSearchParams(query ?? "").get("sku");
      const offers = [...this.offers.values()]
        .filter((o) => o.sku === sku)
        .map((o) => ({ ...o, listing: o.listingId ? { listingId: o.listingId, listingStatus: "ACTIVE" } : undefined }));
      return { status: 200, body: { offers } };
    }

    if (pathname === "/sell/inventory/v1/offer" && method === "POST") {
      const invalid = this.validateOffer(body);
      if (invalid) return invalid;
      const sku = String(body.sku);
      if ([...this.offers.values()].some((o) => o.sku === sku)) {
        return {
          status: 400,
          body: {
            errors: [{ errorId: 25002, message: "A user error has occurred. The offer entity already exists." }],
          },
        };
      }
      const offerId = `OFFER-${this.nextOffer++}`;
      this.offers.set(offerId, {
        offerId,
        sku,
        marketplaceId: String(body.marketplaceId),
        listingId: null,
        categoryId: body.categoryId == null ? null : String(body.categoryId),
      });
      return { status: 201, body: { offerId } };
    }

    const offerMatch = /^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/.exec(pathname);
    if (offerMatch) {
      const offer = this.offers.get(decodeURIComponent(offerMatch[1]));
      if (!offer) return { status: 404, body: { errors: [{ errorId: 25713, message: "Offer not found." }] } };
      if (offerMatch[2] === "/publish" && method === "POST") {
        if (offer.listingId) {
          return {
            status: 400,
            body: { errors: [{ errorId: 25002, message: "The offer is already published." }] },
          };
        }
        if (!offer.categoryId || !LEAF_CATEGORIES.has(offer.categoryId)) return notALeafCategory();
        offer.listingId = `LST-${this.nextListing++}`;
        return { status: 200, body: { listingId: offer.listingId } };
      }
      if (!offerMatch[2] && method === "PUT") {
        const invalid = this.validateOffer({ ...body, sku: offer.sku });
        if (invalid) return invalid;
        offer.categoryId = body.categoryId == null ? null : String(body.categoryId);
        return { status: 204 };
      }
      if (!offerMatch[2] && method === "GET") {
        return {
          status: 200,
          body: {
            offerId: offer.offerId,
            sku: offer.sku,
            status: offer.listingId ? "PUBLISHED" : "UNPUBLISHED",
            listing: offer.listingId ? { listingId: offer.listingId, listingStatus: "ACTIVE" } : undefined,
          },
        };
      }
    }
    return { status: 404, body: { errors: [{ errorId: 2001, message: `No route for ${method} ${pathname}` }] } };
  }

  private validateLocation(body: Record<string, unknown>) {
    if (Object.keys(body).some((k) => !ALLOWED_LOCATION_FIELDS.has(k))) return invalidRequest();
    const address = (body.location as Record<string, unknown> | undefined)?.address as
      | Record<string, unknown>
      | undefined;
    if (!address) return invalidRequest();
    if (Object.keys(address).some((k) => !ALLOWED_ADDRESS_FIELDS.has(k))) return invalidRequest();
    const hasPostal = Boolean(address.postalCode && address.country);
    const hasRegion = Boolean(address.city && address.stateOrProvince && address.country);
    return hasPostal || hasRegion ? null : invalidRequest();
  }

  private validateOffer(body: Record<string, unknown>) {
    // MAP pricing is restricted; eBay rejects the whole payload if it appears.
    if ("minimumAdvertisedPrice" in body) return invalidRequest();
    const price = (body.pricingSummary as Record<string, Record<string, unknown>> | undefined)?.price;
    if (!price?.value || !String(price.value).trim()) return invalidRequest();
    const policies = body.listingPolicies as Record<string, unknown> | undefined;
    if (!policies?.fulfillmentPolicyId || !policies?.paymentPolicyId || !policies?.returnPolicyId) {
      return invalidRequest();
    }
    if (!body.merchantLocationKey || !this.locations.has(String(body.merchantLocationKey))) {
      return { status: 400, body: { errors: [{ errorId: 25804, message: "merchantLocationKey not found." }] } };
    }
    if (!this.items.has(String(body.sku))) {
      return { status: 400, body: { errors: [{ errorId: 25702, message: "The SKU does not exist." }] } };
    }
    return null;
  }
}

const asset: SellingAssetInput = {
  inventoryId: "h-aou-2a",
  sourceRowId: "clz-1",
  category: "comic",
  year: 2013,
  manufacturer: "Marvel",
  setName: "Age of Ultron",
  playerSubject: "Age of Ultron",
  cardNumber: "2A",
  condition: "NM",
  fmv: {
    low: 11,
    high: 17,
    mid: 14,
    currency: "USD",
    confidence: 0.6,
    evidenceCount: 4,
    source: "test",
    method: "observed",
    verificationStatus: "unverified",
    recencyDays: 12,
  },
  frontImageUri: "https://img.example/aou-front.jpg",
  ownershipBucket: "personal",
  rookieFlag: false,
  autographFlag: false,
  relicFlag: false,
  salesPathState: "available",
  quantity: 1,
  playerTier: "unknown",
  parallelScarce: false,
  strongPlayerDemand: false,
  strongSearchability: false,
  saleVelocity: "unknown",
  marketTrend: "unknown",
  pcThesis: false,
  holdThesis: false,
  gradeThesis: false,
  relatedLotCount: 0,
};

const payload = buildListingDraftPayload({ ...asset, sku: "IQV-COMIC-5AF9385B" });

const listing: MarketplaceListing = {
  id: "44444444-4444-4444-8444-444444444444",
  inventoryId: asset.inventoryId,
  marketplace: "ebay",
  sku: payload.sku,
  listingKind: "single",
  externalOfferId: null,
  externalListingId: null,
  listingFormat: "FIXED_PRICE",
  status: "APPROVED",
  title: payload.title,
  categoryId: payload.categoryId,
  price: payload.recommendedListPrice,
  minimumOfferPrice: payload.minimumAcceptablePrice,
  quantity: 1,
  currency: "USD",
  paymentPolicyId: "PAY-1",
  returnPolicyId: "RET-1",
  fulfillmentPolicyId: "FUL-1",
  merchantLocationKey: "home",
  promoted: false,
  fmvAtListing: asset.fmv,
  listedAt: null,
  endedAt: null,
  lastSyncedAt: null,
  idempotencyKey: `${asset.inventoryId}:ebay:single`,
  createdAt: new Date("2026-09-09T00:00:00Z"),
  updatedAt: new Date("2026-09-09T00:00:00Z"),
  provenance: markInferred({ source: "test", ruleOrModelVersion: "t@1" }),
};

const policies = {
  paymentPolicyId: "PAY-1",
  returnPolicyId: "RET-1",
  fulfillmentPolicyId: "FUL-1",
  merchantLocationKey: "home",
};

const sandboxAddress = {
  addressLine1: "625 6th Ave",
  city: "New York",
  stateOrProvince: "NY",
  postalCode: "10011",
  country: "US",
};

let server: Server;
let origin: string;
let ebay: FakeEbay;

beforeAll(async () => {
  ebay = new FakeEbay();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const result = ebay.handle(
        req.method ?? "GET",
        req.url ?? "/",
        req.headers as Record<string, string | string[] | undefined>,
        Buffer.concat(chunks).toString("utf8"),
      );
      if (result.body === undefined) {
        res.writeHead(result.status).end();
        return;
      }
      res.writeHead(result.status, { "Content-Type": "application/json" }).end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Real fetch, real HTTP — only the eBay origin is swapped for the local server. */
function adapter() {
  return createInventoryAdapter(
    createEbayHttpClient({
      env: "sandbox",
      accessToken: "user-token",
      marketplaceId: "EBAY_US",
      fetchImpl: (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return fetch(url.replace("https://api.sandbox.ebay.com", origin), init);
      },
    }),
  );
}

describe("publish against a contract-enforcing eBay", () => {
  it("bootstraps the location, creates the item and offer, and publishes", async () => {
    const result = await adapter().publishListing({
      listing,
      payload,
      policies,
      ensureLocation: sandboxAddress,
    });
    expect(result.errorMessage).toBeNull();
    expect(result.status).toBe("PUBLISHED");
    expect(result.externalOfferId).toBe("OFFER-1");
    expect(result.externalListingId).toBe("LST-1");
    expect(ebay.locations.get("home")).toMatchObject({ merchantLocationStatus: "ENABLED" });

    const created = ebay.calls.filter((c) => c.path.startsWith("/sell/inventory/v1/location/home") && c.method !== "GET");
    expect(created).toEqual([{ method: "POST", path: "/sell/inventory/v1/location/home", status: 204 }]);
  });

  it("recovers when a previous run left an offer behind before the id was persisted", async () => {
    // Same listing row as the first publish, but with the ids lost.
    const result = await adapter().publishListing({ listing, payload, policies, ensureLocation: sandboxAddress });
    expect(result.status).toBe("PUBLISHED");
    expect(result.externalOfferId).toBe("OFFER-1");
    expect(result.externalListingId).toBe("LST-1");
    expect(ebay.offers.size).toBe(1);
    expect(ebay.calls.filter((c) => c.path.endsWith("/publish") && c.status === 200)).toHaveLength(1);
  });

  it("republishes nothing and reports the listing id on a plain retry", async () => {
    const result = await adapter().publishListing({
      listing: { ...listing, externalOfferId: "OFFER-1", externalListingId: "LST-1" },
      payload,
      policies,
      ensureLocation: sandboxAddress,
    });
    expect(result.status).toBe("PUBLISHED");
    expect(ebay.offers.size).toBe(1);
  });

  it("reproduces #25005 when the offer carries a parent category", async () => {
    // Category 63 is what shipped before, and what real Sandbox refused. The
    // offer is still created, so the failure looks like a stuck draft.
    const result = await adapter().publishListing({
      listing: { ...listing, sku: "IQV-COMIC-PARENTCAT" },
      payload: { ...payload, sku: "IQV-COMIC-PARENTCAT", categoryId: "63" },
      policies,
      ensureLocation: sandboxAddress,
    });
    expect(result.status).toBe("EBAY_OFFER_CREATED");
    expect(result.externalListingId).toBeNull();
    expect(result.errorMessage).toMatch(/#25005/);
    expect(result.errorMessage).toMatch(/not a leaf category/);
  });

  it("publishes the same holding once the category is a leaf, reusing the stuck offer", async () => {
    const stuck = [...ebay.offers.values()].find((o) => o.sku === "IQV-COMIC-PARENTCAT");
    expect(stuck?.categoryId).toBe("63");
    const offersBefore = ebay.offers.size;

    const result = await adapter().publishListing({
      listing: { ...listing, sku: "IQV-COMIC-PARENTCAT", externalOfferId: stuck!.offerId },
      payload: { ...payload, sku: "IQV-COMIC-PARENTCAT" },
      policies,
      ensureLocation: sandboxAddress,
    });

    expect(result.status).toBe("PUBLISHED");
    // The stuck offer is updated in place, so a retry cannot strand a
    // duplicate listing on the operator's account.
    expect(result.externalOfferId).toBe(stuck!.offerId);
    expect(ebay.offers.size).toBe(offersBefore);
    expect(ebay.offers.get(stuck!.offerId)?.categoryId).toBe("259104");
  });

  it("surfaces eBay's own message when the location cannot be created", async () => {
    const result = await adapter().publishListing({
      listing,
      payload,
      policies: { ...policies, merchantLocationKey: "nowhere" },
      ensureLocation: { ...sandboxAddress, city: "", stateOrProvince: "", postalCode: "", country: "" },
    });
    expect(result.status).toBe("EBAY_ITEM_CREATED");
    expect(result.errorMessage).toMatch(/Create location nowhere/);
    expect(result.errorMessage).toMatch(/#2004/);
    expect(ebay.locations.has("nowhere")).toBe(false);
  });
});
