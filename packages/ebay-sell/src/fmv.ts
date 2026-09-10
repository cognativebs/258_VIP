import { markInferred } from "@vip/evidence";
import { EBAY_SELL_RULE } from "./constants.js";
import type { FmvSnapshot } from "./schemas.js";

export type FmvInputs = {
  liveLow?: number | null;
  liveHigh?: number | null;
  liveListingCount?: number | null;
  recencyDays?: number | null;
  /** Import-time point price — never treated as a verified market range. */
  snapshotPrice?: number | null;
};

/**
 * Resolve FMV as a range + evidence + confidence. Never a lone point presented as fact.
 * LIVE Browse asks outrank CLZ snapshots and stay labeled unverified.
 */
export function resolveFmv(input: FmvInputs): FmvSnapshot | null {
  const low = input.liveLow;
  const high = input.liveHigh;
  if (low != null && high != null && low > 0 && high > 0) {
    const mid = Number(((low + high) / 2).toFixed(2));
    const evidence = Math.max(0, input.liveListingCount ?? 0);
    const confidence = Math.min(0.72, 0.28 + evidence * 0.06);
    return {
      low,
      high,
      mid,
      currency: "USD",
      confidence,
      evidenceCount: evidence,
      source: "ebay_browse",
      method: "inferred",
      verificationStatus: "unverified",
      recencyDays: input.recencyDays ?? null,
      notes: "LIVE Browse asks · unverified · not a sold ledger",
    };
  }
  const snap = input.snapshotPrice;
  if (snap != null && snap > 0) {
    return {
      low: snap,
      high: snap,
      mid: snap,
      currency: "USD",
      confidence: 0.22,
      evidenceCount: 1,
      source: "import_snapshot",
      method: "inferred",
      verificationStatus: "unverified",
      recencyDays: null,
      notes: "Import-time point price · not live FMV · inferred · unverified",
    };
  }
  return null;
}

export function fmvProvenance(snapshot: FmvSnapshot) {
  return markInferred({
    source: snapshot.source,
    ruleOrModelVersion: EBAY_SELL_RULE,
    confidence: snapshot.confidence,
    notes: snapshot.notes,
  });
}

export function fmvErrorPct(actualSalePrice: number, fmvAtListing: FmvSnapshot | null): number | null {
  if (!fmvAtListing || fmvAtListing.mid <= 0) return null;
  return (actualSalePrice - fmvAtListing.mid) / fmvAtListing.mid;
}
