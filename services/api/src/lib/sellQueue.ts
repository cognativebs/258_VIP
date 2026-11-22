import { z } from "zod";
import { ProvenanceSchema } from "@vip/evidence";
import {
  INTELLIGENCE_VERSION,
  evaluateGrading,
  uuidFromKey,
} from "@vip/intelligence";
import type { ApiHolding } from "./holdings.js";
import { buildRecommendation } from "./recommendations.js";
import {
  loadGradingCostAssumption,
  type GradingCostAssumption,
} from "./userConstraints.js";

/**
 * Sell-queue dogfood: top-N liquidate advice. Every item is a decision-engine
 * action (Buy/Hold/Grade/Sell/Lot/Pass) with confidence + reasons and a
 * provenance/evidence block. Nothing here is verified market truth: CLZ sell
 * priority and the grading cost are operator inputs, and no comps means
 * "insufficient market evidence", never a fabricated range.
 */
export const SELL_QUEUE_RULE = "vip-sell-queue-dogfood@0.2.0";
export const SELL_QUEUE_DEFAULT_LIMIT = 20;
export const SELL_QUEUE_MAX_LIMIT = 50;
/** Newest matched sale older than this reads as stale. */
export const SELL_QUEUE_STALE_DAYS = 30;

export const SellQueueActionSchema = z.enum([
  "Buy",
  "Hold",
  "Grade",
  "Sell",
  "Lot",
  "Pass",
]);

export const SellQueueProvenanceSchema = ProvenanceSchema.extend({
  /** Matched sold comps behind the range. 0 when insufficient. */
  evidenceCount: z.number().int().nonnegative(),
  /** Days since the newest matched sale; null when there is none. */
  recencyDays: z.number().nonnegative().nullable(),
  minSalesRequired: z.number().int().nonnegative(),
}).strict();

export const GradingCostAssumptionSchema = z
  .object({
    usd: z.number().positive(),
    source: z.enum(["env", "user_constraints", "default_assumption"]),
    verificationStatus: z.literal("unverified"),
    note: z.string(),
  })
  .strict();

export const SellQueueItemSchema = z
  .object({
    holdingId: z.string().min(1),
    assetName: z.string(),
    pillar: z.string().nullable(),
    sellPriority: z.string().nullable(),
    action: SellQueueActionSchema,
    stance: z.string(),
    confidence: z.number().min(0).max(1),
    confidenceBand: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string()),
    reasonCodes: z.array(z.string()),
    /** Range from matched sold comps. null when there is no market evidence. */
    marketRange: z
      .object({
        low: z.number(),
        high: z.number(),
        matchedSales: z.number().int().nonnegative(),
        recencyDays: z.number().nonnegative().nullable(),
        confidenceBand: z.enum(["low", "medium", "high"]),
      })
      .nullable(),
    insufficientMarketEvidence: z.boolean(),
    isStale: z.boolean(),
    evidenceRecencyDays: z.number().nonnegative().nullable(),
    compsSource: z.string(),
    gradingRecommendation: z.string(),
    gradingOpportunityScore: z.number(),
    expectedIncrementalProfit: z.number(),
    gradingCost: GradingCostAssumptionSchema,
    dogfoodNote: z.string(),
    rank: z.number(),
    provenance: SellQueueProvenanceSchema,
  })
  .strict();
export type SellQueueItem = z.infer<typeof SellQueueItemSchema>;

export const SellQueueResponseSchema = z
  .object({
    note: z.string(),
    ruleOrModelVersion: z.string(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    gradingCost: GradingCostAssumptionSchema,
    /** Operator accept/reject is not recorded: no existing decision-log path fits (see backlog). */
    operatorMarks: z.literal("not_recorded"),
    items: z.array(SellQueueItemSchema),
  })
  .strict();
export type SellQueueResponse = z.infer<typeof SellQueueResponseSchema>;

export function parseSellQueueLimit(raw: unknown): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n <= 0) return SELL_QUEUE_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SELL_QUEUE_MAX_LIMIT);
}

