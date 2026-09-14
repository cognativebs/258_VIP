export { DEALER_KIT_VERSION, PRICECHARTING_ADAPTER_VERSION, FLIP_SCORE_VERSION } from "./version.js";

export {
  DealerCategorySchema,
  FlipActionSchema,
  FlipCompSchema,
  FlipDealInputSchema,
  FlipDealResultSchema,
  GraderSchema,
  ServiceLaneSchema,
  GradeKeySchema,
  BreakEvenInputSchema,
  BreakEvenResultSchema,
  PriceChartingProductSchema,
  StoreSkuSchema,
  StoreSkuStatusSchema,
  type DealerCategory,
  type FlipAction,
  type FlipComp,
  type FlipDealInput,
  type FlipDealResult,
  type Grader,
  type ServiceLane,
  type GradeKey,
  type GradingFeeTier,
  type BreakEvenInput,
  type BreakEvenResult,
  type PriceChartingProduct,
  type StoreSku,
  type StoreSkuStatus,
} from "./schemas.js";

export { centsToDollars, dollarsToCents, roundMoney } from "./cents.js";
export {
  PRICECHARTING_TOKEN_ENV,
  pricechartingTokenFromEnv,
  hostForCategory,
  parsePriceChartingProduct,
  lookupPriceCharting,
  conditionMapToSyntheticComps,
  type PriceChartingLookup,
} from "./pricecharting.js";

export { scoreFlipDeal, howToReadFlipScore, FLIP_SCORE_RUBRIC } from "./flip-score.js";
export { GRADING_FEE_AS_OF, GRADING_FEE_TIERS, listTiers, resolveTier } from "./grading-fees.js";
export { GRADE_KEYS, minSaleToBreakEven, evaluateBreakEven } from "./grading-breakeven.js";
export { populationRedFlags, POP_RED_FLAG_GUIDE } from "./pop-red-flags.js";
export {
  COMP_SOURCES,
  COMP_RED_FLAGS,
  COMP_CHECK_STEPS,
  COMP_CHECK_META,
} from "./comp-check.js";
export {
  CATEGORY_MARGIN_TARGETS,
  SEASONAL_NOTES,
  DEAD_STOCK_WORKFLOW,
  SAMPLE_STORE_SKUS,
  SEALED_PRICING_RULES,
  scoreStoreSku,
  scoreStoreBook,
} from "./store-inventory.js";
export { FLIP_EXAMPLES, runFlipExamples, type FlipExample } from "./examples.js";
export {
  toCsv,
  flipExamplesCsv,
  gradingFeesCsv,
  popRedFlagsCsv,
  storeSampleCsv,
  notionFlipTemplate,
  notionStoreBase,
  gradingCalculatorXml,
  flipScoreGuideHtml,
  compCheckDeskHtml,
  compCheckFieldHtml,
  sealedPricingHtml,
  courseSyllabusMd,
  walkthroughScriptMd,
} from "./exports.js";
