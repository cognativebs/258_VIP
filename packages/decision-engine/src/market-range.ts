import {
  ENGINE_VERSION,
  MarketRangeResultSchema,
  type MarketRangeInput,
  type MarketRangeResult,
  type SaleComp,
} from "./types.js";

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
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

function filterWindow(sales: SaleComp[], asOf: Date, windowDays: number): SaleComp[] {
  return sales.filter((s) => daysBetween(asOf, s.saleDate) <= windowDays);
}

/**
 * Evidence-backed market range. Never returns a lone point as the user-facing fact.
 */
export function marketRange(input: MarketRangeInput): MarketRangeResult {
  const asOf = input.asOf ?? new Date();
  const windowDays = input.windowDays ?? 90;
  const inWindow = filterWindow(input.sales, asOf, windowDays);
  const prices = inWindow.map((s) => s.price).sort((a, b) => a - b);
  const matchedSales = prices.length;

  if (matchedSales === 0) {
    return MarketRangeResultSchema.parse({
      low: 0,
      high: 0,
      mid: undefined,
      matchedSales: 0,
      recencyDays: null,
      confidence: 0,
      confidenceBand: "low",
      windowDays,
      evidenceIds: [],
      ruleOrModelVersion: ENGINE_VERSION,
    });
  }

  const low = percentile(prices, 0.25);
  const high = percentile(prices, 0.75);
  const mid = percentile(prices, 0.5);
  const newest = inWindow.reduce((a, b) => (a.saleDate > b.saleDate ? a : b));
  const recencyDays = daysBetween(asOf, newest.saleDate);

  // Confidence grows with sample size and decays with staleness — capped, never overstated.
  const sampleFactor = Math.min(1, matchedSales / 8);
  const recencyFactor = recencyDays <= 14 ? 1 : recencyDays <= 45 ? 0.75 : 0.45;
  const spread = high > 0 ? (high - low) / high : 1;
  const tightFactor = spread <= 0.25 ? 1 : spread <= 0.5 ? 0.8 : 0.55;
  const confidence = Math.max(
    0.05,
    Math.min(0.95, 0.25 + 0.45 * sampleFactor + 0.2 * recencyFactor + 0.1 * tightFactor),
  );
  const confidenceBand = confidence >= 0.7 ? "high" : confidence >= 0.45 ? "medium" : "low";

  return MarketRangeResultSchema.parse({
    low: Number(low.toFixed(2)),
    high: Number(Math.max(high, low).toFixed(2)),
    mid: Number(mid.toFixed(2)),
    matchedSales,
    recencyDays: Number(recencyDays.toFixed(1)),
    confidence: Number(confidence.toFixed(3)),
    confidenceBand,
    windowDays,
    evidenceIds: inWindow.map((s) => s.id),
    ruleOrModelVersion: ENGINE_VERSION,
  });
}
