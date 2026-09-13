import { markNormalized } from "@vip/evidence";
import { z } from "zod";
import { centsToDollars } from "./cents.js";
import {
  PriceChartingHostSchema,
  PriceChartingProductSchema,
  type DealerCategory,
  type PriceChartingHost,
  type PriceChartingProduct,
} from "./schemas.js";
import { PRICECHARTING_ADAPTER_VERSION } from "./version.js";

/**
 * PriceCharting Prices API (valuation seam — not a CatalogAdapter).
 * ADR 0010 keeps Yu-Gi-Oh / SportsCardsPro out of *identification*.
 * This client is market-data only: current condition values in cents, no history.
 *
 * Sports cards live on the sister host sportscardspro.com (same token + shape).
 * That is a valuation hop, never an identity write.
 *
 * Idle without a token. Never fabricates prices when keys are missing.
 */
export const PRICECHARTING_TOKEN_ENV = "PRICECHARTING_API_TOKEN";

const RawProductSchema = z
  .object({
    status: z.string(),
    "error-message": z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    "product-name": z.string().optional(),
    "console-name": z.string().optional(),
    "release-date": z.union([z.string(), z.null()]).optional(),
    "sales-volume": z.union([z.number(), z.string(), z.null()]).optional(),
    "loose-price": z.union([z.number(), z.null()]).optional(),
    "cib-price": z.union([z.number(), z.null()]).optional(),
    "new-price": z.union([z.number(), z.null()]).optional(),
    "graded-price": z.union([z.number(), z.null()]).optional(),
    "box-only-price": z.union([z.number(), z.null()]).optional(),
    "manual-only-price": z.union([z.number(), z.null()]).optional(),
    "bgs-10-price": z.union([z.number(), z.null()]).optional(),
    "condition-17-price": z.union([z.number(), z.null()]).optional(),
  })
  .passthrough();

export type PriceChartingClientOptions = {
  token?: string | null;
  fetchImpl?: typeof fetch;
  /** Override host. Default is chosen from category. */
  host?: PriceChartingHost;
};

export function pricechartingTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env[PRICECHARTING_TOKEN_ENV]?.trim();
  return raw && raw.length >= 20 ? raw : null;
}

export function hostForCategory(category: DealerCategory): PriceChartingHost {
  return category === "sports"
    ? "https://www.sportscardspro.com"
    : "https://www.pricecharting.com";
}

export function parsePriceChartingProduct(
  raw: unknown,
  host: PriceChartingHost,
): PriceChartingProduct {
  const parsed = RawProductSchema.parse(raw);
  if (parsed.status !== "success") {
    throw new Error(parsed["error-message"] ?? "PriceCharting status is not success");
  }
  if (parsed.id == null || !parsed["product-name"]) {
    throw new Error("PriceCharting response missing id / product-name");
  }

  const priceKeys = [
    "loose-price",
    "cib-price",
    "new-price",
    "graded-price",
    "box-only-price",
    "manual-only-price",
    "bgs-10-price",
    "condition-17-price",
  ] as const;
  const rawKeysPresent = priceKeys.filter((k) => centsToDollars(parsed[k]) != null);

  const salesRaw = parsed["sales-volume"];
  const salesVolume =
    typeof salesRaw === "number"
      ? salesRaw
      : typeof salesRaw === "string" && salesRaw.trim()
        ? Number(salesRaw)
        : null;

  return PriceChartingProductSchema.parse({
    id: String(parsed.id),
    productName: parsed["product-name"],
    consoleName: parsed["console-name"] ?? "",
    releaseDate: parsed["release-date"] ?? null,
    salesVolume: salesVolume != null && Number.isFinite(salesVolume) ? salesVolume : null,
    prices: {
      ungraded: centsToDollars(parsed["loose-price"]),
      grade7: centsToDollars(parsed["cib-price"]),
      grade8: centsToDollars(parsed["new-price"]),
      grade9: centsToDollars(parsed["graded-price"]),
      grade95: centsToDollars(parsed["box-only-price"]),
      psa10: centsToDollars(parsed["manual-only-price"]),
      bgs10: centsToDollars(parsed["bgs-10-price"]),
      cgc10: centsToDollars(parsed["condition-17-price"]),
    },
    host: PriceChartingHostSchema.parse(host),
    rawKeysPresent,
    provenance: markNormalized({
      source: "pricecharting",
      ruleOrModelVersion: PRICECHARTING_ADAPTER_VERSION,
      confidence: rawKeysPresent.length >= 3 ? 0.7 : rawKeysPresent.length > 0 ? 0.5 : 0.2,
      notes:
        rawKeysPresent.length === 0
          ? "Identity only — this token/guide did not return condition prices. Not a sold ledger."
          : "Current PriceCharting condition values (cents÷100). Not historic sold comps · unverified.",
    }),
  });
}