function bandFor(confidence: number): "low" | "medium" | "high" {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export async function dogfoodSellQueue(
  items: ApiHolding[],
  limit = SELL_QUEUE_DEFAULT_LIMIT,
  gradingCost: GradingCostAssumption = loadGradingCostAssumption(),
): Promise<SellQueueResponse> {
  // buildRecommendation fetches comps per holding, so rank a bounded slice
  // rather than the whole collection.
  const candidates = [...items]
    .sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0))
    .slice(0, Math.max(limit * 3, limit));

  const ranked = (
    await Promise.all(
      candidates.map(async (h): Promise<SellQueueItem> => {
        const rec = await buildRecommendation(h);
        const raw = h.currentPrice ?? 0;
        const grading = evaluateGrading({
          holdingId: uuidFromKey(h.id),
          evaluatedAt: new Date(),
          rawValue: raw || 1,
          gradingCost: gradingCost.usd,
          notes: h.needsGrading
            ? "Needs grading flag from inventory · PSA tiers missing → inspect_further"
            : "Sell-queue dogfood — PSA tiers not supplied",
        });
        // No comps at all, or the newest matched sale is over a month old.
        const recencyDays = rec.marketRange?.recencyDays ?? null;
        const stale =
          rec.insufficientMarketEvidence ||
          (recencyDays ?? Number.POSITIVE_INFINITY) > SELL_QUEUE_STALE_DAYS;
        const dogfoodNote = rec.insufficientMarketEvidence
          ? "Insufficient market evidence — evidence stale, do not treat as current"
          : stale
            ? "Evidence stale — do not treat as current"
            : grading.recommendation === "sell_raw"
              ? "Grading EV does not beat raw — liquidate candidate"
              : rec.action === "Sell"
                ? "Decision engine Sell"
                : h.sellPriority === "High"
                  ? "CLZ high sell priority — confirm with fresh evidence"
                  : "Watch / hold unless evidence refreshes";
        const matchedSales = rec.marketRange?.matchedSales ?? 0;
        const confidence = rec.confidence;
        const confidenceBand = rec.insufficientMarketEvidence
          ? "low"
          : (rec.marketRange?.confidenceBand ?? bandFor(confidence));
        const reasons = [
          dogfoodNote,
          ...rec.supportingEvidence.map((e) => e.summary),
          ...rec.opposingEvidence.map((e) => `Against: ${e.summary}`),
          `Grading check ${grading.recommendation} at ${gradingCost.usd} USD/book (${gradingCost.source}, unverified)`,
          h.sellPriority
            ? `CLZ sell priority ${h.sellPriority} (operator label, not market evidence)`
            : null,
        ].filter((r): r is string => Boolean(r && r.trim()));
        return SellQueueItemSchema.parse({
          holdingId: h.id,
          assetName: h.assetName,
          pillar: h.pillar ?? null,
          sellPriority: h.sellPriority ?? null,
          action: rec.action,
          stance: rec.stance,
          confidence,
          confidenceBand,
          reasons,
          reasonCodes: rec.reasonCodes,
          // The engine returns a 0–0 range with zero sales; that is not a range.
          marketRange:
            rec.marketRange && rec.marketRange.matchedSales > 0
              ? {
                  low: rec.marketRange.low,
                  high: rec.marketRange.high,
                  matchedSales: rec.marketRange.matchedSales,
                  recencyDays: rec.marketRange.recencyDays,
                  confidenceBand: rec.marketRange.confidenceBand,
                }
              : null,
          insufficientMarketEvidence: rec.insufficientMarketEvidence,
          isStale: stale,
          evidenceRecencyDays: recencyDays,
          compsSource: rec.compsSource,
          gradingRecommendation: grading.recommendation,
          gradingOpportunityScore: grading.gradingOpportunityScore,
          expectedIncrementalProfit: grading.expectedIncrementalProfit,
          gradingCost,
          dogfoodNote,
          rank:
            (PRIORITY_RANK[h.sellPriority ?? "Low"] ?? 3) * 10 +
            (stale ? 1 : 0) +
            (grading.recommendation === "sell_raw" ? 0 : 2),
          provenance: {
            source:
              rec.compsSource === "none"
                ? "comps_adapters(none)"
                : rec.compsSource,
            method: "recommendation",
            ruleOrModelVersion: `${SELL_QUEUE_RULE}+${rec.ruleOrModelVersion}+${INTELLIGENCE_VERSION}`,
            confidence,
            confidenceBand,
            verificationStatus: "unverified",
            notes: [rec.provenance.notes, gradingCost.note]
              .filter(Boolean)
              .join("; "),
            evidenceCount: matchedSales,
            recencyDays,
            minSalesRequired: rec.minSalesRequired,
          },
        });
      }),
    )
  )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);

  return SellQueueResponseSchema.parse({
    note: "Dogfood ranking uses the decision engine, grading optimizer and evidence freshness. CLZ labels are not treated as verified market truth.",
    ruleOrModelVersion: SELL_QUEUE_RULE,
    limit,
    count: ranked.length,
    gradingCost,
    operatorMarks: "not_recorded",
    items: ranked,
  });
}
