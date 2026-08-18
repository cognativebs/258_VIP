import { recommend } from "@vip/decision-engine";
import { readRecommendation, wrapEngineRecommendation } from "@vip/intelligence";
import type { ApiHolding } from "../lib/holdings.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./signalsFeed.js";

function syntheticSales(holding: ApiHolding, asOf = new Date()) {
  const mid = holding.currentPrice ?? 20;
  return [0.9, 1.0, 1.1, 0.95].map((m, i) => ({
    id: `${holding.id}-sale-${i}`,
    price: Number((mid * m).toFixed(2)),
    saleDate: new Date(asOf.getTime() - (i + 1) * 7 * 86400000),
    source: "seed_comp",
  }));
}

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

export function buildRecommendation(holding: ApiHolding, askPrice?: number | null) {
  const ask = askPrice ?? holding.currentPrice ?? null;
  const rec = recommend({
    assetId: holding.id,
    assetName: holding.assetName,
    askPrice: ask,
    sales: syntheticSales(holding),
    signalEvidence: signalEvidenceFromFeed(),
    collectionFit: {
      inHunt: (holding.pillar ?? "").toLowerCase().includes("batman") ||
        (holding.pillar ?? "").toLowerCase().includes("absolute"),
      huntSlug: "absolute-batman",
      isDuplicate: (holding.recommendationLabel ?? "").toLowerCase().includes("duplicate"),
      pillar: holding.pillar ?? undefined,
    },
    constraints: {
      budget: 150,
      riskTolerance: "medium",
      collectionGoals: holding.pillar ? [holding.pillar] : ["Absolute Universe"],
      premiumTolerance: 0.05,
    },
  });

  return {
    holdingId: holding.id,
    assetName: holding.assetName,
    action: rec.action,
    stance: rec.stance,
    confidence: rec.confidence,
    reasonCodes: rec.reasonCodes,
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
    ruleOrModelVersion: rec.ruleOrModelVersion,
    constraintsSnapshot: rec.constraintsSnapshot,
    evidenceCard: readRecommendation(
      wrapEngineRecommendation({
        holdingId: holding.id,
        action: rec.action,
        confidence: rec.confidence,
        supporting: rec.supportingEvidence,
        opposing: rec.opposingEvidence,
      }),
      new Date(),
    ),
  };
}
