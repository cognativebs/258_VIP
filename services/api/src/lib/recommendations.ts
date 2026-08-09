import { recommend } from "@vip/decision-engine";
import { fetchCompsForHolding } from "./comps/index.js";
import type { ApiHolding } from "./holdings.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./signalsFeed.js";
import { constraintsForHolding, loadUserConstraints } from "./userConstraints.js";

/**
 * Market comps for a holding. Live path uses swappable adapters
 * (eBay sold listings + TCGplayer market). Empty adapter results mean
 * "insufficient market evidence" — never fabricated sales.
 *
 * Rule 4: never invent comps. Four synthetic sales at CLZ × 0.9/1.0/1.1/0.95
 * used to live here; they are gone.
 */

function signalEvidenceFromFeed() {
  const feed = readSignalsFeed(defaultSignalsFeedPath());
  if (!feed) return [];
  return feed.signals.slice(0, 12).map((s) => ({
    id: s.id,
    body: s.body,
    title: s.title,
    signalType: s.signalType,
    quarantineStatus: s.quarantineStatus,
    provenance: {
      source: feed.provenance.source,
      verificationStatus: feed.provenance.verificationStatus,
    },
  }));
}

export async function buildRecommendation(holding: ApiHolding, askPrice?: number | null) {
  const ask = askPrice ?? holding.currentPrice ?? null;
  const { sales, adapters } = await fetchCompsForHolding(holding);
  const userConstraints = constraintsForHolding(loadUserConstraints(), holding.pillar);

  const rec = recommend({
    assetId: holding.id,
    assetName: holding.assetName,
    askPrice: ask,
    sales,
    signalEvidence: signalEvidenceFromFeed(),
    collectionFit: {
      inHunt:
        (holding.pillar ?? "").toLowerCase().includes("batman") ||
        (holding.pillar ?? "").toLowerCase().includes("absolute"),
      huntSlug: "absolute-batman",
      isDuplicate: (holding.recommendationLabel ?? "").toLowerCase().includes("duplicate"),
      pillar: holding.pillar ?? undefined,
    },
    constraints: userConstraints,
  });

  const insufficientMarket = (rec.marketRange?.matchedSales ?? 0) === 0;
  const compsSources = [...new Set(sales.map((s) => s.source))];

  return {
    holdingId: holding.id,
    assetName: holding.assetName,
    action: rec.action,
    stance: rec.stance,
    confidence: rec.confidence,
    reasonCodes: insufficientMarket
      ? [...new Set([...rec.reasonCodes, "INSUFFICIENT_MARKET_EVIDENCE"])]
      : rec.reasonCodes,
    supportingEvidence: rec.supportingEvidence,
    opposingEvidence: rec.opposingEvidence,
    marketRange: rec.marketRange
      ? {
          low: rec.marketRange.low,
          high: rec.marketRange.high,
          matchedSales: rec.marketRange.matchedSales,
          recencyDays: rec.marketRange.recencyDays,
          confidence: rec.marketRange.confidence,
          confidenceBand: rec.marketRange.confidenceBand,
        }
      : null,
    insufficientMarketEvidence: insufficientMarket,
    compsSource: compsSources.length ? compsSources.join("+") : "none",
    compsAdapters: adapters.map((a) => ({
      id: a.adapterId,
      matched: a.sales.length,
      emptyReason: a.emptyReason ?? null,
    })),
    ruleOrModelVersion: rec.ruleOrModelVersion,
    constraintsSnapshot: rec.constraintsSnapshot,
  };
}
