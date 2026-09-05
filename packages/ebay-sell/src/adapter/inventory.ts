import type { BusinessPolicies, ListingDraftPayload, MarketplaceListing } from "../schemas.js";
import type { EbayHttpClient } from "./client.js";

export type PublishListingInput = {
  listing: MarketplaceListing;
  payload: ListingDraftPayload;
  policies: BusinessPolicies;
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
    async createOrReplaceInventoryItem(payload: ListingDraftPayload) {
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
            shipToLocationAvailability: { quantity: payload.quantity },
          },
        },
      });
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
      const item = await this.createOrReplaceInventoryItem(input.payload);
      if (!item.ok) {
        return fail(input.listing, item.errorClass, item.errorMessage, "EBAY_ITEM_CREATED");
      }
      const offer = await this.createOffer(
        input.payload,
        input.policies,
        input.listing.externalOfferId,
      );
      const offerId =
        input.listing.externalOfferId ??
        readString(offer.body, "offerId") ??
        readString(offer.body, "offerId");
      if (!offer.ok && !offerId) {
        return {
          status: "EBAY_ITEM_CREATED",
          externalOfferId: null,
          externalListingId: input.listing.externalListingId,
          errorClass: offer.errorClass,
          errorMessage: offer.errorMessage,
        };
      }
      const resolvedOfferId = offerId ?? input.listing.externalOfferId;
      if (!resolvedOfferId) {
        return {
          status: "EBAY_ITEM_CREATED",
          externalOfferId: null,
          externalListingId: null,
          errorClass: "non_retryable",
          errorMessage: "Offer created but eBay returned no offerId",
        };
      }
      if (input.listing.externalListingId) {
        return {
          status: "PUBLISHED",
          externalOfferId: resolvedOfferId,
          externalListingId: input.listing.externalListingId,
          errorClass: null,
          errorMessage: null,
        };
      }
      const published = await this.publishOffer(resolvedOfferId);
      const listingId = readString(published.body, "listingId");
      if (!published.ok) {
        return {
          status: "EBAY_OFFER_CREATED",
          externalOfferId: resolvedOfferId,
          externalListingId: null,
          errorClass: published.errorClass,
          errorMessage: published.errorMessage,
        };
      }
      return {
        status: "PUBLISHED",
        externalOfferId: resolvedOfferId,
        externalListingId: listingId,
        errorClass: null,
        errorMessage: null,
      };
    },
  };
}

function offerBody(payload: ListingDraftPayload, policies: BusinessPolicies) {
  return {
    sku: payload.sku,
    marketplaceId: payload.marketplaceId,
    format: payload.format,
    availableQuantity: payload.quantity,
    categoryId: payload.categoryId,
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
      ...(payload.minimumAcceptablePrice
        ? {
            minimumAdvertisedPrice: {
              value: String(payload.minimumAcceptablePrice),
              currency: payload.currency,
            },
          }
        : {}),
    },
  };
}

function readString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function fail(
  listing: MarketplaceListing,
  errorClass: PublishListingResult["errorClass"],
  errorMessage: string | null,
  _advancedTo: MarketplaceListing["status"],
): PublishListingResult {
  return {
    status: "ERROR",
    externalOfferId: listing.externalOfferId,
    externalListingId: listing.externalListingId,
    errorClass,
    errorMessage,
  };
}