export type PriceChartingLookup =
  | { ok: true; product: PriceChartingProduct; products?: PriceChartingProduct[] }
  | { ok: false; emptyReason: string; status?: number; rawJson?: string };

export async function lookupPriceCharting(
  query: { q?: string; id?: string; upc?: string; category?: DealerCategory; list?: boolean },
  opts: PriceChartingClientOptions = {},
): Promise<PriceChartingLookup> {
  const token = opts.token ?? pricechartingTokenFromEnv();
  if (!token) {
    return {
      ok: false,
      emptyReason: `${PRICECHARTING_TOKEN_ENV} is unset — PriceCharting adapter idle, no prices invented.`,
    };
  }

  const host = opts.host ?? hostForCategory(query.category ?? "other");
  const path = query.list || (!query.id && !query.upc && query.q) ? "/api/products" : "/api/product";
  const url = new URL(path, host);
  url.searchParams.set("t", token);
  if (query.id) url.searchParams.set("id", query.id);
  if (query.upc) url.searchParams.set("upc", query.upc);
  if (query.q) url.searchParams.set("q", query.q);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url.toString(), { method: "GET" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, emptyReason: "PriceCharting returned non-JSON", status: res.status, rawJson: text };
  }

  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "error-message" in json
        ? String((json as { "error-message": unknown })["error-message"])
        : `HTTP ${res.status}`;
    return { ok: false, emptyReason: msg, status: res.status, rawJson: text };
  }

  if (json && typeof json === "object" && "products" in json && Array.isArray((json as { products: unknown }).products)) {
    const products: PriceChartingProduct[] = [];
    for (const row of (json as { products: unknown[] }).products) {
      try {
        products.push(parsePriceChartingProduct({ ...(row as object), status: "success" }, host));
      } catch {
        // Skip malformed rows; do not invent.
      }
    }
    if (products.length === 0) {
      return { ok: false, emptyReason: "PriceCharting search matched zero parseable products", rawJson: text };
    }
    return { ok: true, product: products[0]!, products };
  }

  try {
    return { ok: true, product: parsePriceChartingProduct(json, host) };
  } catch (e) {
    return {
      ok: false,
      emptyReason: e instanceof Error ? e.message : String(e),
      rawJson: text,
    };
  }
}

/** Build flip comps from a PriceCharting condition map. Not sold comps — labeled as such. */
export function conditionMapToSyntheticComps(
  product: PriceChartingProduct,
  asOf: Date,
): { price: number; saleDate: Date; source: string; id: string; title: string }[] {
  const pairs: [string, number | null][] = [
    ["ungraded", product.prices.ungraded],
    ["grade7", product.prices.grade7],
    ["grade8", product.prices.grade8],
    ["grade9", product.prices.grade9],
  ];
  return pairs
    .filter(([, p]) => p != null)
    .map(([cond, p]) => ({
      id: `pc:${product.id}:${cond}`,
      price: p!,
      saleDate: asOf,
      source: "pricecharting",
      title: `${product.productName} · ${cond} guide (not a sold listing)`,
    }));
}
