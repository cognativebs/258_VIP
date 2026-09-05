import {
  DEFAULT_DAILY_QUEUE_TARGET,
  DEFAULT_SINGLE_LABOR_MINUTES,
  LISTING_QUEUE_RANK_RULE,
} from "./constants.js";
import { recommendDisposition } from "./disposition.js";
import { pickDefaultStrategy, quotePrice } from "./pricing.js";
import type { DailyQueueItem, MarketEvent, SellingAssetInput } from "./schemas.js";

export type QueueComposition = {
  high_liquidity: number;
  event_trending: number;
  stale: number;
  scarce: number;
  experiment: number;
};

export const DEFAULT_COMPOSITION: QueueComposition = {
  high_liquidity: 0.4,
  event_trending: 0.2,
  stale: 0.2,
  scarce: 0.12,
  experiment: 0.08,
};

export type QueueBuildInput = {
  assets: SellingAssetInput[];
  events?: MarketEvent[];
  experimentIds?: Set<string>;
  target?: number;
  composition?: QueueComposition;
  now?: Date;
};

/**
 * Rank a daily listing queue. Does not auto-publish.
 */
export function buildDailyListingQueue(input: QueueBuildInput): DailyQueueItem[] {
  const target = input.target ?? DEFAULT_DAILY_QUEUE_TARGET;
  const composition = input.composition ?? DEFAULT_COMPOSITION;
  const now = input.now ?? new Date();
  const liveEvents = (input.events ?? []).filter(
    (e) => !e.expiresAt || e.expiresAt.getTime() > now.getTime(),
  );

  const scored = input.assets
    .filter((a) => a.salesPathState === "available")
    .map((asset) => scoreQueueCandidate(asset, liveEvents, input.experimentIds))
    .filter((item): item is DailyQueueItem => item != null);

  const buckets: Record<DailyQueueItem["bucket"], DailyQueueItem[]> = {
    high_liquidity: [],
    event_trending: [],
    stale: [],
    scarce: [],
    experiment: [],
  };
  for (const item of scored.sort((a, b) => b.priorityScore - a.priorityScore)) {
    buckets[item.bucket].push(item);
  }

  const picked: DailyQueueItem[] = [];
  const used = new Set<string>();
  for (const [bucket, share] of Object.entries(composition) as [DailyQueueItem["bucket"], number][]) {
    const want = Math.max(0, Math.round(target * share));
    for (const item of buckets[bucket]) {
      if (picked.length >= target) break;
      if (used.has(item.inventoryId)) continue;
      if (picked.filter((p) => p.bucket === bucket).length >= want) break;
      picked.push(item);
      used.add(item.inventoryId);
    }
  }
  for (const item of scored) {
    if (picked.length >= target) break;
    if (used.has(item.inventoryId)) continue;
    picked.push(item);
    used.add(item.inventoryId);
  }
  return picked;
}

function scoreQueueCandidate(
  asset: SellingAssetInput,
  events: MarketEvent[],
  experimentIds?: Set<string>,
): DailyQueueItem | null {
  const rec = recommendDisposition(asset);
  if (rec.disposition === "PC" || rec.disposition === "HOLD" || rec.disposition === "GRADE") {
    return null;
  }
  if (rec.disposition === "REVIEW" || rec.disposition === "DONATE" || rec.disposition === "LCS_SHOW") {
    return null;
  }
  const fmv = asset.fmv;
  if (!fmv) return null;
  const strategy = pickDefaultStrategy({
    fmvMid: fmv.mid,
    scarce: asset.parallelScarce || Boolean(asset.serialNumber),
    liquidate: rec.disposition === "BULK" || fmv.mid < 5,
  });
  const quote = quotePrice({ fmv, strategy });
  const eventHit = events.find(
    (e) =>
      e.subjectId === asset.playerSubject ||
      e.subjectId === asset.team ||
      e.subjectId === asset.inventoryId,
  );
  const inExperiment = experimentIds?.has(asset.inventoryId) ?? false;
  let bucket: DailyQueueItem["bucket"] = "high_liquidity";
  if (inExperiment) bucket = "experiment";
  else if (eventHit) bucket = "event_trending";
  else if (asset.saleVelocity === "stale" || (asset.daysInInventory ?? 0) >= 90) bucket = "stale";
  else if (asset.parallelScarce || Boolean(asset.serialNumber) || fmv.mid >= 15) bucket = "scarce";
  else if (asset.saleVelocity === "hot" || asset.strongSearchability) bucket = "high_liquidity";

  const priorityScore = Number(
    (
      (fmv.mid >= 5 ? 0.35 : 0.15) +
      (asset.saleVelocity === "hot" ? 0.25 : 0) +
      (eventHit ? 0.2 * eventHit.severity : 0) +
      (asset.saleVelocity === "stale" ? 0.12 : 0) +
      (inExperiment ? 0.08 : 0) +
      rec.confidence * 0.1
    ).toFixed(3),
  );

  return {
    inventoryId: asset.inventoryId,
    priorityScore,
    bucket,
    recommendedFormat: "FIXED_PRICE",
    recommendedPrice: quote.recommendedListPrice,
    minimumPrice: quote.minimumAcceptablePrice,
    pricingStrategy: strategy,
    estimatedNet: quote.estimatedNet,
    estimatedLaborMinutes: DEFAULT_SINGLE_LABOR_MINUTES,
    reason: eventHit
      ? `${rec.reasonText} Event: ${eventHit.summary}`
      : rec.reasonText,
    confidence: rec.confidence,
    disposition: rec.disposition,
  };
}

export function queueRuleVersion(): string {
  return LISTING_QUEUE_RANK_RULE;
}
