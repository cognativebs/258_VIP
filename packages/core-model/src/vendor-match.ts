import {
  EXACT_NAME_MATCH_CONFIDENCE,
  TRGM_MATCH_FLOOR,
  UPC_MATCH_CONFIDENCE,
  type VendorMatchMethod,
} from "./data-source.js";

export type VendorMatchInput = {
  upcExact: boolean;
  nameSetExact: boolean;
  /** pg_trgm similarity in [0, 1], or null when not computed. */
  trgmSimilarity: number | null;
  candidatePricedUnitId: string | null;
  candidateAssetId: string | null;
};

export type VendorMatchDecision = {
  matchMethod: VendorMatchMethod;
  matchConfidence: number | null;
  needsReview: boolean;
  pricedUnitId: string | null;
  assetId: string | null;
};

/**
 * PC-CORE-01 A.3 matching rules. First hit wins.
 * trgm ≥ 0.82 still needs_review. Below that is unmatched (no silent unit).
 */
export function decideVendorMatch(input: VendorMatchInput): VendorMatchDecision {
  const unit = {
    pricedUnitId: input.candidatePricedUnitId,
    assetId: input.candidateAssetId,
  };

  if (input.upcExact && (unit.pricedUnitId || unit.assetId)) {
    return {
      matchMethod: "upc",
      matchConfidence: UPC_MATCH_CONFIDENCE,
      needsReview: false,
      ...unit,
    };
  }

  if (input.nameSetExact && (unit.pricedUnitId || unit.assetId)) {
    return {
      matchMethod: "exact_name",
      matchConfidence: EXACT_NAME_MATCH_CONFIDENCE,
      needsReview: false,
      ...unit,
    };
  }

  if (
    input.trgmSimilarity != null &&
    input.trgmSimilarity >= TRGM_MATCH_FLOOR &&
    (unit.pricedUnitId || unit.assetId)
  ) {
    return {
      matchMethod: "trgm",
      matchConfidence: roundConfidence(input.trgmSimilarity),
      needsReview: true,
      ...unit,
    };
  }

  return {
    matchMethod: "unmatched",
    matchConfidence: input.trgmSimilarity != null ? roundConfidence(input.trgmSimilarity) : null,
    needsReview: true,
    pricedUnitId: null,
    assetId: null,
  };
}

export type ExistingVendorMap = {
  confirmedAt: Date | null;
  lastSeenAt: Date;
  pricedUnitId: string | null;
  assetId: string | null;
  matchMethod: VendorMatchMethod;
  matchConfidence: number | null;
  needsReview: boolean;
};

/**
 * Confirmed rows: last_seen_at only. needs_review is never auto-cleared.
 */
export function applyVendorRematch<T extends ExistingVendorMap>(
  existing: T,
  incoming: VendorMatchDecision,
  seenAt: Date,
): T {
  if (existing.confirmedAt != null) {
    return { ...existing, lastSeenAt: seenAt };
  }
  return {
    ...existing,
    lastSeenAt: seenAt,
    matchMethod: incoming.matchMethod,
    matchConfidence: incoming.matchConfidence,
    pricedUnitId: incoming.pricedUnitId,
    assetId: incoming.assetId,
    needsReview: incoming.needsReview || existing.needsReview,
  };
}

export function normalizeVendorName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bvol\.?\s*\d+\b/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundConfidence(n: number): number {
  return Math.round(n * 100) / 100;
}
