import { evaluateGrading } from "@vip/intelligence";
import { markInferred } from "@vip/evidence";
import { roundMoney } from "./cents.js";
import { resolveTier } from "./grading-fees.js";
import { populationRedFlags } from "./pop-red-flags.js";
import {
  BreakEvenInputSchema,
  BreakEvenResultSchema,
  type BreakEvenInput,
  type BreakEvenResult,
  type GradeBreakEvenRow,
  type GradeKey,
} from "./schemas.js";
import { GRADING_BREEKEVEN_VERSION } from "./version.js";

export const GRADE_KEYS: GradeKey[] = ["7", "8", "9", "9.5", "10"];

/** Sale price that nets to zero after selling fees. */
export function minSaleToBreakEven(allInBeforeSale: number, sellingFeePct: number): number {
  const denom = 1 - sellingFeePct;
  if (denom <= 0) throw new Error("sellingFeePct must be < 1");
  return roundMoney(allInBeforeSale / denom);
}

export function evaluateBreakEven(raw: BreakEvenInput): BreakEvenResult {
  const input = BreakEvenInputSchema.parse(raw);
  const tier = resolveTier({
    grader: input.grader,
    category: input.category,
    tierId: input.tierId,
    lane: input.lane,
    includePaused: true,
  });

  const allInBeforeSale = roundMoney(
    input.rawCost + tier.feeUsd + input.shippingCost + input.insuranceCost + input.opportunityCost,
  );

  const byGrade = new Map(input.gradeValues.map((g) => [g.grade, g]));
  const rows: GradeBreakEvenRow[] = GRADE_KEYS.map((grade) => {
    const minSale = minSaleToBreakEven(allInBeforeSale, input.sellingFeePct);
    const mv = byGrade.get(grade)?.marketValue ?? null;
    if (mv == null) {
      return {
        grade,
        minSaleToBreakEven: minSale,
        marketValue: null,
        expectedNet: null,
        roiPct: null,
        coversCosts: null,
      };
    }
    const expectedNet = roundMoney(mv * (1 - input.sellingFeePct) - allInBeforeSale);
    return {
      grade,
      minSaleToBreakEven: minSale,
      marketValue: mv,
      expectedNet,
      roiPct: allInBeforeSale > 0 ? roundMoney(expectedNet / allInBeforeSale) : null,
      coversCosts: expectedNet >= 0,
    };
  });

  const g7 = byGrade.get("7");
  const g8 = byGrade.get("8");
  const g9 = byGrade.get("9");
  const g10 = byGrade.get("10");
  const hasBands = g9?.marketValue != null && g10?.marketValue != null;

  let expectedIncrementalProfit: number | null = null;
  let recommendation: BreakEvenResult["recommendation"] = "inspect_further";

  if (hasBands) {
    const ev = evaluateGrading({
      holdingId: "00000000-0000-4000-8000-00000000be01",
      evaluatedAt: new Date("2026-09-13T00:00:00Z"),
      rawValue: input.rawCost,
      psa7: { probability: g7?.probability ?? 0.1, value: g7?.marketValue ?? input.rawCost },
      psa8: { probability: g8?.probability ?? 0.25, value: g8?.marketValue ?? input.rawCost },
      psa9: { probability: g9?.probability ?? 0.45, value: g9!.marketValue! },
      psa10: { probability: g10?.probability ?? 0.2, value: g10!.marketValue! },
      gradingCost: tier.feeUsd,
      shippingCost: input.shippingCost,
      insuranceCost: input.insuranceCost,
      sellingExpensePct: input.sellingFeePct,
      opportunityCost: input.opportunityCost,
      graderRouting: input.grader,
    });
    expectedIncrementalProfit = ev.expectedIncrementalProfit;
    recommendation = ev.recommendation;
  }

  const popRedFlags = populationRedFlags({
    category: input.category,
    gradeValues: input.gradeValues,
  });
  if (tier.status === "paused") {
    popRedFlags.unshift(`TIER_PAUSED — ${tier.name} is not currently accepting submissions. Model only.`);
  }
  if (tier.maxInsuredValueUsd != null && rows.some((r) => (r.marketValue ?? 0) > tier.maxInsuredValueUsd!)) {
    popRedFlags.push(
      `MIV_CAP — at least one grade value exceeds this tier's $${tier.maxInsuredValueUsd} insured cap. You will be upcharged or bounced.`,
    );
  }

  return BreakEvenResultSchema.parse({
    grader: input.grader,
    tier,
    rawCost: input.rawCost,
    allInBeforeSale,
    sellingFeePct: input.sellingFeePct,
    rows,
    expectedIncrementalProfit,
    recommendation,
    popRedFlags,
    provenance: markInferred({
      source: "grading_breakeven",
      ruleOrModelVersion: GRADING_BREEKEVEN_VERSION,
      confidence: hasBands ? 0.6 : 0.35,
      notes: `Fee schedule snapshot ${tier.id} · confirm at grader checkout. Break-even is a floor, not a forecast.`,
    }),
  });
}
