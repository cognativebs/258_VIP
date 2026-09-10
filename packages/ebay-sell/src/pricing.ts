import { markInferred } from "@vip/evidence";
import { PRICING_RULE } from "./constants.js";
import type { FmvSnapshot, PricingQuote, PricingStrategy } from "./schemas.js";

const BANDS: Record<Exclude<PricingStrategy, "CUSTOM">, { low: number; high: number }> = {
  LIQUIDATE: { low: 0.9, high: 0.95 },
  NORMAL: { low: 1.0, high: 1.05 },
  BEST_OFFER_TARGET: { low: 1.05, high: 1.15 },
  SCARCE_LOW_POP: { low: 1.15, high: 1.4 },
  RELUCTANT_SELLER: { low: 1.5, high: 1.5 },
};

/** Default marketplace-fee estimate — labeled estimate, never actual. */
export const ESTIMATED_FEE_RATE = 0.1325;

export type PricingInput = {
  fmv: FmvSnapshot;
  strategy: PricingStrategy;
  customMultiplier?: number;
  estimatedFeeRate?: number;
};

export function quotePrice(input: PricingInput): PricingQuote {
  const { fmv, strategy } = input;
  if (fmv.mid <= 0) {
    throw new Error("Cannot price from a non-positive FMV mid");
  }
  const band =
    strategy === "CUSTOM"
      ? {
          low: input.customMultiplier ?? 1,
          high: input.customMultiplier ?? 1,
        }
      : BANDS[strategy];
  const recommendedListPrice = roundMoney(fmv.mid * band.high);
  const minimumAcceptablePrice = roundMoney(fmv.mid * band.low);
  const feeRate = input.estimatedFeeRate ?? ESTIMATED_FEE_RATE;
  const estimatedFee = roundMoney(recommendedListPrice * feeRate);
  const estimatedNet = roundMoney(recommendedListPrice - estimatedFee);
  return {
    strategy,
    currentFmv: fmv,
    recommendedListPrice,
    minimumAcceptablePrice,
    multiplierLow: band.low,
    multiplierHigh: band.high,
    estimatedFee,
    estimatedNet,
    feeIsEstimate: true,
    currency: fmv.currency,
    provenance: markInferred({
      source: "pricing_engine",
      ruleOrModelVersion: PRICING_RULE,
      confidence: Math.min(0.8, fmv.confidence + 0.05),
      notes: `${strategy} · fees are estimates, not final actuals`,
    }),
  };
}

export function pickDefaultStrategy(input: {
  fmvMid: number;
  scarce?: boolean;
  liquidate?: boolean;
  reluctant?: boolean;
}): PricingStrategy {
  if (input.reluctant) return "RELUCTANT_SELLER";
  if (input.liquidate) return "LIQUIDATE";
  if (input.scarce) return "SCARCE_LOW_POP";
  if (input.fmvMid < 5) return "LIQUIDATE";
  return "NORMAL";
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function netPerLaborMinute(net: number, laborMinutes: number): number {
  if (laborMinutes <= 0) return 0;
  return roundMoney(net / laborMinutes);
}
