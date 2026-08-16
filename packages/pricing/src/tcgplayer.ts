import { markNormalized, markObserved } from "@vip/evidence";
import {
  TCGPLAYER_CONDITIONS,
  type CardCondition,
  type PriceHistoryAdapter,
  type PriceHistoryQuery,
  type PriceHistoryRange,
  type PriceHistoryResult,
  type PriceObservation,
} from "./types.js";

export const TCGPLAYER_SOURCE = "tcgplayer.com";
export const TCGPLAYER_PRICE_RULE = "tcgplayer-price-history@0.1.0";

/**
 * TCGplayer price history via the public infinite-api used by their price
 * charts, with product ids resolved through prices.pokemontcg.io.
 *
 * Bucket granularity is set by `range` and was measured against live data:
 *   month   → 30 buckets, 1 day apart   (daily history — use for the daily job)
 *   quarter → 30 buckets, 3 days apart  (~87 days)
 *   annual  → 52 buckets, 7 days apart  (~1 year)
 * `year` and `all` return HTTP 400.
 */
const RANGE_PARAM: Record<PriceHistoryRange, string> = {
  daily: "month",
  quarter: "quarter",
  annual: "annual",
};

const REDIRECT_BASE = "https://prices.pokemontcg.io/tcgplayer";
const HISTORY_BASE = "https://infinite-api.tcgplayer.com/price/history";

export type TcgplayerAdapterOptions = {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Retries per request on 5xx / network error. */
  retries?: number;
  timeoutMs?: number;
  userAgent?: string;
};

type RawBucket = {
  marketPrice?: string | number | null;
  quantitySold?: string | number | null;
  lowSalePrice?: string | number | null;
  highSalePrice?: string | number | null;
  transactionCount?: string | number | null;
  bucketStartDate?: string | null;
};

