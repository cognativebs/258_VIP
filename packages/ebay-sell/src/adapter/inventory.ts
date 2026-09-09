import type { BusinessPolicies, EbayApiResult, ListingDraftPayload, MarketplaceListing } from "../schemas.js";
import type { EbayHttpClient } from "./client.js";

export type InventoryLocationAddress = {
  addressLine1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
};

export type PublishListingInput = {
  listing: MarketplaceListing;
  payload: ListingDraftPayload;
  policies: BusinessPolicies;
  /** When set, a missing merchant location is created (Sandbox bootstrap). */
  ensureLocation?: InventoryLocationAddress | null;
};

export type PublishListingResult = {
  status: MarketplaceListing["status"];
  externalOfferId: string | null;
  externalListingId: string | null;
  errorClass: "retryable" | "non_retryable" | null;
  errorMessage: string | null;
};

/**
 * Official Inventory API flow: inventory item → offer → publish.
 * Reuses existing offer/listing IDs so a retry cannot create a duplicate.
 */
export function createInventoryAdapter(client: EbayHttpClient) {
  return {
    async createOrReplaceInventoryItem(payload: ListingDraftPayload, merchantLocationKey?: string) {
      return client.request({
        method: "PUT",
        path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(payload.sku)}`,
        idempotencyKey: `item:${payload.sku}`,
        body: {
          product: {
            title: payload.title,
            description: payload.description,
            aspects: payload.aspects,
            imageUrls: payload.imageUrls,
          },
          condition: payload.condition,
          availability: {
            shipToLocationAvailability: {
              quantity: payload.quantity,
              ...(merchantLocationKey
                ? {
                    availabilityDistributions: [
                      { merchantLocationKey, quantity: payload.quantity },
                    ],
                  }
                : {}),
            },
          },
        },
      });
    },

    async getInventoryLocation(merchantLocationKey: string) {
      return client.request({
        method: "GET",
        path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
        idempotencyKey: `get-location:${merchantLocationKey}`,
      });
    },

    async listInventoryLocations() {
      return client.request({
        method: "GET",
        path: "/sell/inventory/v1/location?limit=50",
        idempotencyKey: "list-locations",
      });
    },

    /**
     * eBay documents createInventoryLocation as POST /location/{key} and answers
     * 204 No Content on success. PUT is only tried when eBay rejects the method
     * itself, because a wrong verb comes back as a contentless `#2004 Invalid
     * request` that reads like a payload problem.
     */
    async createInventoryLocation(merchantLocationKey: string, address: InventoryLocationAddress) {
      const path = `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`;
      const attempts: string[] = [];
      let last: EbayApiResult = {
        ok: false,
        status: 0,
        errorClass: "non_retryable",
        errorMessage: "location create not sent",
      };
      for (const [i, body] of warehouseLocationBodies(address).entries()) {
        for (const method of ["POST", "PUT"] as const) {
          const res = await client.request({
            method,
            path,
            idempotencyKey: `create-location:${merchantLocationKey}:${i}:${method.toLowerCase()}`,
            body,
          });
          if (res.ok || isAlreadyExists(res)) return { ...res, ok: true };
          attempts.push(`${method} shape${i + 1} HTTP ${res.status}: ${res.errorMessage ?? "no detail"}`);
          last = res;
          if (!isMethodRejected(res)) break;
        }
      }
      return { ...last, errorMessage: attempts.join(" · ") || last.errorMessage };
    },

    async getInventoryItem(sku: string) {
      return client.request({
        method: "GET",
        path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        idempotencyKey: `get-item:${sku}`,
      });
    },

    async createOffer(payload: ListingDraftPayload, policies: BusinessPolicies, existingOfferId?: string | null) {
      if (existingOfferId) {
        return client.request({
          method: "PUT",
          path: `/sell/inventory/v1/offer/${encodeURIComponent(existingOfferId)}`,
          idempotencyKey: `offer:${payload.sku}`,
          body: offerBody(payload, policies),
        });
      }
      return client.request({
        method: "POST",
        path: "/sell/inventory/v1/offer",
        idempotencyKey: `offer:${payload.sku}`,
        body: offerBody(payload, policies),
      });
    },

    /** Look up offers eBay already holds for a SKU so a retry reuses them. */
    async getOffersBySku(sku: string, marketplaceId?: string) {
      const query = new URLSearchParams({ sku });
      if (marketplaceId) query.set("marketplace_id", marketplaceId);
      return client.request({
        method: "GET",
        path: `/sell/inventory/v1/offer?${query.toString()}`,
        idempotencyKey: `get-offers:${sku}`,
      });
    },

    async publishOffer(offerId: string) {
      return client.request({
        method: "POST",
        path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
        idempotencyKey: `publish:${offerId}`,
      });
    },

    async withdrawOffer(offerId: string) {
      return client.request({
        method: "POST",
        path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`,
        idempotencyKey: `withdraw:${offerId}`,
      });
    },

    async getOffer(offerId: string) {
      return client.request({
        method: "GET",
        path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
        idempotencyKey: `get-offer:${offerId}`,
      });
    },

    async publishListing(input: PublishListingInput): Promise<PublishListingResult> {
      if (input.payload.publishBlockedReasons.length) {
        return {
          status: "ERROR",
          externalOfferId: input.listing.externalOfferId,
          externalListingId: input.listing.externalListingId,
          errorClass: "non_retryable",
          errorMessage: input.payload.publishBlockedReasons.join(", "),
        };
      }
      let locationKey = input.policies.merchantLocationKey;
      let location = await this.getInventoryLocation(locationKey);
      if (!location.ok && input.ensureLocation) {
        let created = await this.createInventoryLocation(locationKey, input.ensureLocation);
        if (!created.ok && locationKey === "home") {
          const fallbackKey = "iqv_home";
          created = await this.createInventoryLocation(fallbackKey, input.ensureLocation);
          if (created.ok) locationKey = fallbackKey;
        }
        if (!created.ok) {
          return {
            status: "EBAY_ITEM_CREATED",
            externalOfferId: input.listing.externalOfferId,
            externalListingId: input.listing.externalListingId,
            errorClass: created.errorClass,
            errorMessage: `Create location ${locationKey}: ${created.errorMessage ?? "Invalid request"}`,
          };
        }
        location = await this.getInventoryLocation(locationKey);
      }
      if (!location.ok) {
        const listed = await this.listInventoryLocations();
        const existing = locationKeysFromList(listed.body);
        return {
          status: "EBAY_ITEM_CREATED",
          externalOfferId: input.listing.externalOfferId,
          externalListingId: input.listing.externalListingId,
          errorClass: location.errorClass,
          errorMessage: existing.length
            ? `Get location ${locationKey}: not found. Existing Inventory locations: ${existing.join(", ")}. Set EBAY_MERCHANT_LOCATION_KEY to one of those.`
            : `Get location ${locationKey}: ${location.errorMessage ?? "not found"}`,
        };
      }
      const locationStatus = readString(location.body, "merchantLocationStatus");
      if (locationStatus && locationStatus !== "ENABLED") {
        return {
          status: "EBAY_ITEM_CREATED",
          externalOfferId: input.listing.externalOfferId,
          externalListingId: input.listing.externalListingId,
          errorClass: "non_retryable",
          errorMessage: `eBay inventory location "${locationKey}" is ${locationStatus}, not ENABLED.`,
        };
      }
      const policies = { ...input.policies, merchantLocationKey: locationKey };
      const item = await this.createOrReplaceInventoryItem(input.payload, locationKey);
      if (!item.ok) {
        return fail(input.listing, item.errorClass, `Inventory item: ${item.errorMessage}`);
      }
      let offerId = input.listing.externalOfferId ?? null;
      let knownListingId = input.listing.externalListingId ?? null;
      const offer = await this.createOffer(input.payload, policies, offerId);
      if (offer.ok) {
        offerId = readString(offer.body, "offerId") ?? offerId;
      } else {
        // An earlier attempt can leave an offer behind before we persist its id.
        // Adopt it instead of retrying a create eBay will always reject.
        const existing = offerForSku(
          (await this.getOffersBySku(input.payload.sku, input.payload.marketplaceId)).body,
          input.payload.marketplaceId,
        );
        if (!existing) {
          return {
            status: "EBAY_ITEM_CREATED",
            externalOfferId: offerId,
            externalListingId: knownListingId,
            errorClass: offer.errorClass,
            errorMessage: `${offerId ? "Update" : "Create"} offer: ${offer.errorMessage}`,
          };
        }
        offerId = existing.offerId;
        knownListingId = existing.listingId ?? knownListingId;
        if (!knownListingId) {
          const adopted = await this.createOffer(input.payload, policies, offerId);
          if (!adopted.ok) {
            return {
              status: "EBAY_OFFER_CREATED",
              externalOfferId: offerId,
              externalListingId: null,
              errorClass: adopted.errorClass,
              errorMessage: `Update offer ${offerId}: ${adopted.errorMessage}`,
            };
          }
        }
      }
      if (!offerId) {
        return {
          status: "EBAY_ITEM_CREATED",
          externalOfferId: null,
          externalListingId: null,
          errorClass: "non_retryable",
          errorMessage: "Offer created but eBay returned no offerId",
        };
      }
      if (knownListingId) {
        return {
          status: "PUBLISHED",
          externalOfferId: offerId,
          externalListingId: knownListingId,
          errorClass: null,
          errorMessage: null,
        };
      }
      const published = await this.publishOffer(offerId);
      if (!published.ok) {
        // Publish is not idempotent on eBay's side: a second call on a live
        // offer errors. Ask for the offer before calling this a failure.
        const current = await this.getOffer(offerId);
        const settled = current.ok ? listingIdFromOffer(current.body) : null;
        if (settled) {
          return {
            status: "PUBLISHED",
            externalOfferId: offerId,
            externalListingId: settled,
            errorClass: null,
            errorMessage: null,
          };
        }
        return {
          status: "EBAY_OFFER_CREATED",
          externalOfferId: offerId,
          externalListingId: null,
          errorClass: published.errorClass,
          errorMessage: `Publish offer: ${published.errorMessage}`,
        };
      }
      return {
        status: "PUBLISHED",
        externalOfferId: offerId,
        externalListingId: readString(published.body, "listingId"),
        errorClass: null,
        errorMessage: null,
      };
    },
  };
}

