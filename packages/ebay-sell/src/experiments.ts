import { EXPERIMENT_RULE } from "./constants.js";
import { roundMoney } from "./pricing.js";
import type { ExperimentCohortResult } from "./schemas.js";

export const LOW_DOLLAR_EXPERIMENT = {
  experimentId: "low-dollar-1-5-v1",
  name: "Low-dollar $1–$5 singles vs lots",
  hypothesis:
    "For comparable $1–$5 cards, player/theme lots beat singles on net dollars per labor minute without a large revenue/card loss.",
  strategy: "compare_singles_player_lots_theme_lots",
  cohortDefinition: {
    fmvMin: 1,
    fmvMax: 5,
    targetN: 300,
    cohorts: ["individual_singles", "player_lots", "team_set_theme_lots"],
  },
} as const;

export type CohortObservation = {
  cohortId: string;
  label: string;
  cards: number;
  sold: number;
  revenue: number;
  net: number;
  daysToSaleSum: number;
  daysToSaleN: number;
  laborMinutes: number;
  shippingCost: number;
};

/**
 * Evaluate experiment cohorts. Never auto-declares a winner on a tiny sample.
 */
export function evaluateExperiment(obs: CohortObservation[]): {
  results: ExperimentCohortResult[];
  declaredWinner: string | null;
  note: string;
  ruleOrModelVersion: string;
} {
  const results = obs.map(toResult);
  const ready = results.filter((r) => r.uncertainty !== "insufficient_sample");
  if (ready.length < 2) {
    return {
      results,
      declaredWinner: null,
      note: "Insufficient sample — display counts and uncertainty. Do not declare a winner.",
      ruleOrModelVersion: EXPERIMENT_RULE,
    };
  }
  return {
    results,
    declaredWinner: null,
    note: "Enough to compare directionally. Winner stays undeclared until sample + confidence support it.",
    ruleOrModelVersion: EXPERIMENT_RULE,
  };
}

function toResult(o: CohortObservation): ExperimentCohortResult {
  const n = o.cards;
  const uncertainty =
    n < 30 ? "insufficient_sample" : n < 80 ? "high" : n < 150 ? "medium" : "low";
  return {
    cohortId: o.cohortId,
    label: o.label,
    n,
    revenuePerCard: n ? roundMoney(o.revenue / n) : null,
    netPerCard: n ? roundMoney(o.net / n) : null,
    sellThrough: n ? Number((o.sold / n).toFixed(3)) : null,
    daysToSale: o.daysToSaleN ? roundMoney(o.daysToSaleSum / o.daysToSaleN) : null,
    laborMinutesPerCard: n ? roundMoney(o.laborMinutes / n) : null,
    netPerLaborMinute: o.laborMinutes ? roundMoney(o.net / o.laborMinutes) : null,
    shippingBurden: n ? roundMoney(o.shippingCost / n) : null,
    uncertainty,
  };
}
