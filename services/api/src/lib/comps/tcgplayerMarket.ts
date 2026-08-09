import type { ApiHolding } from "../holdings.js";
import type { CompSale, CompsAdapter, CompsAdapterResult } from "./types.js";

const RULE = "tcgplayer-market@0.1.0";
const PRICE_REDIRECT = "https://prices.pokemontcg.io/tcgplayer";
const HISTORY = "https://infinite-api.tcgplayer.com/price/history";

/**
 * TCGplayer market / price-history comps for TCG holdings (Decision D).
 *
 * Resolves pokemontcg external ids → TCGPlayer product via prices.pokemontcg.io,
 * then reads recent price-history points. Each point becomes a CompSale with
 * source `tcgplayer.com/history` and provenance notes that these are market
 * observations, not individual invoice lines.
 *
 * Without network / on failure: empty list + reason. Never fabricates.
 */
function pokemontcgId(holding: ApiHolding): string | null {
  const hit = holding.externalIds?.find((e) => e.source === "pokemontcg");
  return hit?.externalValue ?? null;
}

function isTcg(holding: ApiHolding): boolean {
  return Boolean(pokemontcgId(holding)) || holding.id.startsWith("binder-slot-");
}

async function resolveProductId(externalId: string): Promise<string | null> {
  try {
    const res = await fetch(`${PRICE_REDIRECT}/${encodeURIComponent(externalId)}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
      headers: { "User-Agent": "VIP-Comps/0.1" },
    });
    const location = res.headers.get("location") ?? res.headers.get("Location");
    if (!location) return null;
    // URLs look like https://www.tcgplayer.com/product/12345/...
    const m = location.match(/\/product\/(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchHistory(productId: string): Promise<CompSale[]> {
  const res = await fetch(`${HISTORY}/${productId}/detailed`, {
    headers: { "User-Agent": "VIP-Comps/0.1" },
    signal: AbortSignal.timeout(Number(process.env.VIP_COMPS_TIMEOUT_MS ?? 8000)),
  });
  if (!res.ok) return [];

  const body = (await res.json()) as {
    result?: {
      marketPrice?: number;
      averageDailyPrice?: number;
      buckets?: { bucketStartDate?: string; marketPrice?: number; quantitySold?: number }[];
    };
  };

  const sales: CompSale[] = [];
  const buckets = body.result?.buckets ?? [];
  for (const b of buckets.slice(-12)) {
    const price = Number(b.marketPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!b.bucketStartDate) continue;
    const qty = Number(b.quantitySold ?? 0);
    sales.push({
      id: `tcgplayer:${productId}:${b.bucketStartDate}`,
      price,
      saleDate: new Date(b.bucketStartDate),
      source: "tcgplayer.com/history",
      title: qty > 0 ? `TCGPlayer market · ${qty} sold in bucket` : "TCGPlayer market bucket",
      provenance: {
        method: "api",
        ruleOrModelVersion: RULE,
        verificationStatus: qty > 0 ? "verified" : "unverified",
        confidence: qty > 0 ? 0.8 : 0.55,
        notes:
          qty > 0
            ? "TCGPlayer price-history bucket with quantitySold"
            : "TCGPlayer market bucket without quantitySold — observation, not a confirmed sale lot",
      },
    });
  }

  // If history is empty but a spot market price exists, surface one observation
  // dated "now" so the engine has a single point — still a range of one with
  // low confidence, never a fabricated multi-sale cluster.
  if (!sales.length && body.result?.marketPrice) {
    const price = Number(body.result.marketPrice);
    if (Number.isFinite(price) && price > 0) {
      sales.push({
        id: `tcgplayer:${productId}:spot`,
        price,
        saleDate: new Date(),
        source: "tcgplayer.com/market",
        title: "TCGPlayer spot market price",
        provenance: {
          method: "api",
          ruleOrModelVersion: RULE,
          verificationStatus: "unverified",
          confidence: 0.5,
          notes: "Spot market quote — not a sold-ledger entry",
        },
      });
    }
  }

  return sales;
}

async function fetchComps(holding: ApiHolding): Promise<CompsAdapterResult> {
  const externalId = pokemontcgId(holding);
  if (!externalId) {
    return {
      adapterId: "tcgplayer-market",
      sales: [],
      emptyReason: "holding has no pokemontcg external id",
    };
  }

  try {
    const productId = await resolveProductId(externalId);
    if (!productId) {
      return {
        adapterId: "tcgplayer-market",
        sales: [],
        emptyReason: `no TCGPlayer product for ${externalId}`,
      };
    }
    const sales = await fetchHistory(productId);
    return {
      adapterId: "tcgplayer-market",
      sales,
      emptyReason: sales.length ? undefined : `empty price history for product ${productId}`,
    };
  } catch (e) {
    return {
      adapterId: "tcgplayer-market",
      sales: [],
      emptyReason: `TCGPlayer request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const tcgplayerMarketAdapter: CompsAdapter = {
  id: "tcgplayer-market",
  label: "TCGPlayer market / price history",
  matches: isTcg,
  fetchComps,
};