type RawRow = {
  condition?: string | null;
  variant?: string | null;
  buckets?: RawBucket[] | null;
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** TCGplayer reports 0 for "no sales", which is absence, not a $0 price. */
function positive(value: unknown): number | null {
  const n = num(value);
  return n != null && n > 0 ? n : null;
}

function intOr0(value: unknown): number {
  const n = num(value);
  return n != null && n >= 0 ? Math.trunc(n) : 0;
}

export function conditionFromTcgplayer(raw: string | null | undefined): CardCondition {
  if (!raw) return "UNKNOWN";
  return TCGPLAYER_CONDITIONS[raw.trim().toLowerCase()] ?? "UNKNOWN";
}

export function extractProductId(text: string): string | null {
  if (!text) return null;
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    /* malformed encoding — original is still worth matching */
  }
  for (const c of candidates) {
    const m = c.match(/product\/(\d+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** `sm12-143a` also lives under `sm12-143` when the suffixed id 404s. */
export function priceIdCandidates(externalId: string): string[] {
  const out = [externalId];
  const m = externalId.match(/^(.+-)(\d+)([a-z]+)$/i);
  if (m) out.push(`${m[1]}${m[2]}`);
  return out;
}

/**
 * Turn one provider payload into observations for the requested condition.
 *
 * Exported for tests so parsing is verified against a captured real response
 * rather than only through the network.
 */
export function observationsFromPayload(
  payload: { result?: RawRow[] | null },
  opts: {
    externalId: string;
    productId: string | null;
    condition?: CardCondition;
    variant?: string | null;
  },
): { observations: PriceObservation[]; emptyReason?: string } {
  const wanted = opts.condition ?? "NM";
  const rows = payload.result ?? [];
  if (rows.length === 0) {
    return { observations: [], emptyReason: "provider returned no price rows" };
  }

  const byVariant = opts.variant
    ? rows.filter(
        (r) => (r.variant ?? "").toLowerCase() === opts.variant!.toLowerCase(),
      )
    : rows;
  const pool = byVariant.length > 0 ? byVariant : rows;

  let matched = pool.filter((r) => conditionFromTcgplayer(r.condition) === wanted);
  // "Assume NM unless told otherwise": only when the provider never reported
  // the requested condition do we fall back, and the fallback is labelled.
  let conditionAssumed = false;
  if (matched.length === 0) {
    matched = pool;
    conditionAssumed = true;
  }
  if (matched.length === 0) {
    return { observations: [], emptyReason: `no rows for condition ${wanted}` };
  }

  const observations: PriceObservation[] = [];
  for (const row of matched) {
    const variant = (row.variant ?? "").trim() || "Unknown";
    for (const bucket of row.buckets ?? []) {
      const observedOn = (bucket.bucketStartDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) continue;

      const marketPrice = positive(bucket.marketPrice);
      const lowSalePrice = positive(bucket.lowSalePrice);
      const highSalePrice = positive(bucket.highSalePrice);
      const transactionCount = intOr0(bucket.transactionCount);
      const quantitySold = intOr0(bucket.quantitySold);

      // A bucket with neither a market price nor a sale is not evidence.
      if (marketPrice == null && lowSalePrice == null) continue;

      const traded = transactionCount > 0 || lowSalePrice != null;
      const notes = conditionAssumed
        ? `condition not reported by provider — ${wanted} assumed · unverified`
        : traded
          ? `${transactionCount} transaction(s) on ${observedOn}`
          : `no sales on ${observedOn} — provider market price is a computed value`;

      observations.push({
        externalId: opts.externalId,
        productId: opts.productId,
        source: TCGPLAYER_SOURCE,
        variant,
        condition: conditionAssumed ? wanted : conditionFromTcgplayer(row.condition),
        conditionAssumed,
        observedOn,
        currency: "USD",
        marketPrice,
        lowSalePrice,
        highSalePrice,
        quantitySold,
        transactionCount,
        provenance: traded
          ? markObserved({
              source: TCGPLAYER_SOURCE,
              ruleOrModelVersion: TCGPLAYER_PRICE_RULE,
              // Real trades, but we did not witness them ourselves.
              confidence: conditionAssumed ? 0.6 : 0.85,
              verificationStatus: conditionAssumed ? "unverified" : "verified",
              notes,
            })
          : markNormalized({
              source: TCGPLAYER_SOURCE,
              ruleOrModelVersion: TCGPLAYER_PRICE_RULE,
              confidence: conditionAssumed ? 0.4 : 0.6,
              notes,
            }),
      });
    }
  }

  if (observations.length === 0) {
    return { observations: [], emptyReason: "no usable price buckets" };
  }
  return { observations, emptyReason: undefined };
}

export function createTcgplayerPriceAdapter(
  opts: TcgplayerAdapterOptions = {},
): PriceHistoryAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const userAgent = opts.userAgent ?? "VaultOS-Pricing/0.1";

  async function getJson(url: string): Promise<unknown | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(url, {
          headers: { accept: "application/json", "user-agent": userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return await res.json();
        // 4xx is a real answer ("no such product") — do not hammer it.
        if (res.status < 500) return null;
      } catch {
        /* retry below */
      }
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
    return null;
  }

  async function resolveProductId(externalId: string): Promise<string | null> {
    for (const id of priceIdCandidates(externalId)) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await doFetch(`${REDIRECT_BASE}/${encodeURIComponent(id)}`, {
            headers: { accept: "text/html" },
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
          });
          const location = res.headers.get("location") ?? "";
          const fromHeader = extractProductId(location);
          if (fromHeader) return fromHeader;
          if (res.status < 500) {
            const body = await res.text().catch(() => "");
            const fromBody = extractProductId(body);
            if (fromBody) return fromBody;
            break;
          }
        } catch {
          /* retry below */
        }
        if (attempt < retries) await sleep(300 * (attempt + 1));
      }
    }
    return null;
  }

  return {
    id: "tcgplayer-price-history",
    label: "TCGplayer price history (via pokemontcg product map)",
    matches: (_externalId, source) => !source || source === "pokemontcg",
    async fetchHistory(query: PriceHistoryQuery): Promise<PriceHistoryResult> {
      const base: PriceHistoryResult = {
        adapterId: "tcgplayer-price-history",
        externalId: query.externalId,
        observations: [],
      };

      const productId = await resolveProductId(query.externalId);
      if (!productId) {
        return { ...base, emptyReason: "no TCGplayer product id for this card" };
      }

      const range = RANGE_PARAM[query.range ?? "daily"];
      const payload = await getJson(
        `${HISTORY_BASE}/${productId}/detailed?range=${range}`,
      );
      if (!payload || typeof payload !== "object") {
        return { ...base, emptyReason: "price history request failed" };
      }

      const parsed = observationsFromPayload(payload as { result?: RawRow[] }, {
        externalId: query.externalId,
        productId,
        condition: query.condition ?? "NM",
        variant: query.variant ?? null,
      });
      return { ...base, ...parsed };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
