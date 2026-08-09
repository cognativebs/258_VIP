import { recommend } from "@vip/decision-engine";
import type { ApiHolding } from "./holdings.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./signalsFeed.js";
import { constraintsForHolding, loadUserConstraints } from "./userConstraints.js";

/**
 * Market comps for a holding. Until the eBay / TCGplayer adapters land
 * (Phase 2.2), this returns an empty list — and recommendations must say
 * "insufficient market evidence" rather than invent sales.
 *
 * Rule 4: never fabricate comps. An empty list is honest; four invented
 * sales at CLZ price × 0.9/1.0/1.1/0.95 was not.
 */
export type SaleComp = {
  id: string;
  price: number;
  saleDate: Date;
  source: string;
};

export type CompsLoader = (holding: ApiHolding) => SaleComp[];

/** Default: no comps. Swappable once eBay / TCGplayer adapters register. */
export const emptyCompsLoader: CompsLoader = () => [];

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

export function buildRecommendation(
  holding: ApiHolding,
  askPrice?: number | null,
  compsLoader: CompsLoader = emptyCompsLoader,
) {
  const ask = askPrice ?? holding.currentPrice ?? null;
  const sales = compsLoader(holding);
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
    compsSource: sales.length ? sales[0]?.source ?? "comps" : "none",
    ruleOrModelVersion: rec.ruleOrModelVersion,
    constraintsSnapshot: rec.constraintsSnapshot,
  };
}
