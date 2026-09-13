import { recommend } from "@vip/decision-engine";
import { markInferred } from "@vip/evidence";
import { roundMoney } from "./cents.js";
import {
  FlipDealInputSchema,
  FlipDealResultSchema,
  type FlipAction,
  type FlipDealInput,
  type FlipDealResult,
  type FlipScoreBreakdown,
} from "./schemas.js";
import { DEALER_KIT_VERSION, FLIP_SCORE_VERSION } from "./version.js";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function popPoints(popCount: number | null): { pts: number; note: string } {
  if (popCount == null) {
    return { pts: 5, note: "Pop unknown · unverified — mid score, do not assume scarce." };
  }
  if (popCount <= 50) return { pts: 10, note: `Pop ${popCount} is genuinely thin.` };
  if (popCount <= 250) return { pts: 8, note: `Pop ${popCount} is scarce enough to matter.` };
  if (popCount <= 1000) return { pts: 6, note: `Pop ${popCount} is moderate.` };
  if (popCount <= 5000) return { pts: 3, note: `Pop ${popCount} is crowded — gem premiums compress.` };
  return { pts: 0, note: `Pop ${popCount} is a red flag — do not pay a scarcity premium.` };
}

function agePoints(ageYears: number): { pts: number; note: string } {
  if (ageYears >= 30) return { pts: 10, note: `${ageYears}y — established vintage market.` };
  if (ageYears >= 15) return { pts: 7, note: `${ageYears}y — secondary market is mature.` };
  if (ageYears >= 5) return { pts: 4, note: `${ageYears}y — still printing-era risk.` };
  return { pts: 1, note: `${ageYears}y — modern / still-in-print risk. High pop likely.` };
}

/**
 * Stripped IQVault scoring for a single buy/sell decision.
 * Canonical Buy/Hold/Pass still comes from `@vip/decision-engine`.
 * Flip Score is a 0–100 presentation layer (margin, ask, liquidity, pop, age).
 */
