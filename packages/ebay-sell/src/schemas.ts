import { z } from "zod";
import { InventoryBucketSchema } from "@vip/core-model";
import { ProvenanceSchema } from "@vip/evidence";

export const CategoryKindSchema = z.enum(["pokemon", "sports", "mtg", "comic", "other"]);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const SellingDispositionSchema = z.enum([
  "PC",
  "HOLD",
  "GRADE",
  "SINGLE",
  "LOT",
  "BULK",
  "LCS_SHOW",
  "DONATE",
  "REVIEW",
]);
export type SellingDisposition = z.infer<typeof SellingDispositionSchema>;

export const DispositionRecommendedBySchema = z.enum(["RULE", "MODEL", "USER", "ORCHESTR8"]);
export type DispositionRecommendedBy = z.infer<typeof DispositionRecommendedBySchema>;

export const ListingFormatSchema = z.enum(["FIXED_PRICE", "AUCTION"]);
export type ListingFormat = z.infer<typeof ListingFormatSchema>;

export const MarketplaceListingStatusSchema = z.enum([
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "EBAY_ITEM_CREATED",
  "EBAY_OFFER_CREATED",
  "PUBLISHED",
  "ACTIVE",
  "ENDED",
  "SOLD",
  "ERROR",
]);
export type MarketplaceListingStatus = z.infer<typeof MarketplaceListingStatusSchema>;

export const PricingStrategySchema = z.enum([
  "LIQUIDATE",
  "NORMAL",
  "BEST_OFFER_TARGET",
  "SCARCE_LOW_POP",
  "RELUCTANT_SELLER",
  "CUSTOM",
]);
export type PricingStrategy = z.infer<typeof PricingStrategySchema>;

export const SalesPathStateSchema = z.enum([
  "available",
  "reserved",
  "listed_single",
  "listed_lot",
  "sold",
]);
export type SalesPathState = z.infer<typeof SalesPathStateSchema>;

export const ObservationTypeSchema = z.enum(["INTERNAL_SALE", "EXTERNAL_COMP", "PRICE_GUIDE"]);
export type ObservationType = z.infer<typeof ObservationTypeSchema>;

export const QueueActionSchema = z.enum([
  "approve",
  "edit",
  "defer",
  "hold",
  "change_disposition",
  "reject",
]);
export type QueueAction = z.infer<typeof QueueActionSchema>;