/**
 * A warehouse location needs either postalCode + country or city +
 * stateOrProvince + country. The street line is accepted but optional, so the
 * full address is tried first and the region-only shape is the fallback.
 */
function warehouseLocationBodies(address: InventoryLocationAddress) {
  const region = {
    city: address.city,
    stateOrProvince: address.stateOrProvince,
    postalCode: address.postalCode,
    country: address.country,
  };
  return [
    {
      name: "IQVault Warehouse",
      locationTypes: ["WAREHOUSE"],
      location: { address: { addressLine1: address.addressLine1, ...region } },
    },
    {
      name: "IQVault Warehouse",
      locationTypes: ["WAREHOUSE"],
      location: { address: region },
    },
  ];
}

function isAlreadyExists(res: EbayApiResult): boolean {
  return res.status === 409 || /already exist/i.test(res.errorMessage ?? "");
}

function isMethodRejected(res: EbayApiResult): boolean {
  return res.status === 404 || res.status === 405;
}

function offerForSku(
  body: unknown,
  marketplaceId: string,
): { offerId: string; listingId: string | null } | null {
  const rows = asRecord(body)?.offers;
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((row) => {
    const rowMarketplace = readString(row, "marketplaceId");
    return !rowMarketplace || rowMarketplace === marketplaceId;
  });
  for (const row of matches) {
    const offerId = readString(row, "offerId");
    if (!offerId) continue;
    return { offerId, listingId: listingIdFromOffer(row) };
  }
  return null;
}

