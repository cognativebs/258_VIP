import type { UserConstraints } from "@vip/core-model";
import {
  DEFAULT_RULE_CONFIG,
  ENGINE_VERSION,
  TargetPriceResultSchema,
  type MarketRangeResult,
  type RuleConfig,
  type TargetPriceResult,
} from "./types.js";

export interface TargetPriceInput {
  range: MarketRangeResult | null;
  constraints: UserConstraints;
  config?: Partial<RuleConfig>;
}

/**
 * Target ask / max buy from range + user constraints. Nulls when evidence is insufficient.
 */
export function targetPrice(input: TargetPriceInput): TargetPriceResult {
  const cfg = { ...DEFAULT_RULE_CONFIG, ...input.config };
  const notes: string[] = [];
  const range = input.range;

  if (!range || range.matchedSales === 0) {
    return TargetPriceResultSchema.parse({
      targetAsk: null,
      maxBuy: null,
      basis: "insufficient_evidence",
      notes: ["No matched sales in window — cannot form a target without inventing a price."],
      ruleOrModelVersion: ENGINE_VERSION,
    });
  }

  let maxBuy = range.low * (1 - cfg.buyUnderLowBufferPct);
  let basis: TargetPriceResult["basis"] = "range_low";
  notes.push(`Max buy anchored to range low $${range.low} with ${cfg.buyUnderLowBufferPct * 100}% buffer.`);

  const premiumCap =
    input.constraints.riskTolerance === "high"
      ? cfg.highRiskMaxAskPremiumPct
      : input.constraints.riskTolerance === "low"
        ? cfg.lowRiskMaxAskPremiumPct
        : (cfg.lowRiskMaxAskPremiumPct + cfg.highRiskMaxAskPremiumPct) / 2;

  const premiumTol = input.constraints.premiumTolerance ?? premiumCap;
  const ceiling = range.high * (1 + premiumTol);
  if (maxBuy > ceiling) {
    maxBuy = ceiling;
    basis = "constrained";
    notes.push("Max buy capped by premiumTolerance / risk.");
  }

  if (input.constraints.budget != null && maxBuy > input.constraints.budget) {
    maxBuy = input.constraints.budget;
    basis = "constrained";
    notes.push(`Max buy capped by budget $${input.constraints.budget}.`);
  }

  const targetAsk = range.mid ?? (range.low + range.high) / 2;

  return TargetPriceResultSchema.parse({
    targetAsk: Number(targetAsk.toFixed(2)),
    maxBuy: Number(Math.max(0, maxBuy).toFixed(2)),
    basis,
    notes,
    ruleOrModelVersion: ENGINE_VERSION,
  });
}
