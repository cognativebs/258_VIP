import type { UserConstraints } from "@vip/core-model";
import { allInCost } from "./cost.js";
import { signalsToEvidenceRefs } from "./evidence-bridge.js";
import { liquidity } from "./liquidity.js";
import { marketRange } from "./market-range.js";
import { targetPrice } from "./target-price.js";
import {
  DEFAULT_RULE_CONFIG,
  DecisionInputSchema,
  ENGINE_VERSION,
  EngineRecommendationSchema,
  type DecisionInput,
  type EngineRecommendation,
  type EngineStance,
  type EvidenceItem,
  type RuleConfig,
} from "./types.js";

function stanceToAction(stance: EngineStance): EngineRecommendation["action"] {
  if (stance === "Buy") return "Buy";
  if (stance === "Pass") return "Pass";
  return "Hold"; // Watch → Hold + reason WATCH
}

/**
 * Configurable rule engine. Every path must emit ≥1 supporting and ≥1 opposing evidence.
 */
export function recommend(
  rawInput: DecisionInput,
  configOverrides: Partial<RuleConfig> = {},
): EngineRecommendation {
  const input = DecisionInputSchema.parse(rawInput);
  const cfg: RuleConfig = { ...DEFAULT_RULE_CONFIG, ...configOverrides };
  const constraints: UserConstraints = {
    collectionGoals: input.constraints?.collectionGoals ?? [],
    budget: input.constraints?.budget ?? null,
    riskTolerance: input.constraints?.riskTolerance ?? null,
    timeHorizon: input.constraints?.timeHorizon ?? null,
    premiumTolerance: input.constraints?.premiumTolerance ?? null,
  };

  const asOf = input.asOf ?? new Date();
  const range = marketRange({
    sales: input.sales,
    asOf,
    windowDays: input.windowDays,
  });
  const liq = liquidity({
    sales: input.sales,
    asOf,
    windowDays: input.windowDays,
  });

  const ask = input.askPrice ?? null;
  const cost =
    ask != null
      ? allInCost(
          { askPrice: ask, ...input.costContext },
          { marketMid: range.mid ?? null, config: cfg },
        )
      : null;

  const target = targetPrice({ range, constraints, config: cfg });

  const supporting: EvidenceItem[] = [];
  const opposing: EvidenceItem[] = [];
  const reasonCodes: string[] = [];

  // --- Evidence from market ---
  if (range.matchedSales > 0) {
    supporting.push({
      id: `range:${input.assetId}`,
      kind: "range",
      summary: `Market range $${range.low}–$${range.high} from ${range.matchedSales} sales (${range.confidenceBand} confidence).`,
      polarity: "supporting",
      weight: range.confidence,
    });
  } else {
    opposing.push({
      id: `range-empty:${input.assetId}`,
      kind: "range",
      summary: "No matched sales in window — cannot support a Buy on evidence.",
      polarity: "opposing",
      weight: 0.9,
    });
    reasonCodes.push("INSUFFICIENT_COMPS");
  }

  if (liq.band === "fast" || liq.band === "medium") {
    supporting.push({
      id: `liq-ok:${input.assetId}`,
      kind: "liquidity",
      summary: `Liquidity ${liq.band} (~${liq.salesPerMonth}/mo in window).`,
      polarity: "supporting",
      weight: liq.confidence,
    });
  } else {
    opposing.push({
      id: `liq-thin:${input.assetId}`,
      kind: "liquidity",
      summary: `Liquidity ${liq.band} — exit may be slow or uncertain.`,
      polarity: "opposing",
      weight: 0.7,
    });
    reasonCodes.push("THIN_LIQUIDITY");
  }

  // --- Collection fit ---
  const fit = input.collectionFit;
  if (fit?.inHunt) {
    supporting.push({
      id: `hunt:${fit.huntSlug ?? "hunt"}`,
      kind: "collection_fit",
      summary: `Fits active hunt${fit.huntSlug ? ` (${fit.huntSlug})` : ""}.`,
      polarity: "supporting",
      weight: 0.7,
    });
    reasonCodes.push("HUNT_FIT");
  }
  if (fit?.isDuplicate) {
    opposing.push({
      id: `dup:${input.assetId}`,
      kind: "collection_fit",
      summary: "Looks like a duplicate of an owned copy.",
      polarity: "opposing",
      weight: 0.65,
    });
    reasonCodes.push("DUPLICATE");
  }
  if (
    fit?.pillar &&
    constraints.collectionGoals.length > 0 &&
    constraints.collectionGoals.some(
      (g) => g.toLowerCase() === fit.pillar!.toLowerCase(),
    )
  ) {
    supporting.push({
      id: `pillar:${fit.pillar}`,
      kind: "collection_fit",
      summary: `Aligns with collection goal “${fit.pillar}”.`,
      polarity: "supporting",
      weight: 0.6,
    });
    reasonCodes.push("GOAL_FIT");
  }

  // --- Ask vs range / budget ---
  let askVsRange: "under" | "in_band" | "over" | "unknown" = "unknown";
  if (ask != null && range.matchedSales > 0) {
    const watchHi = range.high * (1 + cfg.watchBandPct);
    if (ask <= range.low * (1 + cfg.buyUnderLowBufferPct)) askVsRange = "under";
    else if (ask <= watchHi) askVsRange = "in_band";
    else askVsRange = "over";

    if (askVsRange === "under") {
      supporting.push({
        id: `ask-under:${ask}`,
        kind: "cost",
        summary: `Ask $${ask} is at/under range low $${range.low}.`,
        polarity: "supporting",
        weight: 0.8,
      });
      reasonCodes.push("ASK_AT_OR_UNDER_LOW");
    } else if (askVsRange === "over") {
      opposing.push({
        id: `ask-over:${ask}`,
        kind: "cost",
        summary: `Ask $${ask} is above range high $${range.high} (beyond watch band).`,
        polarity: "opposing",
        weight: 0.85,
      });
      reasonCodes.push("ASK_ABOVE_HIGH");
    } else {
      opposing.push({
        id: `ask-mid:${ask}`,
        kind: "cost",
        summary: `Ask $${ask} sits inside/near range $${range.low}–$${range.high} — not a clear discount.`,
        polarity: "opposing",
        weight: 0.45,
      });
      reasonCodes.push("ASK_IN_BAND");
    }
  }

  if (ask != null && constraints.budget != null && ask > constraints.budget) {
    opposing.push({
      id: `budget:${constraints.budget}`,
      kind: "constraint",
      summary: `Ask $${ask} exceeds budget $${constraints.budget}.`,
      polarity: "opposing",
      weight: 1,
    });
    reasonCodes.push("OVER_BUDGET");
  }

  if (cost && cost.allIn && range.mid != null && cost.allIn > range.high) {
    opposing.push({
      id: `allin-high:${cost.allIn}`,
      kind: "cost",
      summary: `All-in $${cost.allIn.toFixed(2)} exceeds range high $${range.high}.`,
      polarity: "opposing",
      weight: 0.75,
    });
    reasonCodes.push("ALL_IN_ABOVE_HIGH");
  }

  // --- Signal evidence bridge (intelligence events, not prose-only) ---
  const signalRefs = signalsToEvidenceRefs(input.signalEvidence ?? []);
  if (signalRefs.length === 0) {
    reasonCodes.push("INSUFFICIENT_SIGNAL_EVIDENCE");
  } else {
    for (const ref of signalRefs) {
      if (ref.polarity === "opposing") opposing.push(ref);
      else supporting.push(ref);
    }
    reasonCodes.push("SIGNAL_EVIDENCE");
  }

  // Ensure we always have both polarities (trust surface).
  if (supporting.length === 0) {
    supporting.push({
      id: "neutral-support",
      kind: "risk",
      summary: "No strong positive signal — defaulting to caution.",
      polarity: "supporting",
      weight: 0.2,
    });
  }
  if (opposing.length === 0) {
    opposing.push({
      id: "model-uncertainty",
      kind: "risk",
      summary: "Model/rule uncertainty remains even when signals look favorable.",
      polarity: "opposing",
      weight: 0.35,
    });
    reasonCodes.push("MODEL_UNCERTAINTY");
  }

  // --- Stance selection ---
  let stance: EngineStance = "Watch";

  const overBudget = reasonCodes.includes("OVER_BUDGET");
  const thin = range.matchedSales < cfg.minSalesForBuy || range.confidence < cfg.minConfidenceForBuy;
  const illiquid = liq.score < cfg.minLiquidityForBuy;
  const askBad = askVsRange === "over" || reasonCodes.includes("ALL_IN_ABOVE_HIGH");
  const askGood = askVsRange === "under";
  const dup = reasonCodes.includes("DUPLICATE");

  if (overBudget || (askBad && !askGood) || (thin && askBad)) {
    stance = "Pass";
    reasonCodes.push("PASS_RULE");
  } else if (
    askGood &&
    !thin &&
    !illiquid &&
    !dup &&
    !overBudget &&
    range.matchedSales >= cfg.minSalesForBuy &&
    range.confidence >= cfg.minConfidenceForBuy
  ) {
    stance = "Buy";
    reasonCodes.push("BUY_RULE");
  } else {
    stance = "Watch";
    reasonCodes.push("WATCH");
  }

  // Risk tolerance can demote Buy → Watch
  if (stance === "Buy" && constraints.riskTolerance === "low" && range.confidence < 0.7) {
    stance = "Watch";
    reasonCodes.push("LOW_RISK_DEMOTION");
    opposing.push({
      id: "low-risk",
      kind: "constraint",
      summary: "Low risk tolerance + medium confidence → Watch instead of Buy.",
      polarity: "opposing",
      weight: 0.6,
    });
  }

  const supportWeight = supporting.reduce((s, e) => s + e.weight, 0);
  const opposeWeight = opposing.reduce((s, e) => s + e.weight, 0);
  const conf = Math.max(
    0.1,
    Math.min(
      0.95,
      range.confidence * 0.6 +
        (supportWeight / (supportWeight + opposeWeight + 0.01)) * 0.4,
    ),
  );

  return EngineRecommendationSchema.parse({
    action: stanceToAction(stance),
    stance,
    reasonCodes: [...new Set(reasonCodes)],
    supportingEvidence: supporting,
    opposingEvidence: opposing,
    confidence: Number(conf.toFixed(3)),
    marketRange: range.matchedSales > 0 ? range : range,
    liquidity: liq,
    allInCost: cost,
    targetPrice: target,
    constraintsSnapshot: constraints,
    ruleOrModelVersion: ENGINE_VERSION,
  });
}