export const ExperimentStatusSchema = z.enum(["draft", "running", "paused", "completed", "abandoned"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const FmvSnapshotSchema = z.object({
  low: z.number().nonnegative(),
  high: z.number().nonnegative(),
  mid: z.number().nonnegative(),
  currency: z.string().length(3).default("USD"),
  confidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().nonnegative(),
  source: z.string().min(1),
  method: z.enum(["observed", "normalized", "inferred"]),
  verificationStatus: z.enum(["verified", "unverified", "disputed", "superseded"]),
  recencyDays: z.number().nonnegative().nullable(),
  notes: z.string().optional(),
});
export type FmvSnapshot = z.infer<typeof FmvSnapshotSchema>;

export const DispositionRecommendationSchema = z.object({
  disposition: SellingDispositionSchema,
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(z.string()).min(1),
  reasonText: z.string().min(1),
  recommendedBy: DispositionRecommendedBySchema.default("RULE"),
  ruleOrModelVersion: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type DispositionRecommendation = z.infer<typeof DispositionRecommendationSchema>;

export const PricingQuoteSchema = z.object({
  strategy: PricingStrategySchema,
  currentFmv: FmvSnapshotSchema,
  recommendedListPrice: z.number().positive(),
  minimumAcceptablePrice: z.number().positive(),
  multiplierLow: z.number().positive(),
  multiplierHigh: z.number().positive(),
  estimatedFee: z.number().nonnegative().nullable(),
  estimatedNet: z.number().nullable(),
  feeIsEstimate: z.literal(true),
  currency: z.string().length(3).default("USD"),
  provenance: ProvenanceSchema,
});
export type PricingQuote = z.infer<typeof PricingQuoteSchema>;

export const SellingAssetInputSchema = z.object({
  inventoryId: z.string().min(1),
  holdingUuid: z.string().uuid().nullable().optional(),
  sourceRowId: z.string().min(1),
  sku: z.string().min(1).optional(),
  category: CategoryKindSchema,
  sport: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  playerSubject: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  parallel: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  rookieFlag: z.boolean().default(false),
  autographFlag: z.boolean().default(false),
  relicFlag: z.boolean().default(false),
  grader: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  gradeNumeric: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  costBasis: z.number().nonnegative().nullable().optional(),
  fmv: FmvSnapshotSchema.nullable(),
  frontImageUri: z.string().nullable().optional(),
  backImageUri: z.string().nullable().optional(),
  storageLocation: z.string().nullable().optional(),
  ownershipBucket: InventoryBucketSchema,
  currentDisposition: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    SellingDispositionSchema.nullable().optional(),
  ),
  salesPathState: z.preprocess(
    (v) => (v === "" || v == null ? "available" : v),
    SalesPathStateSchema.default("available"),
  ),
  quantity: z.number().int().positive().default(1),
  playerTier: z.enum(["star", "starter", "role", "unknown"]).default("unknown"),
  parallelScarce: z.boolean().default(false),
  strongPlayerDemand: z.boolean().default(false),
  strongSearchability: z.boolean().default(false),
  saleVelocity: z.enum(["hot", "normal", "stale", "unknown"]).default("unknown"),
  marketTrend: z.enum(["up", "flat", "down", "unknown"]).default("unknown"),
  pcThesis: z.boolean().default(false),
  holdThesis: z.boolean().default(false),
  gradeThesis: z.boolean().default(false),
  daysInInventory: z.number().nonnegative().nullable().optional(),
  relatedLotCount: z.number().int().nonnegative().default(0),
});
export type SellingAssetInput = z.infer<typeof SellingAssetInputSchema>;

export const LotProposalSchema = z.object({
  lotName: z.string().min(1),
  groupingKey: z.string().min(1),
  inventoryIds: z.array(z.string().min(1)).min(2),
  combinedFmv: z.number().nonnegative(),
  recommendedPrice: z.number().positive(),
  estimatedNet: z.number(),
  estimatedLaborMinutes: z.number().nonnegative(),
  netDollarsPerLaborMinute: z.number(),
  confidence: z.number().min(0).max(1),
  lotScore: z.number(),
  currency: z.string().length(3).default("USD"),
  reasonCodes: z.array(z.string()).default([]),
  provenance: ProvenanceSchema,
});
export type LotProposal = z.infer<typeof LotProposalSchema>;

export const ListingDraftPayloadSchema = z.object({
  sku: z.string().min(1).max(50),
  title: z.string().min(1).max(80),
  description: z.string().min(1),
  categoryId: z.string().min(1),
  format: ListingFormatSchema,
  condition: z.string().min(1),
  imageUrls: z.array(z.string().min(1)).default([]),
  aspects: z.record(z.array(z.string())).default({}),
  marketplaceId: z.string().min(1).default("EBAY_US"),
  quantity: z.number().int().positive().default(1),
  recommendedListPrice: z.number().positive().nullable(),
  minimumAcceptablePrice: z.number().positive().nullable(),
  currency: z.string().length(3).default("USD"),
  publishBlockedReasons: z.array(z.string()).default([]),
});
export type ListingDraftPayload = z.infer<typeof ListingDraftPayloadSchema>;

export const MarketplaceListingSchema = z.object({
  id: z.string().uuid(),
  inventoryId: z.string().min(1),
  holdingUuid: z.string().uuid().nullable().optional(),
  lotId: z.string().uuid().nullable().optional(),
  marketplace: z.literal("ebay"),
  sku: z.string().min(1),
  listingKind: z.enum(["single", "lot"]),
  externalOfferId: z.string().nullable(),
  externalListingId: z.string().nullable(),
  listingFormat: ListingFormatSchema,
  status: MarketplaceListingStatusSchema,
  title: z.string().min(1),
  categoryId: z.string().nullable(),
  price: z.number().positive().nullable(),
  minimumOfferPrice: z.number().positive().nullable(),
  quantity: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  paymentPolicyId: z.string().nullable(),
  returnPolicyId: z.string().nullable(),
  fulfillmentPolicyId: z.string().nullable(),
  merchantLocationKey: z.string().nullable(),
  promoted: z.boolean().default(false),
  promotionRate: z.number().nonnegative().nullable().optional(),
  pricingStrategy: PricingStrategySchema.nullable().optional(),
  fmvAtListing: FmvSnapshotSchema.nullable(),
  listedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  lastSyncedAt: z.coerce.date().nullable(),
  errorClass: z.enum(["retryable", "non_retryable"]).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  provenance: ProvenanceSchema,
});
export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;

export const ListingMetricSnapshotSchema = z.object({
  id: z.string().uuid(),
  marketplaceListingId: z.string().uuid(),
  capturedAt: z.coerce.date(),
  impressionsSearch: z.number().nonnegative().nullable(),
  impressionsStore: z.number().nonnegative().nullable(),
  impressionsTotal: z.number().nonnegative().nullable(),
  viewsTotal: z.number().nonnegative().nullable(),
  viewsSearch: z.number().nonnegative().nullable(),
  viewsStore: z.number().nonnegative().nullable(),
  viewsDirect: z.number().nonnegative().nullable(),
  viewsOffEbay: z.number().nonnegative().nullable(),
  watcherCount: z.number().int().nonnegative().nullable(),
  offerCount: z.number().int().nonnegative().nullable(),
  dataSource: z.string().min(1),
  windowStart: z.coerce.date().nullable().optional(),
  windowEnd: z.coerce.date().nullable().optional(),
});
export type ListingMetricSnapshot = z.infer<typeof ListingMetricSnapshotSchema>;

export const MarketplaceOrderSchema = z.object({
  id: z.string().uuid(),
  marketplace: z.literal("ebay"),
  externalOrderId: z.string().min(1),
  orderCreatedAt: z.coerce.date(),
  orderStatus: z.string().min(1),
  buyerReference: z.string().nullable(),
  grossTotal: z.number().nonnegative(),
  shippingCollected: z.number().nonnegative().nullable(),
  taxAmount: z.number().nonnegative().nullable(),
  currency: z.string().length(3).default("USD"),
  fulfillmentStatus: z.string().nullable(),
  shippedAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  lastSyncedAt: z.coerce.date().nullable(),
});
export type MarketplaceOrder = z.infer<typeof MarketplaceOrderSchema>;

export const MarketplaceOrderLineSchema = z.object({
  id: z.string().uuid(),
  marketplaceOrderId: z.string().uuid(),
  inventoryId: z.string().nullable(),
  sku: z.string().min(1),
  externalLineItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  salePrice: z.number().nonnegative(),
  shippingAllocated: z.number().nonnegative().nullable(),
  feeAllocated: z.number().nullable(),
  promotionFeeAllocated: z.number().nullable(),
  netProceeds: z.number().nullable(),
  feeIsEstimate: z.boolean().default(true),
});
export type MarketplaceOrderLine = z.infer<typeof MarketplaceOrderLineSchema>;

export const MarketObservationSchema = z.object({
  id: z.string().uuid(),
  inventoryId: z.string().min(1),
  observationType: ObservationTypeSchema,
  observedAt: z.coerce.date(),
  value: z.number(),
  currency: z.string().length(3).default("USD"),
  source: z.string().min(1),
  marketplaceListingId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).default({}),
  provenance: ProvenanceSchema,
});
export type MarketObservation = z.infer<typeof MarketObservationSchema>;

export const DispositionHistorySchema = z.object({
  id: z.string().uuid(),
  inventoryId: z.string().min(1),
  previousDisposition: SellingDispositionSchema.nullable(),
  newDisposition: SellingDispositionSchema,
  reasonCode: z.string().min(1),
  reasonText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  recommendedBy: DispositionRecommendedBySchema,
  createdAt: z.coerce.date(),
});
export type DispositionHistory = z.infer<typeof DispositionHistorySchema>;

export const DailyQueueItemSchema = z.object({
  inventoryId: z.string().min(1),
  lotId: z.string().uuid().nullable().optional(),
  priorityScore: z.number(),
  bucket: z.enum(["high_liquidity", "event_trending", "stale", "scarce", "experiment"]),
  recommendedFormat: ListingFormatSchema,
  recommendedPrice: z.number().positive().nullable(),
  minimumPrice: z.number().positive().nullable(),
  pricingStrategy: PricingStrategySchema,
  estimatedNet: z.number().nullable(),
  estimatedLaborMinutes: z.number().nonnegative(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  disposition: SellingDispositionSchema,
});
export type DailyQueueItem = z.infer<typeof DailyQueueItemSchema>;

export const MarketEventSchema = z.object({
  eventId: z.string().min(1),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  eventType: z.string().min(1),
  eventTime: z.coerce.date(),
  severity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1),
  summary: z.string().min(1),
  expiresAt: z.coerce.date().nullable(),
});
export type MarketEvent = z.infer<typeof MarketEventSchema>;

export const ExperimentSchema = z.object({
  experimentId: z.string().min(1),
  name: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable(),
  hypothesis: z.string().min(1),
  cohortDefinition: z.record(z.unknown()),
  strategy: z.string().min(1),
  status: ExperimentStatusSchema,
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const ExperimentCohortResultSchema = z.object({
  cohortId: z.string().min(1),
  label: z.string().min(1),
  n: z.number().int().nonnegative(),
  revenuePerCard: z.number().nullable(),
  netPerCard: z.number().nullable(),
  sellThrough: z.number().min(0).max(1).nullable(),
  daysToSale: z.number().nullable(),
  laborMinutesPerCard: z.number().nullable(),
  netPerLaborMinute: z.number().nullable(),
  shippingBurden: z.number().nullable(),
  uncertainty: z.enum(["insufficient_sample", "low", "medium", "high"]),
});
export type ExperimentCohortResult = z.infer<typeof ExperimentCohortResultSchema>;

export const EbayEnvironmentSchema = z.enum(["sandbox", "production"]);
export type EbayEnvironment = z.infer<typeof EbayEnvironmentSchema>;

export const EbaySellAuthStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  environment: EbayEnvironmentSchema,
  marketplaceId: z.string(),
  hasRefreshToken: z.boolean(),
  tokenExpiresAt: z.coerce.date().nullable(),
  scopes: z.array(z.string()),
  policiesConfigured: z.boolean(),
  merchantLocationKey: z.string().nullable(),
  lastError: z.string().nullable(),
  mode: z.enum(["user_oauth", "idle"]),
});
export type EbaySellAuthStatus = z.infer<typeof EbaySellAuthStatusSchema>;

export const EbayApiErrorClassSchema = z.enum(["retryable", "non_retryable"]);
export type EbayApiErrorClass = z.infer<typeof EbayApiErrorClassSchema>;

export const EbayApiResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  errorClass: EbayApiErrorClassSchema.nullable(),
  errorMessage: z.string().nullable(),
  body: z.unknown().optional(),
});
export type EbayApiResult = z.infer<typeof EbayApiResultSchema>;

