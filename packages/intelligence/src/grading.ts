import { randomUUID } from "node:crypto";
import { markInferred } from "@vip/evidence";
import { clamp, round2 } from "./math.js";
import {
  GradingEvaluationSchema,
  type GradingEvaluation,
  type GradingRecommendation,
} from "./schemas.js";
import { INTELLIGENCE_VERSION } from "./version.js";

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingError";
  }
}

export type GradeBandInput = {
  probability?: number | null;
  value?: number | null;
};

export type GradingInput = {
  id?: string;
  holdingId: string;
  evaluatedAt: Date;
  rawValue: number;
  psa7?: GradeBandInput;
  psa8?: GradeBandInput;
  psa9?: GradeBandInput;
  psa10?: GradeBandInput;
  gradingCost: number;
  shippingCost?: number;
  insuranceCost?: number;
  sellingExpensePct?: number;
  opportunityCost?: number;
  graderRouting?: string | null;
  notes?: string | null;
};

function bandContribution(band?: GradeBandInput): number {
  if (band?.probability == null || band.value == null) return 0;
  return band.probability * band.value;
}

function bandComplete(band?: GradeBandInput): boolean {
  return band?.probability != null && band.value != null;
}

export function expectedGradingValue(input: GradingInput): number {
  return round2(
    bandContribution(input.psa7) +
      bandContribution(input.psa8) +
      bandContribution(input.psa9) +
      bandContribution(input.psa10),
  );
}

/**
 * Fee/opportunity-cost order of operations stays visible:
 *   netAfterFees = expectedGradingValue * (1 - sellingExpensePct)
 *   profit = netAfterFees - raw - grading - shipping - insurance - opportunity
 */
export function expectedIncrementalProfit(
  ev: number,
  input: Pick<
    GradingInput,
    | "rawValue"
    | "gradingCost"
    | "shippingCost"
    | "insuranceCost"
    | "sellingExpensePct"
    | "opportunityCost"
  >,
): {
  expectedGradingValue: number;
  netAfterFees: number;
  rawValue: number;
  gradingCost: number;
  shippingCost: number;
  insuranceCost: number;
  opportunityCost: number;
  sellingExpensePct: number;
  expectedIncrementalProfit: number;
} {
  const sellingExpensePct = input.sellingExpensePct ?? 0.13;
  const shippingCost = input.shippingCost ?? 0;
  const insuranceCost = input.insuranceCost ?? 0;
  const opportunityCost = input.opportunityCost ?? 0;
  const netAfterFees = round2(ev * (1 - sellingExpensePct));
  const profit = round2(
    netAfterFees -
      input.rawValue -
      input.gradingCost -
      shippingCost -
      insuranceCost -
      opportunityCost,
  );
  return {
    expectedGradingValue: ev,
    netAfterFees,
    rawValue: input.rawValue,
    gradingCost: input.gradingCost,
    shippingCost,
    insuranceCost,
    opportunityCost,
    sellingExpensePct,
    expectedIncrementalProfit: profit,
  };
}

export function gradingOpportunityScore(profit: number, rawValue: number): number {
  const denom = Math.max(rawValue, 1);
  return round2(clamp(50 + (profit / denom) * 50, 0, 100));
}

export function recommendGrading(
  input: GradingInput,
  terms: ReturnType<typeof expectedIncrementalProfit>,
): GradingRecommendation {
  if (!bandComplete(input.psa9) || !bandComplete(input.psa10)) {
    return "inspect_further";
  }
  const score = gradingOpportunityScore(terms.expectedIncrementalProfit, input.rawValue);
  if (terms.expectedIncrementalProfit > 0 && score >= 55) return "grade";
  const exitCost = input.gradingCost + (input.shippingCost ?? 0);
  if (terms.expectedIncrementalProfit < 0 && Math.abs(terms.expectedIncrementalProfit) >= exitCost) {
    return "sell_raw";
  }
  return "hold_raw";
}

export function evaluateGrading(input: GradingInput): GradingEvaluation {
  const ev = expectedGradingValue(input);
  const terms = expectedIncrementalProfit(ev, input);
  const recommendation = recommendGrading(input, terms);
  const score = gradingOpportunityScore(terms.expectedIncrementalProfit, input.rawValue);
  return GradingEvaluationSchema.parse({
    id: input.id ?? randomUUID(),
    holdingId: input.holdingId,
    evaluatedAt: input.evaluatedAt,
    rawValue: input.rawValue,
    psa7Probability: input.psa7?.probability ?? null,
    psa7Value: input.psa7?.value ?? null,
    psa8Probability: input.psa8?.probability ?? null,
    psa8Value: input.psa8?.value ?? null,
    psa9Probability: input.psa9?.probability ?? null,
    psa9Value: input.psa9?.value ?? null,
    psa10Probability: input.psa10?.probability ?? null,
    psa10Value: input.psa10?.value ?? null,
    gradingCost: input.gradingCost,
    shippingCost: terms.shippingCost,
    insuranceCost: terms.insuranceCost,
    sellingExpensePct: terms.sellingExpensePct,
    opportunityCost: terms.opportunityCost,
    expectedGradingValue: terms.expectedGradingValue,
    expectedIncrementalProfit: terms.expectedIncrementalProfit,
    gradingOpportunityScore: score,
    recommendation,
    graderRouting: input.graderRouting ?? "PSA",
    notes: input.notes ?? null,
    provenance: markInferred({
      source: "grading_optimizer",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: recommendation === "inspect_further" ? 0.3 : 0.65,
      notes: "PSA-tier inputs are manual · unverified unless a pop report is attached",
    }),
  });
}
