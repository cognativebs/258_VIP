import type { ApiHolding } from "../holdings.js";
import {
  buildComicBrowseQuery,
  listingTitleMatchesComic,
  type ComicBrowseQuery,
} from "./comicBrowseMatch.js";
import type { CompSale, CompsAdapter, CompsAdapterResult } from "./types.js";

export const PRICECHARTING_RULE = "pricecharting-guide@0.1.0";
export const PRICECHARTING_ADAPTER_ID = "pricecharting";
const PRODUCTS_URL = "https://www.pricecharting.com/api/products";
const PRODUCT_URL = "https://www.pricecharting.com/api/product";

/** Official API limit is 1 call / second. */
const MIN_GAP_MS = 1_100;

export function pricechartingToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const canonical = env.PRICECHARTING_API_TOKEN?.trim();
  if (canonical) return canonical;
  const alias = env.PRICECHARTING_TOKEN?.trim();
  return alias || null;
}

function isComicHolding(holding: ApiHolding): boolean {
  if (holding.provenance.source === "ricoh_fi8170") return false;
  if (holding.externalIds?.some((e) => e.source === "pokemontcg")) return false;
  return holding.provenance.source === "clz_import" || Boolean(holding.series && holding.publisher);
}

function penniesToUsd(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n) / 100;
}

type PcProduct = {
  id?: string;
  "product-name"?: string;
  "console-name"?: string;
  genre?: string;
  "loose-price"?: unknown;
};

function isComicCatalogRow(row: PcProduct): boolean {
  return /comic/i.test(String(row["console-name"] ?? "")) || /comic/i.test(String(row.genre ?? ""));
}

function scoreProduct(name: string, query: ComicBrowseQuery): number {
  let score = 1;
  const compact = name.toLowerCase();
  if (/\[[^\]]+\]/.test(name)) score -= 0.2;
  if (query.issue.variant && compact.includes(query.issue.variant.toLowerCase())) score += 0.3;
  if (!query.issue.variant && !/\[[^\]]+\]/.test(name)) score += 0.2;
  return score;
}

export function pickComicProduct(
  products: PcProduct[],
  query: ComicBrowseQuery,
): PcProduct | null {
  const hits = products.filter(
    (p) =>
      p.id &&
      p["product-name"] &&
      isComicCatalogRow(p) &&
      listingTitleMatchesComic(p["product-name"], query),
  );
  if (!hits.length) return null;
  return hits.sort((a, b) => scoreProduct(b["product-name"]!, query) - scoreProduct(a["product-name"]!, query))[0] ?? null;
}

function quotesFromProduct(product: PcProduct, query: ComicBrowseQuery): CompSale[] {
  const id = String(product.id ?? "");
  const title = product["product-name"] ?? query.q;
  const loose = penniesToUsd(product["loose-price"]);
  if (!id || loose == null) return [];
  return [
    {
      id: `pricecharting:${id}:loose`,
      listingId: `pc:${id}:loose`,
      price: loose,
      saleDate: new Date(),
      source: "pricecharting.com/guide",
      title: `${title} · ungraded (loose)`,
      url: `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query.q)}`,
      provenance: {
        method: "api",
        ruleOrModelVersion: PRICECHARTING_RULE,
        verificationStatus: "unverified",
        confidence: 0.6,
        notes:
          "PriceCharting current loose/ungraded guide in pennies→USD · inferred · unverified — not a sold ledger row",
      },
    },
  ];
}

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSold(holding: ApiHolding): Promise<CompsAdapterResult> {
  const token = pricechartingToken();
  if (!token) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: "PRICECHARTING_API_TOKEN (or PRICECHARTING_TOKEN) is not set",
    };
  }
  const query = buildComicBrowseQuery({ series: holding.series, issue: holding.issue });
  if (!query) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: "holding lacks series/issue for a PriceCharting query",
    };
  }

  const searchUrl = `${PRODUCTS_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(query.q)}`;
  let searchRes: Response;
  try {
    searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
    });
  } catch (e) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: `PriceCharting search failed: ${e instanceof Error ? e.message : String(e)}`,
      requestUrl: searchUrl,
    };
  }
  const searchRaw = await searchRes.text();
  if (!searchRes.ok) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: `PriceCharting HTTP ${searchRes.status}`,
      rawJson: searchRaw,
      requestUrl: searchUrl,
    };
  }

  let searchBody: { status?: string; products?: PcProduct[]; "error-message"?: string };
  try {
    searchBody = JSON.parse(searchRaw) as typeof searchBody;
  } catch {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: "PriceCharting search was not JSON",
      rawJson: searchRaw,
      requestUrl: searchUrl,
    };
  }
  if (searchBody.status === "error") {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: searchBody["error-message"] ?? "PriceCharting search error",
      rawJson: searchRaw,
      requestUrl: searchUrl,
    };
  }

  const picked = pickComicProduct(searchBody.products ?? [], query);
  if (!picked?.id) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: `no PriceCharting comic matched “${query.q}”`,
      rawJson: searchRaw,
      requestUrl: searchUrl,
    };
  }

  await pause(Number(process.env.VIP_PRICECHARTING_GAP_MS ?? MIN_GAP_MS));

  const productUrl = `${PRODUCT_URL}?t=${encodeURIComponent(token)}&id=${encodeURIComponent(picked.id)}`;
  let productRes: Response;
  try {
    productRes = await fetch(productUrl, {
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
    });
  } catch (e) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: `PriceCharting product failed: ${e instanceof Error ? e.message : String(e)}`,
      rawJson: searchRaw,
      requestUrl: productUrl,
    };
  }
  const productRaw = await productRes.text();
  if (!productRes.ok) {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: `PriceCharting HTTP ${productRes.status}`,
      rawJson: productRaw,
      requestUrl: productUrl,
    };
  }
  let product: PcProduct & { status?: string; "error-message"?: string };
  try {
    product = JSON.parse(productRaw) as typeof product;
  } catch {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: "PriceCharting product was not JSON",
      rawJson: productRaw,
      requestUrl: productUrl,
    };
  }
  if (product.status === "error") {
    return {
      adapterId: PRICECHARTING_ADAPTER_ID,
      sales: [],
      emptyReason: product["error-message"] ?? "PriceCharting product error",
      rawJson: productRaw,
      requestUrl: productUrl,
    };
  }

  const sales = quotesFromProduct(product, query);
  return {
    adapterId: PRICECHARTING_ADAPTER_ID,
    sales,
    emptyReason: sales.length
      ? undefined
      : `PriceCharting product ${picked.id} had no loose/ungraded guide price`,
    rawJson: productRaw,
    requestUrl: productUrl,
  };
}

export const pricechartingAdapter: CompsAdapter = {
  id: PRICECHARTING_ADAPTER_ID,
  label: "PriceCharting guide · unverified",
  matches: (holding) => Boolean(pricechartingToken()) && isComicHolding(holding),
  fetchComps: fetchSold,
};
