/**
 * eBay Browse API adapter — active listings as ask comps + listing count liquidity proxy.
 *
 * Marketplace Insights (sold) is gated; Browse is available now with buy.browse.
 * Paid sold-comp aggregators drop in behind MarketCompsAdapter later — same normalize contract.
 *
 * Provenance: asks are inferred · unverified. Never stored as sold sales.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ActiveListingAskSchema,
  AskAsSaleCompSchema,
  EBAY_BROWSE_ADAPTER_VERSION,
  EbayBrowseAdapterConfigSchema,
  MarketCompsBundleSchema,
  MarketCompsQuerySchema,
  RawEbayBrowseSnapshotSchema,
  type ActiveListingAsk,
  type AskAsSaleComp,
  type EbayBrowseAdapterConfig,
  type MarketCompsBundle,
  type MarketCompsQuery,
  type RawEbayBrowseSnapshot,
} from "../schemas/ebay-browse.js";
import type { MarketCompsAdapter } from "./market-comps.js";

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";

type TokenCache = { accessToken: string; expiresAtMs: number };

let lastFetchAt = 0;
let tokenCache: TokenCache | null = null;

type EbayPrice = { value?: string; currency?: string };
type EbayItemSummary = {
  itemId?: string;
  title?: string;
  price?: EbayPrice;
  currentBidPrice?: EbayPrice;
  condition?: string;
  itemWebUrl?: string;
  buyingOptions?: string[];
  shippingOptions?: Array<{ shippingCost?: EbayPrice }>;
};

type EbaySearchBody = {
  total?: number;
  itemSummaries?: EbayItemSummary[];
  warnings?: unknown[];
  errors?: Array<{ errorId?: number; message?: string }>;
};

function apiHost(environment: "production" | "sandbox"): string {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function stableId(sourceId: string, listingId: string): string {
  return createHash("sha256").update(`${sourceId}:${listingId}`).digest("hex").slice(0, 24);
}

function parseMoney(p: EbayPrice | undefined): { value: number; currency: string } | null {
  if (!p?.value) return null;
  const value = Number(p.value);
  if (!Number.isFinite(value) || value < 0) return null;
  const currency = (p.currency ?? "USD").toUpperCase().slice(0, 3);
  return { value, currency: currency.length === 3 ? currency : "USD" };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

/** Active listing count → liquidity proxy (not sold velocity). */
export function liquidityFromActiveCount(total: number): MarketCompsBundle["liquidity"] {
  const n = Math.max(0, Math.floor(total));
  // Rough bands: thin asks → illiquid; dense asks → faster exit proxy.
  let score = 0;
  if (n <= 0) score = 0;
  else if (n === 1) score = 12;
  else if (n <= 3) score = 28;
  else if (n <= 8) score = 45;
  else if (n <= 20) score = 62;
  else if (n <= 50) score = 78;
  else score = Math.min(95, 78 + Math.log10(n) * 8);

  const band =
    score >= 70 ? "fast" : score >= 40 ? "medium" : score >= 15 ? "slow" : "illiquid";

  const confidence =
    n === 0 ? 0.15 : n < 5 ? 0.35 : n < 20 ? 0.5 : Math.min(0.65, 0.45 + n * 0.004);

  return {
    activeListingCount: n,
    score: Number(score.toFixed(1)),
    band,
    confidence: Number(confidence.toFixed(3)),
    notes:
      "Liquidity from eBay Browse active listing count — proxy only, not sold velocity. Marketplace Insights sold comps unavailable.",
  };
}

function askConfidence(matchedAsks: number, total: number): number {
  // Caps below sold-comp confidence — active asks are noisier (BIN vs auction, duplicates).
  if (matchedAsks === 0) return 0.1;
  const sample = Math.min(1, matchedAsks / 10);
  const depth = Math.min(1, total / 25);
  return Number(Math.max(0.15, Math.min(0.62, 0.2 + 0.28 * sample + 0.14 * depth)).toFixed(3));
}

export class EbayBrowseAdapter implements MarketCompsAdapter {
  readonly id: string;
  private readonly config: EbayBrowseAdapterConfig;

  constructor(config: EbayBrowseAdapterConfig) {
    this.config = EbayBrowseAdapterConfigSchema.parse(config);
    this.id = this.config.sourceId;
  }

  /** Build config from VIP_* / EBAY_* env (tests can pass explicit config instead). */
  static fromEnv(overrides: Partial<EbayBrowseAdapterConfig> & { snapshotDir: string }): EbayBrowseAdapter {
    return new EbayBrowseAdapter({
      sourceId: process.env.VIP_EBAY_SOURCE_ID ?? "ebay-browse",
      environment:
        (process.env.EBAY_ENVIRONMENT as "production" | "sandbox" | undefined) ?? "production",
      marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
      appId: process.env.EBAY_APP_ID ?? process.env.EBAY_CLIENT_ID,
      certId: process.env.EBAY_CERT_ID ?? process.env.EBAY_CLIENT_SECRET,
      oauthToken: process.env.EBAY_OAUTH_TOKEN,
      rateLimitMs: Number(process.env.VIP_EBAY_RATE_LIMIT_MS ?? 1000),
      defaultLimit: Number(process.env.VIP_EBAY_DEFAULT_LIMIT ?? 50),
      ...overrides,
    });
  }

