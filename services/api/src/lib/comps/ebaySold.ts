import type { ApiHolding } from "../holdings.js";
import { resolveEbayAccessToken } from "./ebayAuth.js";
import {
  COMIC_BROWSE_RULE,
  buildComicBrowseQuery,
  comicBrowseConfidence,
  listingTitleMatchesComic,
} from "./comicBrowseMatch.js";
import type { CompSale, CompsAdapter, CompsAdapterResult } from "./types.js";

const RULE = COMIC_BROWSE_RULE;
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

/**
 * eBay sold / completed listings for comics (Decision D).
 *
 * Auth: `EBAY_APP_ID` + `EBAY_CERT_ID` (client credentials, public
 * `api_scope`, or `EBAY_OAUTH_SCOPE`) or a ready `EBAY_OAUTH_TOKEN`.
 * Without credentials the adapter returns zero sales with an explicit
 * reason — it never invents comps.
 *
 * Comics query is series + issue number (no publisher, no volume suffix),
 * scoped to category 63, then title-filtered to that book. Sports still use
 * asset name. Results stay unverified Browse asks, never a sold ledger.
 */
function isSports(holding: ApiHolding): boolean {
  if (holding.provenance.source === "ricoh_fi8170") return true;
  if (holding.externalIds?.some((e) => e.source === "sports_parsed" || e.source === "cardladder")) {
    return true;
  }
  return /scan intake \(sports\)/i.test(holding.publisher);
}

function buildQuery(holding: ApiHolding): string {
  if (isSports(holding)) {
    return [holding.assetName, holding.series, holding.issue].filter(Boolean).join(" ").trim();
  }
  return buildComicBrowseQuery({ series: holding.series, issue: holding.issue })?.q ?? "";
}

function isPricedByBrowse(holding: ApiHolding): boolean {
  if (holding.id.startsWith("binder-slot-")) return false;
  if (holding.externalIds?.some((e) => e.source === "pokemontcg")) return false;
  if (isSports(holding)) return true;
  if (holding.provenance.source === "clz_import") return true;
  return Boolean(holding.series && holding.publisher);
}

async function fetchSold(holding: ApiHolding): Promise<CompsAdapterResult> {
  const auth = await resolveEbayAccessToken();
  if ("error" in auth) {
    return {
      adapterId: "ebay-sold",
      sales: [],
      emptyReason: auth.error,
    };
  }
  const token = auth.token;

  const comicQuery = isSports(holding)
    ? null
    : buildComicBrowseQuery({ series: holding.series, issue: holding.issue });
  const q = isSports(holding) ? buildQuery(holding) : (comicQuery?.q ?? "");
  if (!q) {
    return { adapterId: "ebay-sold", sales: [], emptyReason: "holding lacks series/issue for query" };
  }

  const params = new URLSearchParams({
    q,
    limit: "20",
    // Prefer sold/completed when the marketplace supports the filter.
    filter: "conditions:{USED|NEW},buyingOptions:{FIXED_PRICE|AUCTION}",
    sort: "price",
  });
  if (comicQuery) params.set("category_ids", comicQuery.categoryIds);

  let res: Response;
  try {
    res = await fetch(`${BROWSE_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
    });
  } catch (e) {
    return {
      adapterId: "ebay-sold",
      sales: [],
      emptyReason: `eBay request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const rawJson = await res.text();
  if (!res.ok) {
    return {
      adapterId: "ebay-sold",
      sales: [],
      emptyReason: `eBay HTTP ${res.status}`,
      rawJson,
      requestUrl: `${BROWSE_URL}?${params}`,
    };
  }

  let body: {
    itemSummaries?: {
      itemId?: string;
      title?: string;
      price?: { value?: string; currency?: string };
      itemWebUrl?: string;
      itemCreationDate?: string;
      itemEndDate?: string;
    }[];
  };
  try {
    body = JSON.parse(rawJson) as typeof body;
  } catch {
    return {
      adapterId: "ebay-sold",
      sales: [],
      emptyReason: "eBay Browse response was not JSON",
      rawJson,
      requestUrl: `${BROWSE_URL}?${params}`,
    };
  }

  const sales: CompSale[] = [];
  for (const item of body.itemSummaries ?? []) {
    const price = Number(item.price?.value);
    if (!Number.isFinite(price) || price <= 0) continue;
    const when = item.itemEndDate || item.itemCreationDate;
    if (!when) continue;
    if (comicQuery && !listingTitleMatchesComic(item.title, comicQuery)) continue;
    const listingId = item.itemId ?? `${holding.id}:${price}:${when}`;
    sales.push({
      id: `ebay:${listingId}`,
      listingId,
      price,
      saleDate: new Date(when),
      source: "ebay.com/sold",
      title: item.title,
      url: item.itemWebUrl,
      provenance: {
        method: "api",
        ruleOrModelVersion: RULE,
        // Browse search is not a sold-ledger guarantee without the sold filter
        // succeeding — keep unverified until a sold-only endpoint is wired.
        verificationStatus: "unverified",
        confidence: comicQuery && item.title ? comicBrowseConfidence(item.title, comicQuery) : 0.55,
        notes: comicQuery
          ? "eBay Browse listing · title matched series+issue · unverified ask, not a sold ledger row"
          : "eBay Browse item summary · treat as market observation until sold-ledger confirmed",
      },
    });
  }

  return {
    adapterId: "ebay-sold",
    sales,
    emptyReason: sales.length
      ? undefined
      : (body.itemSummaries?.length
          ? `eBay returned ${body.itemSummaries.length} listing(s) for “${q}” but none matched this book`
          : `no eBay items matched “${q}”`),
    rawJson,
    requestUrl: `${BROWSE_URL}?${params}`,
  };
}

export const ebaySoldAdapter: CompsAdapter = {
  id: "ebay-sold",
  label: "eBay Browse listings · unverified",
  matches: isPricedByBrowse,
  fetchComps: fetchSold,
};