export function scoreFlipDeal(raw: FlipDealInput): FlipDealResult {
  const input = FlipDealInputSchema.parse(raw);
  const asOf = input.asOf ?? new Date();
  const assetId = input.assetId ?? input.assetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const sales = input.comps.map((c, i) => ({
    id: c.id ?? `comp-${i}`,
    price: c.price,
    saleDate: c.saleDate,
    source: c.source,
    title: c.title,
  }));

  const rec = recommend({
    assetId,
    assetName: input.assetName,
    askPrice: input.listingPrice,
    sales,
    windowDays: input.windowDays,
    asOf,
    costContext: {
      askPrice: input.listingPrice,
      grading: input.gradingCost,
      shipping: input.shippingCost,
      expectedSellingFees: input.listingPrice * input.sellingFeePct,
    },
    constraints: { collectionGoals: [], riskTolerance: "medium" },
  });

  const range = rec.marketRange;
  const hasRange = range != null && range.matchedSales > 0;
  const targetMid = rec.targetPrice?.targetAsk ?? (hasRange && range.mid != null ? range.mid : null);
  const targetLow = hasRange ? range.low : null;
  const targetHigh = hasRange ? range.high : null;
  const maxBuy = rec.targetPrice?.maxBuy ?? null;

  const buyBasis = roundMoney(input.listingPrice + input.gradingCost + input.shippingCost);
  const expectedExitNet =
    targetMid != null ? roundMoney(targetMid * (1 - input.sellingFeePct)) : null;
  const expectedNetProfit =
    expectedExitNet != null ? roundMoney(expectedExitNet - buyBasis) : null;
  const marginPct =
    expectedNetProfit != null && buyBasis > 0
      ? roundMoney(expectedNetProfit / buyBasis)
      : null;

  const marginPts = marginPct == null ? 0 : clamp(marginPct * 80, 0, 40);
  let askPts = 0;
  if (hasRange) {
    if (input.listingPrice <= range.low * 1.02) askPts = 25;
    else if (input.listingPrice <= range.high * 1.12) askPts = 12;
    else askPts = 0;
  }
  const liquidityPts = clamp((rec.liquidity?.score ?? 0) * 0.15, 0, 15);
  const pop = popPoints(input.popCount);
  const age = agePoints(input.ageYears);

  const breakdown: FlipScoreBreakdown = {
    marginPts: roundMoney(marginPts),
    askPts: roundMoney(askPts),
    liquidityPts: roundMoney(liquidityPts),
    popPts: pop.pts,
    agePts: age.pts,
  };
  const flipScore = roundMoney(
    clamp(
      breakdown.marginPts +
        breakdown.askPts +
        breakdown.liquidityPts +
        breakdown.popPts +
        breakdown.agePts,
      0,
      100,
    ),
  );

  /**
   * Field action uses Flip Score bands + the 90-second rule (3 solds), not the
   * engine's stricter liquidity gate (that one needs ~5 sales / 90d for Buy).
   * Engine stance stays on the result as evidence.
   */
  const askUnder = hasRange && input.listingPrice <= range.low * (1 + 0.02);
  const askOver = hasRange && input.listingPrice > range.high * 1.12;
  const enoughComps = (range?.matchedSales ?? 0) >= 3;
  let action: FlipAction;
  if (!hasRange || rec.reasonCodes.includes("OVER_BUDGET")) {
    action = "pass";
  } else if (askOver) {
    action = "pass";
  } else if (askUnder && enoughComps && flipScore >= 58) {
    action = "buy_now";
  } else {
    action = "hold";
  }

  const actionLabel =
    action === "buy_now" ? "Buy now" : action === "hold" ? "Hold" : "Pass";

  const supporting = rec.supportingEvidence.map((e) => e.summary);
  const opposing = rec.opposingEvidence.map((e) => e.summary);
  supporting.push(pop.note, age.note);
  if (marginPct != null) {
    supporting.push(
      `Modeled exit net $${expectedExitNet} vs buy basis $${buyBasis} (${Math.round(marginPct * 100)}% margin · inferred).`,
    );
  }

  return FlipDealResultSchema.parse({
    assetName: input.assetName,
    flipScore,
    action,
    actionLabel,
    confidence: rec.confidence,
    targetResaleLow: targetLow,
    targetResaleHigh: targetHigh,
    targetResaleMid: targetMid,
    maxBuy,
    buyBasis,
    expectedExitNet,
    expectedNetProfit,
    marginPct,
    matchedComps: range?.matchedSales ?? 0,
    recencyDays: range?.recencyDays ?? null,
    reasonCodes: rec.reasonCodes,
    supporting,
    opposing,
    breakdown,
    engineStance: rec.stance,
    engineAction: rec.action,
    provenance: markInferred({
      source: "flip_score_deal_sheet",
      ruleOrModelVersion: `${FLIP_SCORE_VERSION}+${rec.ruleOrModelVersion}+${DEALER_KIT_VERSION}`,
      confidence: rec.confidence,
      notes:
        "Flip Score wraps decision-engine@0.1.0. Target resale is a range, not a fact. PriceCharting guide values are not sold comps.",
    }),
    howToRead: howToReadFlipScore(flipScore, action),
  });
}

export function howToReadFlipScore(score: number, action: FlipAction): string {
  const band =
    score >= 70 ? "70–100 Strong buy-now territory" : score >= 45 ? "45–69 Hold / watch" : "0–44 Pass";
  return `${band}. Action on this sheet is ${action === "buy_now" ? "Buy now" : action === "hold" ? "Hold" : "Pass"} — the engine still requires comps, liquidity, and an ask at/under range low for Buy. A high score with thin comps is not a green light.`;
}

export const FLIP_SCORE_RUBRIC = {
  buyNow: "Score ≥ 70 and ask at/under comp low with ≥3 sales and usable liquidity.",
  hold: "Score 45–69, or ask sits inside the band. Not a steal; not a trap.",
  pass: "Score < 45, ask above the high, over budget, or comps are missing.",
  weights: {
    margin: "0–40 from modeled net / buy basis (50% margin ≈ 40 pts).",
    ask: "0 / 12 / 25 from ask vs range (over / in-band / under low).",
    liquidity: "0–15 from decision-engine liquidity score.",
    pop: "0–10 (unknown = 5, never treated as scarce).",
    age: "1–10 (modern printing-era risk vs vintage established).",
  },
} as const;
