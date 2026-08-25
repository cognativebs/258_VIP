/** Live comps for Analysis — VIP recommendations / comps adapters, never invented. */

import {
  ANALYSIS_COMPS_CAP,
  CATALOG_SNAPSHOT_NOTE,
  HighlightMarketSchema,
  MarketEvidenceBundleSchema,
  MIN_SALES_FOR_MARKET_EVIDENCE,
  VipRecommendationsResponseSchema,
  type HighlightMarket,
  type MarketEvidenceBundle,
} from "../types/analysis";

type FetchFn = typeof fetch;

const RULE = "analysis-market-evidence@1.0.0";

function nowIso() {
  return new Date().toISOString();
}

export function insufficientMarket(
  holdingId: string,
  catalogAmount: number | null,
  notes: string
): HighlightMarket {
  return HighlightMarketSchema.parse({
    holdingId,
    catalogSnapshot: { amount: catalogAmount, note: CATALOG_SNAPSHOT_NOTE },
    range: null,
    matchedSales: 0,
    recencyDays: null,
    confidence: 0,
    insufficientMarketEvidence: true,
    compsSource: "none",
    adapters: [],
    minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
    provenance: {
      source: "comps_adapters",
      method: "inferred",
      ruleOrModelVersion: RULE,
      confidence: 0,
      verificationStatus: "unverified",
      notes,
    },
    ruleOrModelVersion: RULE,
  });
}

export function emptyMarketBundle(
  attemptedIds: string[],
  fetchError: string | null,
  missingHoldingIds: string[] = attemptedIds
): MarketEvidenceBundle {
  const byHoldingId: Record<string, HighlightMarket> = {};
  for (const id of attemptedIds) {
    byHoldingId[id] = insufficientMarket(
      id,
      null,
      fetchError ?? "comps not attached for this holding"
    );
  }
  return MarketEvidenceBundleSchema.parse({
    attemptedIds,
    byHoldingId,
    missingHoldingIds,
    fetchedAt: nowIso(),
    minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
    holdingsWithSales: 0,
    holdingsInsufficient: attemptedIds.length,
    adapterIdleNotes: fetchError ? [fetchError] : [],
    fetchError,
    provenance: {
      source: "comps_adapters",
      method: "inferred",
      ruleOrModelVersion: RULE,
      confidence: 0,
      verificationStatus: "unverified",
      notes: fetchError ?? "no comps fetched",
    },
  });
}

export function marketFromRecommendation(
  rec: {
    holdingId: string;
    marketRange?: {
      low: number;
      high: number;
      matchedSales: number;
      recencyDays: number | null;
      confidence: number;
      confidenceBand?: "low" | "medium" | "high";
    } | null;
    insufficientMarketEvidence: boolean;
    compsSource: string;
    compsAdapters?: { id: string; matched: number; emptyReason?: string | null }[];
    minSalesRequired?: number;
    ruleOrModelVersion?: string;
    provenance?: HighlightMarket["provenance"];
  },
  catalogAmount: number | null = null
): HighlightMarket {
  const matchedSales = rec.marketRange?.matchedSales ?? 0;
  const minSales = rec.minSalesRequired ?? MIN_SALES_FOR_MARKET_EVIDENCE;
  const adapters = rec.compsAdapters ?? [];
  const idle = adapters
    .map((a) => (a.emptyReason ? `${a.id}: ${a.emptyReason}` : null))
    .filter((n): n is string => Boolean(n));
  const range =
    matchedSales > 0 && rec.marketRange
      ? {
          low: rec.marketRange.low,
          high: rec.marketRange.high,
          matchedSales: rec.marketRange.matchedSales,
          recencyDays: rec.marketRange.recencyDays,
          confidence: rec.marketRange.confidence,
          confidenceBand: rec.marketRange.confidenceBand,
        }
      : null;

  return HighlightMarketSchema.parse({
    holdingId: rec.holdingId,
    catalogSnapshot: { amount: catalogAmount, note: CATALOG_SNAPSHOT_NOTE },
    range,
    matchedSales,
    recencyDays: rec.marketRange?.recencyDays ?? null,
    confidence: rec.marketRange?.confidence ?? 0,
    insufficientMarketEvidence: rec.insufficientMarketEvidence || matchedSales < minSales,
    compsSource: rec.compsSource,
    adapters,
    minSalesRequired: minSales,
    provenance: rec.provenance ?? {
      source: rec.compsSource === "none" ? "comps_adapters" : rec.compsSource,
      method: "recommendation",
      ruleOrModelVersion: rec.ruleOrModelVersion ?? RULE,
      confidence: rec.marketRange?.confidence ?? 0,
      verificationStatus: "unverified",
      notes: idle.join("; ") || undefined,
    },
    ruleOrModelVersion: rec.ruleOrModelVersion ?? RULE,
  });
}

