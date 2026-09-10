import { describe, expect, it } from "vitest";
import { evaluateExperiment, LOW_DOLLAR_EXPERIMENT } from "./experiments.js";

describe("experiment framework", () => {
  it("does not declare a winner on a tiny sample", () => {
    const { results, declaredWinner, note } = evaluateExperiment([
      {
        cohortId: "A",
        label: "individual singles",
        cards: 12,
        sold: 3,
        revenue: 24,
        net: 14,
        daysToSaleSum: 30,
        daysToSaleN: 3,
        laborMinutes: 48,
        shippingCost: 18,
      },
      {
        cohortId: "B",
        label: "player lots",
        cards: 15,
        sold: 4,
        revenue: 28,
        net: 18,
        daysToSaleSum: 40,
        daysToSaleN: 4,
        laborMinutes: 30,
        shippingCost: 12,
      },
    ]);
    expect(declaredWinner).toBeNull();
    expect(results.every((r) => r.uncertainty === "insufficient_sample")).toBe(true);
    expect(note).toMatch(/Insufficient sample/);
    expect(LOW_DOLLAR_EXPERIMENT.cohortDefinition.targetN).toBe(300);
  });
});
