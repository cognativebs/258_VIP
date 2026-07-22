import {
  AllInCostResultSchema,
  DEFAULT_RULE_CONFIG,
  ENGINE_VERSION,
  type AllInCostResult,
  type CostLine,
  type RuleConfig,
} from "./types.js";

export interface AllInCostContext {
  /** Optional mid of market range for exit-net sketch (not a point valuation claim). */
  marketMid?: number | null;
  config?: Partial<RuleConfig>;
}

/**
 * All-in acquisition cost: ask + tax + premium + shipping + grading + expected selling fees.
 */
export function allInCost(
  item: Partial<CostLine> & { askPrice: number },
  context: AllInCostContext = {},
): AllInCostResult {
  const cfg = { ...DEFAULT_RULE_CONFIG, ...context.config };
  const askPrice = item.askPrice;
  const tax = item.tax ?? askPrice * cfg.taxRateDefault;
  const buyerPremium = item.buyerPremium ?? askPrice * cfg.premiumRateDefault;
  const shipping = item.shipping ?? cfg.shippingDefault;
  const grading = item.grading ?? cfg.gradingCostDefault;
  const expectedSellingFees =
    item.expectedSellingFees ?? askPrice * cfg.sellingFeeRateDefault;

  const allIn = askPrice + tax + buyerPremium + shipping + grading + expectedSellingFees;
  const mid = context.marketMid;
  const exitNetIfSoldAtMid =
    mid != null && Number.isFinite(mid) ? mid - expectedSellingFees - shipping : null;

  return AllInCostResultSchema.parse({
    askPrice,
    tax,
    buyerPremium,
    shipping,
    grading,
    expectedSellingFees,
    allIn,
    exitNetIfSoldAtMid,
    components: [
      { key: "ask", amount: askPrice, included: true },
      { key: "tax", amount: tax, included: tax > 0 },
      { key: "buyerPremium", amount: buyerPremium, included: buyerPremium > 0 },
      { key: "shipping", amount: shipping, included: shipping > 0 },
      { key: "grading", amount: grading, included: grading > 0 },
      {
        key: "expectedSellingFees",
        amount: expectedSellingFees,
        included: expectedSellingFees > 0,
      },
    ],
    ruleOrModelVersion: ENGINE_VERSION,
  });
}