function adapterIdleNotes(markets: HighlightMarket[]): string[] {
  const notes = new Set<string>();
  for (const m of markets) {
    for (const a of m.adapters) {
      if (a.emptyReason) notes.add(`${a.id}: ${a.emptyReason}`);
    }
    if (m.provenance.notes) {
      for (const part of m.provenance.notes.split("; ")) {
        if (/not set|idle|unavailable|failed/i.test(part)) notes.add(part);
      }
    }
  }
  return [...notes];
}

export function bundleFromRecommendations(
  attemptedIds: string[],
  recs: Parameters<typeof marketFromRecommendation>[0][],
  missingHoldingIds: string[],
  fetchError: string | null = null
): MarketEvidenceBundle {
  const byHoldingId: Record<string, HighlightMarket> = {};
  for (const rec of recs) {
    byHoldingId[rec.holdingId] = marketFromRecommendation(rec);
  }
  for (const id of attemptedIds) {
    if (!byHoldingId[id]) {
      byHoldingId[id] = insufficientMarket(
        id,
        null,
        missingHoldingIds.includes(id)
          ? "holding not found in VIP inventory"
          : fetchError ?? "comps not returned for this holding"
      );
    }
  }
  const attached = Object.values(byHoldingId);
  const holdingsWithSales = attached.filter((m) => m.matchedSales > 0).length;
  return MarketEvidenceBundleSchema.parse({
    attemptedIds,
    byHoldingId,
    missingHoldingIds,
    fetchedAt: nowIso(),
    minSalesRequired: MIN_SALES_FOR_MARKET_EVIDENCE,
    holdingsWithSales,
    holdingsInsufficient: attached.filter((m) => m.insufficientMarketEvidence).length,
    adapterIdleNotes: adapterIdleNotes(attached),
    fetchError,
    provenance: {
      source: "vip_recommendations",
      method: fetchError ? "inferred" : "recommendation",
      ruleOrModelVersion: RULE,
      confidence: holdingsWithSales > 0 ? 0.5 : 0,
      verificationStatus: "unverified",
      notes:
        fetchError ??
        `adapter comps for ${attemptedIds.length} holdings; ${holdingsWithSales} with sales; never fabricated`,
    },
  });
}

/** GET /api/vip/recommendations?holdingIds= — never throws. */
export async function loadMarketEvidence(
  holdingIds: string[],
  fetcher: FetchFn = fetch,
  signal?: AbortSignal
): Promise<MarketEvidenceBundle> {
  const attemptedIds = [...new Set(holdingIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    ANALYSIS_COMPS_CAP
  );
  if (!attemptedIds.length) {
    return emptyMarketBundle([], "no holding ids in slice");
  }
  try {
    const qs = new URLSearchParams({
      holdingIds: attemptedIds.join(","),
      limit: String(ANALYSIS_COMPS_CAP),
    });
    const res = await fetcher(`/api/vip/recommendations?${qs}`, { signal });
    const raw = (await res.json().catch(() => ({}))) as unknown;
    const parsed = VipRecommendationsResponseSchema.safeParse(raw);
    if (!res.ok) {
      const msg =
        parsed.success && parsed.data.error
          ? parsed.data.error
          : `VIP recommendations HTTP ${res.status}`;
      return emptyMarketBundle(attemptedIds, msg);
    }
    if (!parsed.success) {
      return emptyMarketBundle(attemptedIds, "VIP recommendations payload failed schema");
    }
    return bundleFromRecommendations(
      attemptedIds,
      parsed.data.recommendations,
      parsed.data.missingHoldingIds ?? [],
      null
    );
  } catch (e) {
    if (signal?.aborted) {
      return emptyMarketBundle(attemptedIds, "comps fetch aborted");
    }
    return emptyMarketBundle(
      attemptedIds,
      e instanceof Error ? e.message : "VIP recommendations request failed"
    );
  }
}
