import {
  ENGINE_VERSION,
  LiquidityResultSchema,
  type LiquidityResult,
  type SaleComp,
} from "./types.js";

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

export interface LiquidityInput {
  sales: SaleComp[];
  asOf?: Date;
  windowDays?: number;
}

export function liquidity(input: LiquidityInput): LiquidityResult {
  const asOf = input.asOf ?? new Date();
  const windowDays = input.windowDays ?? 90;
  const inWindow = input.sales.filter((s) => daysBetween(asOf, s.saleDate) <= windowDays);
  const matchedSales = inWindow.length;
  const months = Math.max(windowDays / 30, 1 / 30);
  const salesPerMonth = matchedSales / months;

  // Score 0–100 from velocity; thin markets stay honest.
  let score = Math.min(100, salesPerMonth * 25);
  if (matchedSales === 0) score = 0;
  else if (matchedSales === 1) score = Math.min(score, 20);
  else if (matchedSales === 2) score = Math.min(score, 40);

  const band =
    score >= 70 ? "fast" : score >= 40 ? "medium" : score >= 15 ? "slow" : "illiquid";

  const confidence =
    matchedSales === 0 ? 0 : matchedSales === 1 ? 0.25 : matchedSales === 2 ? 0.4 : Math.min(0.85, 0.35 + matchedSales * 0.08);

  return LiquidityResultSchema.parse({
    score: Number(score.toFixed(1)),
    band,
    salesPerMonth: Number(salesPerMonth.toFixed(2)),
    matchedSales,
    confidence: Number(confidence.toFixed(3)),
    ruleOrModelVersion: ENGINE_VERSION,
  });
}
