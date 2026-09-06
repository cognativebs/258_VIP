export const EBAY_SELL_RULE = "ebay-sell@0.1.0";
export const DISPOSITION_RULE = "ebay-disposition@0.1.0";
export const LOT_BUILDER_RULE = "ebay-lot-builder@0.1.0";
export const PRICING_RULE = "ebay-pricing@0.1.0";
export const LISTING_BUILDER_RULE = "ebay-listing-builder@0.1.0";
export const SALE_COMPLETION_RULE = "ebay-sale-completion@0.1.0";
export const LISTING_QUEUE_RANK_RULE = "ebay-listing-queue@0.1.0";
export const EXPERIMENT_RULE = "ebay-experiment@0.1.0";
export const SKU_RULE = "ebay-sku@0.1.0";

/** Official Inventory API SKU length cap. */
export const EBAY_SKU_MAX_LEN = 50;

/** eBay listing title hard limit. */
export const EBAY_TITLE_MAX_LEN = 80;

export const DEFAULT_DAILY_QUEUE_TARGET = 22;
export const DEFAULT_HIGH_VALUE_USD = 50;
export const DEFAULT_MIN_NET_PER_LABOR_MINUTE = 2;
export const DEFAULT_SINGLE_LABOR_MINUTES = 4;
export const DEFAULT_LOT_LABOR_MINUTES = 6;

export const DEFAULT_SELL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
] as const;

export const ACTIVE_LISTING_STATUSES = [
  "APPROVED",
  "EBAY_ITEM_CREATED",
  "EBAY_OFFER_CREATED",
  "PUBLISHED",
  "ACTIVE",
] as const;

export const TERMINAL_LISTING_STATUSES = ["ENDED", "SOLD"] as const;

export const HYPE_WORDS = [
  "investment",
  "invest",
  "grail",
  "holy grail",
  "must have",
  "must-have",
  "rare opportunity",
  "once in a lifetime",
  "guaranteed",
  "gem mint",
  "pop 1",
  "low pop",
  "undervalued",
  "moon",
  "lambo",
] as const;
