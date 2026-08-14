import { z } from "zod";

/** Adapter version — bump when normalize rules change (provenance.modelVersion). */
export const EBAY_BROWSE_ADAPTER_VERSION = "signals@ebay-browse-v1" as const;

export const EbayEnvironmentSchema = z.enum(["production", "sandbox"]);
export type EbayEnvironment = z.infer<typeof EbayEnvironmentSchema>;

/**
 * Config from env — never hardcode credentials.
 * Prefer EBAY_OAUTH_TOKEN when set; otherwise client-credentials via App ID + Cert ID.
 */
export const EbayBrowseAdapterConfigSchema = z.object({
  sourceId: z.string().min(1).default("ebay-browse"),
  environment: EbayEnvironmentSchema.default("production"),
  marketplaceId: z.string().min(1).default("EBAY_US"),
  /** App ID (Client ID). */
  appId: z.string().optional(),
  /** Cert ID (Client Secret). */
  certId: z.string().optional(),
  /** Pre-fetched user or app token (buy.browse). Skips client-credentials exchange. */
  oauthToken: z.string().optional(),
  rateLimitMs: z.number().int().nonnegative().default(1000),
  /** Directory for immutable raw JSON snapshots. */
  snapshotDir: z.string().min(1),
  defaultLimit: z.number().int().positive().max(200).default(50),
});
export type EbayBrowseAdapterConfig = z.infer<typeof EbayBrowseAdapterConfigSchema>;

export const MarketCompsQuerySchema = z.object({
  /** Free-text search (card name + set + number, etc.). */
  query: z.string().min(1),
  /** Opaque asset reference for downstream join (not required by eBay). */
  assetRef: z.string().optional(),
  categoryIds: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(200).optional(),
  /** Extra Browse filter expressions, e.g. ["conditions:{NEW}"]. */
  filters: z.array(z.string().min(1)).optional(),
});
export type MarketCompsQuery = z.infer<typeof MarketCompsQuerySchema>;

export const MarketCompsProvenanceSchema = z.object({
  source: z.string().min(1),
  method: z.string().min(1),
  modelVersion: z.literal(EBAY_BROWSE_ADAPTER_VERSION),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.enum(["inferred", "verified", "quarantined"]),
  notes: z.string().optional(),
});
export type MarketCompsProvenance = z.infer<typeof MarketCompsProvenanceSchema>;

/** One active listing — an ASK, never a sold comp. */
export const ActiveListingAskSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default("USD"),
  shipping: z.number().nonnegative().nullable().optional(),
  condition: z.string().nullable().optional(),
  listingUrl: z.string().nullable().optional(),
  buyingOptions: z.array(z.string()).default([]),
  /** When the listing was observed (fetch time), not a sale date. */
  observedAt: z.string().min(1),
  quarantineStatus: z.enum(["active", "quarantined", "rejected"]).default("active"),
});
export type ActiveListingAsk = z.infer<typeof ActiveListingAskSchema>;

export const LiquidityProxySchema = z.object({
  /** eBay `total` from search — active listing count, not sold velocity. */
  activeListingCount: z.number().int().nonnegative(),
  /** 0–100 heuristic from active count only; labeled as proxy. */
  score: z.number().min(0).max(100),
  band: z.enum(["illiquid", "slow", "medium", "fast"]),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type LiquidityProxy = z.infer<typeof LiquidityProxySchema>;

/**
 * Normalized bundle for Decision Engine / getPricing seam.
 * Range is from active asks — never present as sold facts.
 */
export const MarketCompsBundleSchema = z.object({
  query: z.string().min(1),
  assetRef: z.string().nullable().optional(),
  fetchedAt: z.string().min(1),
  /** Sampled asks used for the range (page), not necessarily all of `total`. */
  asks: z.array(ActiveListingAskSchema),
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  /** Internal blend only — UI must show range + evidence. */
  mid: z.number().nonnegative().optional(),
  matchedAsks: z.number().int().nonnegative(),
  liquidity: LiquidityProxySchema,
  provenance: MarketCompsProvenanceSchema,
  /** Human label for pricing UI source line. */
  sourceLabel: z.string().min(1),
});
export type MarketCompsBundle = z.infer<typeof MarketCompsBundleSchema>;

/** Immutable raw snapshot — regenerable normalize input. */
export const RawEbayBrowseSnapshotSchema = z.object({
  url: z.string().min(1),
  query: z.string().min(1),
  assetRef: z.string().nullable().optional(),
  fetchedAt: z.string().min(1),
  marketplaceId: z.string().min(1),
  environment: EbayEnvironmentSchema,
  /** Full Browse API JSON body as string (immutable). */
  rawJson: z.string().min(1),
  snapshotPath: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  httpStatus: z.number().int().positive(),
});
export type RawEbayBrowseSnapshot = z.infer<typeof RawEbayBrowseSnapshotSchema>;

/**
 * Compatible with @vip/decision-engine SaleComp shape.
 * saleDate = observation time; source marks these as asks so callers do not treat as sold.
 */
export const AskAsSaleCompSchema = z.object({
  id: z.string(),
  price: z.number().nonnegative(),
  saleDate: z.coerce.date(),
  source: z.literal("ebay_browse_ask"),
  title: z.string().optional(),
});
export type AskAsSaleComp = z.infer<typeof AskAsSaleCompSchema>;

/** Matches demo getPricing() return contract. */
export const PricingSeamResultSchema = z.object({
  marketValue: z.number().nonnegative(),
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  comps: z.array(
    z.object({
      price: z.number().nonnegative(),
      date: z.string(),
      title: z.string(),
    }),
  ),
  source: z.string(),
  confidence: z.number().min(0).max(100),
  liquidityProxy: LiquidityProxySchema.optional(),
  provenance: MarketCompsProvenanceSchema.optional(),
});
export type PricingSeamResult = z.infer<typeof PricingSeamResultSchema>;
