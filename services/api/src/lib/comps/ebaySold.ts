import type { ApiHolding } from "../holdings.js";
import type { CompsAdapter, CompsAdapterResult } from "./types.js";

export const EBAY_ASKS_DISABLED_REASON =
  "eBay asks are not a valuation source — PriceCharting guide only";

/**
 * Retired as a pricing adapter. Owner decision 2026-09-14: do not pull
 * eBay Browse asks for LIVE / comps. Sell / Inventory API is unchanged.
 * fetchComps never calls eBay.
 */
function neverMatches(_holding: ApiHolding): boolean {
  return false;
}

async function refuseAsks(_holding: ApiHolding): Promise<CompsAdapterResult> {
  return {
    adapterId: "ebay-sold",
    sales: [],
    emptyReason: EBAY_ASKS_DISABLED_REASON,
  };
}

export const ebaySoldAdapter: CompsAdapter = {
  id: "ebay-sold",
  label: "eBay asks disabled",
  matches: neverMatches,
  fetchComps: refuseAsks,
};
