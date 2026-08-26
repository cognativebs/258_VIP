import { z } from "zod";

/** Live adapter tags from inventoryApi — not the spec's comics_api/vip_fallback names. */
export const InventorySourceSchema = z.enum(["comics", "vip", "none"]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const InventoryProvenanceSchema = z.object({
  source: InventorySourceSchema,
  method: z.enum(["http_get", "fallback_chain"]),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.literal("unverified"),
});
export type InventoryProvenance = z.infer<typeof InventoryProvenanceSchema>;

export const ComicRowSchema = z
  .object({
    id: z.string(),
    Series: z.string(),
    "Issue Full": z.string(),
    "Edition / Variant": z.string().optional(),
    Publisher: z.string().optional(),
    "Collection Pillar": z.string().nullable().optional(),
    "Current Price": z.number().nullable().optional(),
    "Museum Score": z.number().nullable().optional(),
    "Investment Score": z.number().nullable().optional(),
    "Liquidity Score": z.number().nullable().optional(),
    Recommendation: z.string().nullable().optional(),
    "Sell Priority": z.string().nullable().optional(),
    "Assumed Grade": z.string().nullable().optional(),
    "Needs Grading": z.union([z.string(), z.boolean()]).nullable().optional(),
    Duplicate: z.string().nullable().optional(),
    "Slab Status": z.string().nullable().optional(),
  })
  .passthrough();
export type ComicRow = z.infer<typeof ComicRowSchema>;

export const InventoryMetaSchema = z.object({
  snapshotLabel: z.string(),
  /** Row count in this snapshot — not a valuation. */
  recordCount: z.number().int().nonnegative(),
  /**
   * Catalog/snapshot dollars. Never present as live comps.
   * UI and council context must keep the unverified label.
   */
  snapshotTotal: z.object({
    amount: z.number(),
    note: z.literal("catalog snapshot · unverified"),
  }),
  note: z.string().optional(),
});
export type InventoryMeta = z.infer<typeof InventoryMetaSchema>;

export const InventoryBundleSchema = z.object({
  source: InventorySourceSchema,
  fetchedAt: z.string(),
  meta: InventoryMetaSchema,
  rows: z.array(ComicRowSchema),
  provenance: InventoryProvenanceSchema,
});
export type InventoryBundle = z.infer<typeof InventoryBundleSchema>;

/** Catalog list price — never a live comp. */
export const CATALOG_SNAPSHOT_NOTE = "catalog snapshot · unverified" as const;

/** Decision-engine minSalesForBuy — Sell/Lot needs at least this many matched comps. */
export const MIN_SALES_FOR_MARKET_EVIDENCE = 3;

/** Bounded so Analysis cannot fire unbounded adapter fan-out. */
export const ANALYSIS_COMPS_CAP = 12;

export const CatalogSnapshotSchema = z.object({
  amount: z.number().nullable(),
  note: z.literal(CATALOG_SNAPSHOT_NOTE),
});
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

export const MarketRangeSchema = z
  .object({
    low: z.number(),
    high: z.number(),
    matchedSales: z.number().int().nonnegative(),
    recencyDays: z.number().nullable(),
    confidence: z.number().min(0).max(1),
    confidenceBand: z.enum(["low", "medium", "high"]).optional(),
  })
  .nullable();
export type MarketRange = z.infer<typeof MarketRangeSchema>;

export const CompsAdapterStatusSchema = z.object({
  id: z.string(),
  matched: z.number().int().nonnegative(),
  emptyReason: z.string().nullable().optional(),
});
export type CompsAdapterStatus = z.infer<typeof CompsAdapterStatusSchema>;

export const MarketEvidenceProvenanceSchema = z.object({
  source: z.string().min(1),
  method: z.enum(["recommendation", "inferred"]),
  ruleOrModelVersion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.literal("unverified"),
  notes: z.string().optional(),
});
export type MarketEvidenceProvenance = z.infer<typeof MarketEvidenceProvenanceSchema>;

export const HighlightMarketSchema = z.object({
  holdingId: z.string(),
  catalogSnapshot: CatalogSnapshotSchema,
  range: MarketRangeSchema,
  matchedSales: z.number().int().nonnegative(),
  recencyDays: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  insufficientMarketEvidence: z.boolean(),
  compsSource: z.string(),
  adapters: z.array(CompsAdapterStatusSchema),
  minSalesRequired: z.number().int().positive(),
  provenance: MarketEvidenceProvenanceSchema,
  ruleOrModelVersion: z.string().optional(),
});
export type HighlightMarket = z.infer<typeof HighlightMarketSchema>;

export const EbayAuthStatusSchema = z.object({
  configured: z.boolean(),
  mode: z.enum(["oauth_token", "client_credentials", "idle", "unknown"]),
  environment: z.enum(["production", "sandbox"]).optional(),
  oauthScope: z.string().optional(),
});
export type EbayAuthStatus = z.infer<typeof EbayAuthStatusSchema>;

export const LiquidationBlockSchema = z.object({
  holdingId: z.string(),
  reason: z.string(),
});

export const LiquidationGateSchema = z.object({
  action: z.enum(["blocked", "conditional"]),
  minSalesRequired: z.number().int().positive(),
  eligibleHoldingIds: z.array(z.string()),
  blocked: z.array(LiquidationBlockSchema),
  rule: z.string(),
  ebayAuth: EbayAuthStatusSchema,
  adaptersReRanAt: z.string().nullable(),
});
export type LiquidationGate = z.infer<typeof LiquidationGateSchema>;

export const MarketEvidenceBundleSchema = z.object({
  attemptedIds: z.array(z.string()),
  byHoldingId: z.record(HighlightMarketSchema),
  missingHoldingIds: z.array(z.string()),
  fetchedAt: z.string(),
  minSalesRequired: z.number().int().positive(),
  holdingsWithSales: z.number().int().nonnegative(),
  holdingsInsufficient: z.number().int().nonnegative(),
  adapterIdleNotes: z.array(z.string()),
  fetchError: z.string().nullable(),
  ebayAuth: EbayAuthStatusSchema,
  provenance: MarketEvidenceProvenanceSchema,
});
export type MarketEvidenceBundle = z.infer<typeof MarketEvidenceBundleSchema>;

/** VIP GET /api/recommendations payload (subset Analysis consumes). */
export const VipRecommendationSchema = z.object({
  holdingId: z.string(),
  marketRange: z
    .object({
      low: z.number(),
      high: z.number(),
      matchedSales: z.number().int().nonnegative(),
      recencyDays: z.number().nullable(),
      confidence: z.number().min(0).max(1),
      confidenceBand: z.enum(["low", "medium", "high"]).optional(),
    })
    .nullable()
    .optional(),
  insufficientMarketEvidence: z.boolean(),
  compsSource: z.string(),
  compsAdapters: z.array(CompsAdapterStatusSchema).optional(),
  minSalesRequired: z.number().int().positive().optional(),
  ruleOrModelVersion: z.string().optional(),
  provenance: MarketEvidenceProvenanceSchema.optional(),
});
export type VipRecommendation = z.infer<typeof VipRecommendationSchema>;

export const VipRecommendationsResponseSchema = z.object({
  recommendations: z.array(VipRecommendationSchema).default([]),
  missingHoldingIds: z.array(z.string()).optional(),
  minSalesRequired: z.number().int().positive().optional(),
  ebayAuth: EbayAuthStatusSchema.optional(),
  error: z.string().optional(),
});
export type VipRecommendationsResponse = z.infer<typeof VipRecommendationsResponseSchema>;
