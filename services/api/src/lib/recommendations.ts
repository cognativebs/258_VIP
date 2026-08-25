import { DEFAULT_RULE_CONFIG, recommend } from "@vip/decision-engine";
import { fetchCompsForHolding } from "./comps/index.js";
import type { ApiHolding } from "./holdings.js";
import { defaultSignalsFeedPath, readSignalsFeed } from "./signalsFeed.js";
import { constraintsForHolding, loadUserConstraints } from "./userConstraints.js";

/** Same threshold the decision engine uses for Buy. Sell/Lot needs this many comps too. */
export const MIN_SALES_FOR_MARKET_EVIDENCE = DEFAULT_RULE_CONFIG.minSalesForBuy;

/** Analysis / targeted recs — cap adapter fan-out. Default list path may use a higher limit. */
export const COMPS_HOLDING_CAP = 12;

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

  const matchedSales = rec.marketRange?.matchedSales ?? 0;
  const insufficientMarket = matchedSales < MIN_SALES_FOR_MARKET_EVIDENCE;
  const compsSources = [...new Set(sales.map((s) => s.source))];
  const adapterNotes = adapters
    .map((a) => (a.emptyReason ? `${a.adapterId}: ${a.emptyReason}` : null))
    .filter((n): n is string => Boolean(n));
  const provenanceNotes = [
    insufficientMarket
      ? `matchedSales ${matchedSales} < minSalesRequired ${MIN_SALES_FOR_MARKET_EVIDENCE}`
      : null,
    ...adapterNotes,
  ]
    .filter(Boolean)
    .join("; ");

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
    minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
    compsSource: compsSources.length ? compsSources.join("+") : "none",
    compsAdapters: adapters.map((a) => ({
      id: a.adapterId,
      matched: a.sales.length,
      emptyReason: a.emptyReason ?? null,
    })),
    provenance: {
      source: compsSources.length ? compsSources.join("+") : "comps_adapters",
      method: "recommendation" as const,
      ruleOrModelVersion: rec.ruleOrModelVersion,
      confidence: rec.marketRange?.confidence ?? 0,
      verificationStatus: "unverified" as const,
      notes: provenanceNotes || undefined,
    },
    ruleOrModelVersion: rec.ruleOrModelVersion,
    constraintsSnapshot: rec.constraintsSnapshot,
  };
}

export function parseHoldingIdsQuery(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  const text = Array.isArray(raw) ? raw.map(String).join(",") : String(raw);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= COMPS_HOLDING_CAP) break;
  }
  return out;
}

export function selectHoldingsForRecommendations(
  holdings: ApiHolding[],
  holdingIds: string[],
  fallbackLimit: number,
): { selected: ApiHolding[]; missingIds: string[] } {
  if (!holdingIds.length) {
    return { selected: holdings.slice(0, fallbackLimit), missingIds: [] };
  }
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const selected: ApiHolding[] = [];
  const missingIds: string[] = [];
  for (const id of holdingIds) {
    const hit = byId.get(id);
    if (hit) selected.push(hit);
    else missingIds.push(id);
  }
  return { selected, missingIds };
}