  async fetchAndSnapshot(query: MarketCompsQuery, now = new Date()): Promise<RawEbayBrowseSnapshot> {
    const q = MarketCompsQuerySchema.parse(query);
    const token = await this.resolveAccessToken();
    const limit = q.limit ?? this.config.defaultLimit;
    const params = new URLSearchParams({
      q: q.query,
      limit: String(limit),
    });
    if (q.categoryIds?.length) {
      params.set("category_ids", q.categoryIds.join(","));
    }
    if (q.filters?.length) {
      params.set("filter", q.filters.join(","));
    }

    const url = `${apiHost(this.config.environment)}/buy/browse/v1/item_summary/search?${params}`;
    await this.throttle();

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": this.config.marketplaceId,
        Accept: "application/json",
      },
    });
    lastFetchAt = Date.now();
    const rawJson = await res.text();
    if (!res.ok) {
      throw new Error(
        `EbayBrowseAdapter search failed: ${res.status} ${res.statusText} — ${rawJson.slice(0, 280)}`,
      );
    }
    return this.writeSnapshot({
      url,
      query: q.query,
      assetRef: q.assetRef ?? null,
      rawJson,
      httpStatus: res.status,
      now,
    });
  }

  /** Write / re-write an immutable snapshot from known JSON (tests + offline fixture). */
  writeSnapshot(input: {
    url: string;
    query: string;
    assetRef?: string | null;
    rawJson: string;
    httpStatus?: number;
    now?: Date;
  }): RawEbayBrowseSnapshot {
    const now = input.now ?? new Date();
    mkdirSync(this.config.snapshotDir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const safeQ = input.query.replace(/[^\w.-]+/g, "_").slice(0, 48);
    const snapshotPath = join(
      this.config.snapshotDir,
      `${this.config.sourceId}-${safeQ}-${stamp}.json`,
    );
    writeFileSync(snapshotPath, input.rawJson, "utf8");
    return RawEbayBrowseSnapshotSchema.parse({
      url: input.url,
      query: input.query,
      assetRef: input.assetRef ?? null,
      fetchedAt: now.toISOString(),
      marketplaceId: this.config.marketplaceId,
      environment: this.config.environment,
      rawJson: input.rawJson,
      snapshotPath,
      byteLength: Buffer.byteLength(input.rawJson, "utf8"),
      httpStatus: input.httpStatus ?? 200,
    });
  }

  parseSnapshot(snapshot: RawEbayBrowseSnapshot): MarketCompsBundle {
    RawEbayBrowseSnapshotSchema.parse(snapshot);
    let body: EbaySearchBody;
    try {
      body = JSON.parse(snapshot.rawJson) as EbaySearchBody;
    } catch {
      return MarketCompsBundleSchema.parse({
        query: snapshot.query,
        assetRef: snapshot.assetRef ?? null,
        fetchedAt: snapshot.fetchedAt,
        asks: [],
        low: 0,
        high: 0,
        matchedAsks: 0,
        liquidity: liquidityFromActiveCount(0),
        provenance: {
          source: this.config.sourceId,
          method: "ebay-browse-search",
          modelVersion: EBAY_BROWSE_ADAPTER_VERSION,
          confidence: 0.05,
          verificationStatus: "quarantined",
          notes: "Malformed Browse JSON — quarantined",
        },
        sourceLabel: "eBay Browse — parse failure (quarantined)",
      });
    }

    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message ?? String(e.errorId)).join("; ");
      return MarketCompsBundleSchema.parse({
        query: snapshot.query,
        assetRef: snapshot.assetRef ?? null,
        fetchedAt: snapshot.fetchedAt,
        asks: [],
        low: 0,
        high: 0,
        matchedAsks: 0,
        liquidity: liquidityFromActiveCount(0),
        provenance: {
          source: this.config.sourceId,
          method: "ebay-browse-search",
          modelVersion: EBAY_BROWSE_ADAPTER_VERSION,
          confidence: 0.05,
          verificationStatus: "quarantined",
          notes: `Browse API errors: ${msg}`,
        },
        sourceLabel: "eBay Browse — API error (quarantined)",
      });
    }

    const total = typeof body.total === "number" && body.total >= 0 ? body.total : 0;
    const summaries = Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
    const asks: ActiveListingAsk[] = [];
    const seen = new Set<string>();

    for (const item of summaries) {
      const listingId = (item.itemId ?? "").trim();
      const title = (item.title ?? "").trim();
      const money = parseMoney(item.price) ?? parseMoney(item.currentBidPrice);

      if (!listingId || !title || !money) {
        asks.push(
          ActiveListingAskSchema.parse({
            id: stableId(this.config.sourceId, `malformed-${asks.length}`),
            listingId: listingId || `malformed-${asks.length}`,
            title: title || "(missing title)",
            price: money?.value ?? 0,
            currency: money?.currency ?? "USD",
            shipping: null,
            condition: item.condition ?? null,
            listingUrl: item.itemWebUrl ?? null,
            buyingOptions: item.buyingOptions ?? [],
            observedAt: snapshot.fetchedAt,
            quarantineStatus: "quarantined",
          }),
        );
        continue;
      }
      if (seen.has(listingId)) continue;
      seen.add(listingId);

      const ship = parseMoney(item.shippingOptions?.[0]?.shippingCost);

      asks.push(
        ActiveListingAskSchema.parse({
          id: stableId(this.config.sourceId, listingId),
          listingId,
          title,
          price: money.value,
          currency: money.currency,
          shipping: ship?.value ?? null,
          condition: item.condition ?? null,
          listingUrl: item.itemWebUrl ?? null,
          buyingOptions: item.buyingOptions ?? [],
          observedAt: snapshot.fetchedAt,
          quarantineStatus: "active",
        }),
      );
    }

    const active = asks.filter((a) => a.quarantineStatus === "active");
    const prices = active.map((a) => a.price).sort((a, b) => a - b);
    const low = prices.length ? Number(percentile(prices, 0.25).toFixed(2)) : 0;
    const high = prices.length ? Number(Math.max(percentile(prices, 0.75), low).toFixed(2)) : 0;
    const mid = prices.length ? Number(percentile(prices, 0.5).toFixed(2)) : undefined;
    const conf = askConfidence(active.length, total);

    return MarketCompsBundleSchema.parse({
      query: snapshot.query,
      assetRef: snapshot.assetRef ?? null,
      fetchedAt: snapshot.fetchedAt,
      asks,
      low,
      high,
      mid,
      matchedAsks: active.length,
      liquidity: liquidityFromActiveCount(total),
      provenance: {
        source: this.config.sourceId,
        method: "ebay-browse-search",
        modelVersion: EBAY_BROWSE_ADAPTER_VERSION,
        confidence: conf,
        verificationStatus: "inferred",
        notes:
          "Active listing asks from eBay Browse API — not sold comps. NM/grade assumed only if present in title · unverified.",
      },
      sourceLabel: `eBay Browse active asks · n=${total} listed (not sold)`,
    });
  }

  parseSnapshotFile(
    snapshotPath: string,
    meta: { url?: string; query: string; assetRef?: string | null; fetchedAt?: string },
  ): MarketCompsBundle {
    const rawJson = readFileSync(snapshotPath, "utf8");
    const snapshot = RawEbayBrowseSnapshotSchema.parse({
      url: meta.url ?? "file://snapshot",
      query: meta.query,
      assetRef: meta.assetRef ?? null,
      fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
      marketplaceId: this.config.marketplaceId,
      environment: this.config.environment,
      rawJson,
      snapshotPath,
      byteLength: Buffer.byteLength(rawJson, "utf8"),
      httpStatus: 200,
    });
    return this.parseSnapshot(snapshot);
  }

  async search(query: MarketCompsQuery, now = new Date()): Promise<MarketCompsBundle> {
    const snap = await this.fetchAndSnapshot(query, now);
    return this.parseSnapshot(snap);
  }

  /** Map active asks → SaleComp-compatible rows (source = ebay_browse_ask). */
  static toAskSaleComps(bundle: MarketCompsBundle): AskAsSaleComp[] {
    return bundle.asks
      .filter((a) => a.quarantineStatus === "active")
      .map((a) =>
        AskAsSaleCompSchema.parse({
          id: a.id,
          price: a.price,
          saleDate: new Date(a.observedAt),
          source: "ebay_browse_ask",
          title: a.title,
        }),
      );
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - lastFetchAt;
    if (lastFetchAt > 0 && elapsed < this.config.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.config.rateLimitMs - elapsed));
    }
  }

  private async resolveAccessToken(): Promise<string> {
    const preset = this.config.oauthToken?.trim();
    if (preset) return preset;

    if (tokenCache && Date.now() < tokenCache.expiresAtMs - 60_000) {
      return tokenCache.accessToken;
    }

    const appId = this.config.appId?.trim();
    const certId = this.config.certId?.trim();
    if (!appId || !certId) {
      throw new Error(
        "EbayBrowseAdapter: set EBAY_OAUTH_TOKEN or EBAY_APP_ID + EBAY_CERT_ID. " +
          "Sandbox keyset → EBAY_ENVIRONMENT=sandbox (Dev ID not required for Browse OAuth).",
      );
    }

    const tokenUrl = `${apiHost(this.config.environment)}/identity/v1/oauth2/token`;
    const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: BROWSE_SCOPE,
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `EbayBrowseAdapter OAuth failed: ${res.status} ${res.statusText} — ${text.slice(0, 280)}`,
      );
    }
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error("EbayBrowseAdapter OAuth: response missing access_token");
    }
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 7200;
    tokenCache = {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + expiresIn * 1000,
    };
    return json.access_token;
  }
}

/** Reset rate-limit + token cache (tests). */
export function resetEbayBrowseStateForTests(): void {
  lastFetchAt = 0;
  tokenCache = null;
}
