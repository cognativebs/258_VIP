import { evaluateGrading, uuidFromKey } from "@vip/intelligence";
import type { ApiHolding } from "./holdings.js";
import { buildRecommendation } from "./recommendations.js";

export async function dogfoodSellQueue(items: ApiHolding[], limit = 20) {
  // buildRecommendation fetches comps per holding, so rank a bounded slice
  // rather than the whole collection.
  const candidates = [...items]
    .sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0))
    .slice(0, Math.max(limit * 3, limit));

  const ranked = (
    await Promise.all(
      candidates.map(async (h) => {
        const rec = await buildRecommendation(h);
        const raw = h.currentPrice ?? 0;
        const grading = evaluateGrading({
          holdingId: uuidFromKey(h.id),
          evaluatedAt: new Date(),
          rawValue: raw || 1,
          gradingCost: 25,
          notes: h.needsGrading
            ? "Needs grading flag from inventory · PSA tiers missing → inspect_further"
            : "Sell-queue dogfood — PSA tiers not supplied",
        });
        // No comps at all, or the newest matched sale is over a month old.
        const recencyDays = rec.marketRange?.recencyDays ?? null;
        const stale = rec.insufficientMarketEvidence || (recencyDays ?? 999) > 30;
        const priorityRank = { High: 0, Medium: 1, Low: 2 } as const;
        return {
          holding: h,
          action: rec.action,
          stance: rec.stance,
          confidence: rec.confidence,
          isStale: stale,
          evidenceRecencyDays: recencyDays,
          compsSource: rec.compsSource,
          gradingRecommendation: grading.recommendation,
          gradingOpportunityScore: grading.gradingOpportunityScore,
          expectedIncrementalProfit: grading.expectedIncrementalProfit,
          dogfoodNote: stale
            ? "Evidence stale — do not treat as current"
            : grading.recommendation === "sell_raw"
              ? "Grading EV does not beat raw — liquidate candidate"
              : rec.action === "Sell"
                ? "Decision engine Sell"
                : h.sellPriority === "High"
                  ? "CLZ high sell priority — confirm with fresh evidence"
                  : "Watch / hold unless evidence refreshes",
          rank:
            (priorityRank[h.sellPriority ?? "Low"] ?? 3) * 10 +
            (stale ? 1 : 0) +
            (grading.recommendation === "sell_raw" ? 0 : 2),
        };
      }),
    )
  )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);

  return {
    note: "Dogfood ranking uses grading optimizer + evidence freshness. CLZ labels are not treated as verified market truth.",
    count: ranked.length,
    items: ranked,
  };
}