function offerBody(payload: ListingDraftPayload, policies: BusinessPolicies) {
  return {
    sku: payload.sku,
    marketplaceId: payload.marketplaceId,
    format: payload.format,
    availableQuantity: payload.quantity,
    categoryId: payload.categoryId,
    listingDescription: payload.description,
    listingDuration: "GTC",
    includeCatalogProductDetails: false,
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    merchantLocationKey: policies.merchantLocationKey,
    pricingSummary: {
      price: {
        value: String(payload.recommendedListPrice ?? ""),
        currency: payload.currency,
      },
    },
  };
}

function readString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function locationKeysFromList(body: unknown): string[] {
  const rec = asRecord(body);
  const rows = rec?.locations;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => readString(row, "merchantLocationKey"))
    .filter((key): key is string => Boolean(key));
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

/** Map GET /offer to our listing status. Never invent SOLD from an unpublished offer. */
export function listingStatusFromOffer(
  body: unknown,
  current: MarketplaceListing["status"],
): MarketplaceListing["status"] {
  if (current === "SOLD") return "SOLD";
  const root = asRecord(body);
  const listing = asRecord(root?.listing);
  const offerStatus = (readString(body, "status") ?? "").toUpperCase();
  const listingStatus = ((listing ? readString(listing, "listingStatus") : null) ?? "").toUpperCase();
  if (listingStatus === "ENDED") return "ENDED";
  if (offerStatus === "PUBLISHED" && listingStatus === "ACTIVE") return "ACTIVE";
  if (offerStatus === "PUBLISHED") return "PUBLISHED";
  if (offerStatus === "UNPUBLISHED" && (current === "PUBLISHED" || current === "ACTIVE")) {
    return "ENDED";
  }
  return current;
}

export function listingIdFromOffer(body: unknown): string | null {
  const listing = asRecord(asRecord(body)?.listing);
  return (listing && readString(listing, "listingId")) || readString(body, "listingId");
}

function fail(
  listing: MarketplaceListing,
  errorClass: PublishListingResult["errorClass"],
  errorMessage: string | null,
): PublishListingResult {
  return {
    status: "ERROR",
    externalOfferId: listing.externalOfferId,
    externalListingId: listing.externalListingId,
    errorClass,
    errorMessage,
  };
}