export const BusinessPoliciesSchema = z.object({
  paymentPolicyId: z.string().min(1),
  returnPolicyId: z.string().min(1),
  fulfillmentPolicyId: z.string().min(1),
  merchantLocationKey: z.string().min(1),
});
export type BusinessPolicies = z.infer<typeof BusinessPoliciesSchema>;

export const SaleCompletionInputSchema = z.object({
  inventoryId: z.string().min(1),
  sku: z.string().min(1),
  listing: MarketplaceListingSchema,
  actualSalePrice: z.number().nonnegative(),
  soldAt: z.coerce.date(),
  shippingAllocated: z.number().nonnegative().nullable().optional(),
  feeAllocated: z.number().nullable().optional(),
  feeIsEstimate: z.boolean().default(true),
  currency: z.string().length(3).default("USD"),
  externalOrderId: z.string().min(1),
  externalLineItemId: z.string().min(1),
});
export type SaleCompletionInput = z.infer<typeof SaleCompletionInputSchema>;

export const SaleCompletionResultSchema = z.object({
  inventoryId: z.string(),
  sku: z.string(),
  salesPathState: z.literal("sold"),
  listingStatus: z.literal("SOLD"),
  actualSalePrice: z.number(),
  fmvAtListing: FmvSnapshotSchema.nullable(),
  fmvErrorPct: z.number().nullable(),
  daysToSale: z.number().nullable(),
  netProceeds: z.number().nullable(),
  feeIsEstimate: z.boolean(),
  observation: MarketObservationSchema,
});
export type SaleCompletionResult = z.infer<typeof SaleCompletionResultSchema>;

export const ConnectionHealthSchema = z.object({
  status: EbaySellAuthStatusSchema,
  canPublish: z.boolean(),
  blockers: z.array(z.string()),
});
export type ConnectionHealth = z.infer<typeof ConnectionHealthSchema>;
