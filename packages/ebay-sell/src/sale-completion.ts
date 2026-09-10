import { randomUUID } from "node:crypto";
import { markObserved } from "@vip/evidence";
import { SALE_COMPLETION_RULE } from "./constants.js";
import { fmvErrorPct } from "./fmv.js";
import { roundMoney } from "./pricing.js";
import type { MarketObservation, SaleCompletionInput, SaleCompletionResult } from "./schemas.js";
import { SaleCompletionInputSchema } from "./schemas.js";

export function daysToSale(listedAt: Date | null, soldAt: Date): number | null {
  if (!listedAt) return null;
  const ms = soldAt.getTime() - listedAt.getTime();
  if (ms < 0) return null;
  return Number((ms / 86_400_000).toFixed(2));
}

export function completeSale(raw: SaleCompletionInput): SaleCompletionResult {
  const input = SaleCompletionInputSchema.parse(raw);
  if (input.listing.status === "SOLD") {
    throw new Error(`Listing ${input.listing.id} is already SOLD — refuse duplicate sale`);
  }
  if (input.sku !== input.listing.sku) {
    throw new Error("Order SKU does not match listing SKU");
  }
  const fmvAtListing = input.listing.fmvAtListing;
  const fee = input.feeAllocated ?? null;
  const ship = input.shippingAllocated ?? 0;
  const netProceeds =
    fee == null ? null : roundMoney(input.actualSalePrice + ship - fee);
  const dts = daysToSale(input.listing.listedAt, input.soldAt);
  const observation: MarketObservation = {
    id: randomUUID(),
    inventoryId: input.inventoryId,
    observationType: "INTERNAL_SALE",
    observedAt: input.soldAt,
    value: input.actualSalePrice,
    currency: input.currency,
    source: "ebay_order",
    marketplaceListingId: input.listing.id,
    confidence: 0.95,
    metadata: {
      sku: input.sku,
      externalOrderId: input.externalOrderId,
      externalLineItemId: input.externalLineItemId,
      fmvAtListing,
      fmvErrorPct: fmvErrorPct(input.actualSalePrice, fmvAtListing),
      daysToSale: dts,
      feeIsEstimate: input.feeIsEstimate,
    },
    provenance: markObserved({
      source: "ebay_order",
      ruleOrModelVersion: SALE_COMPLETION_RULE,
      confidence: 0.95,
      notes: "Internal completed checkout · FMV snapshot preserved at listing time",
    }),
  };
  return {
    inventoryId: input.inventoryId,
    sku: input.sku,
    salesPathState: "sold",
    listingStatus: "SOLD",
    actualSalePrice: input.actualSalePrice,
    fmvAtListing,
    fmvErrorPct: fmvErrorPct(input.actualSalePrice, fmvAtListing),
    daysToSale: dts,
    netProceeds,
    feeIsEstimate: input.feeIsEstimate,
    observation,
  };
}

export function preserveFmvSnapshot<T extends { fmvAtListing: unknown }>(
  listing: T,
  _laterFmv: unknown,
): T["fmvAtListing"] {
  return listing.fmvAtListing;
}
