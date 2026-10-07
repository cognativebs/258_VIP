import { PriceChartingProductSchema, type PriceChartingProduct } from "@vip/core-model";

export const PRICECHARTING_CLIENT_VERSION = "pricecharting-client@0.1.0";
export const PRICECHARTING_DEFAULT_BASE = "https://www.pricecharting.com";
export const PRICECHARTING_MIN_INTERVAL_MS = 1000;

export type PriceChartingClientConfig = {
  token?: string;
  baseUrl?: string;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type PriceChartingFetchResult =
  | { ok: true; product: PriceChartingProduct; rawJson: string }
  | { ok: false; emptyReason: string; rawJson?: string };

let lastCallAt = 0;

export function resetPriceChartingRateLimitForTests(): void {
  lastCallAt = 0;
}

export function priceChartingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PRICECHARTING_ENABLED === "true" && Boolean(env.PRICECHARTING_TOKEN?.trim());
}

/**
 * Official Prices API. Idle without token — never fabricates a product.
 * Rate limit: 1 call / second (vendor hard limit).
 */
export async function fetchPriceChartingProduct(
  query: { id?: string; upc?: string; q?: string },
  config: PriceChartingClientConfig = {},
): Promise<PriceChartingFetchResult> {
  const token = config.token ?? process.env.PRICECHARTING_TOKEN?.trim();
  if (!token) {
    return { ok: false, emptyReason: "PRICECHARTING_TOKEN unset — adapter idle" };
  }
  if (!query.id && !query.upc && !query.q) {
    return { ok: false, emptyReason: "id, upc, or q is required" };
  }

  await respectRateLimit(config);
  const base = (config.baseUrl ?? process.env.PRICECHARTING_BASE_URL ?? PRICECHARTING_DEFAULT_BASE).replace(
    /\/$/,
    "",
  );
  const params = new URLSearchParams({ t: token });
  if (query.id) params.set("id", query.id);
  else if (query.upc) params.set("upc", query.upc);
  else if (query.q) params.set("q", query.q);

  const url = `${base}/api/product?${params.toString()}`;
  const fetchImpl = config.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return { ok: false, emptyReason: `network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const rawJson = await res.text();
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, emptyReason: `vendor HTTP ${res.status}`, rawJson };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, emptyReason: "unparseable PriceCharting JSON", rawJson };
  }

  const status = (parsed as { status?: string })?.status;
  if (status === "error") {
    const msg = (parsed as { "error-message"?: string })["error-message"] ?? "vendor error";
    return { ok: false, emptyReason: msg, rawJson };
  }

  const product = PriceChartingProductSchema.safeParse(parsed);
  if (!product.success) {
    return { ok: false, emptyReason: "PriceCharting product failed schema validation", rawJson };
  }
  return { ok: true, product: product.data, rawJson };
}

async function respectRateLimit(config: PriceChartingClientConfig): Promise<void> {
  const min = config.minIntervalMs ?? PRICECHARTING_MIN_INTERVAL_MS;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const elapsed = now() - lastCallAt;
  if (lastCallAt > 0 && elapsed < min) {
    await sleep(min - elapsed);
  }
  lastCallAt = now();
}
