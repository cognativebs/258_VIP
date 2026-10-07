import type { VendorMatchMethod, VendorProductMap } from "@vip/core-model";
import {
  extractCollectorNumber,
  extractIssueNumber,
  normalizeMatchText,
  normalizeSeriesTitle,
  normalizeSetTitle,
  variantCompatibility,
  variantTokens,
  variantsCompatible,
} from "./normalize.js";

export { normalizeMatchText } from "./normalize.js";

export const PRICECHARTING_MATCHER_VERSION = "pricecharting-matcher@0.2.0";
export const TRGM_REVIEW_THRESHOLD = 0.82;

export type MatchCandidate = {
  assetId: string;
  canonicalName: string;
  seriesTitle?: string | null;
  issueNumber?: string | null;
  coverLabel?: string | null;
  collectorNumber?: string | null;
  setName?: string | null;
  cardName?: string | null;
  clzValue?: number | null;
  upc?: string | null;
  /** pg_trgm similarity when the caller already computed it. */
  similarity?: number | null;
};

export type VendorProductInput = {
  vendorProductId: string;
  vendorProductName: string;
  vendorConsoleName?: string | null;
  vendorUpc?: string | null;
};

export type ExistingMapRow = {
  assetId: string | null;
  matchMethod: VendorMatchMethod;
  matchConfidence: number | null;
  needsReview: boolean;
  confirmedAt: Date | null;
};

function namesMatch(vendorName: string, candidateName: string): boolean {
  const a = normalizeMatchText(vendorName);
  const b = normalizeMatchText(candidateName);
  return a.length > 0 && a === b;
}

export function seriesMatches(
  vendorConsole: string | null | undefined,
  seriesTitle: string | null | undefined,
): boolean {
  if (!vendorConsole || !seriesTitle) return false;
  const a = normalizeSeriesTitle(vendorConsole);
  const b = normalizeSeriesTitle(seriesTitle);
  return a.length > 0 && a === b;
}

export function setMatches(
  vendorConsole: string | null | undefined,
  setName: string | null | undefined,
): boolean {
  if (!vendorConsole || !setName) return false;
  const a = normalizeSetTitle(vendorConsole);
  const b = normalizeSetTitle(setName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function issueMatches(vendorName: string, issueNumber: string | null | undefined): boolean {
  const vendorIssue = extractIssueNumber(vendorName);
  const assetIssue = (issueNumber ?? "").replace(/\D/g, "");
  return Boolean(vendorIssue && assetIssue && vendorIssue === assetIssue);
}

function comicExactHit(vendor: VendorProductInput, candidate: MatchCandidate): boolean {
  if (!seriesMatches(vendor.vendorConsoleName, candidate.seriesTitle)) return false;
  if (!issueMatches(vendor.vendorProductName, candidate.issueNumber)) return false;
  return variantsCompatible(
    variantTokens(`${candidate.coverLabel ?? ""} ${candidate.canonicalName}`),
    variantTokens(vendor.vendorProductName),
  );
}

function pokemonExactHit(vendor: VendorProductInput, candidate: MatchCandidate): boolean {
  if (!setMatches(vendor.vendorConsoleName, candidate.setName ?? candidate.seriesTitle)) return false;
  const vendorNum = extractCollectorNumber(vendor.vendorProductName);
  const assetNum = (candidate.collectorNumber ?? "").replace(/^0+/, "") || candidate.collectorNumber;
  if (vendorNum && assetNum && vendorNum !== String(assetNum).replace(/^0+/, "")) return false;
  const vendorName = normalizeMatchText(vendor.vendorProductName.replace(/#\s*\d+[a-z]?.*/i, " "));
  const cardName = normalizeMatchText(candidate.cardName ?? candidate.canonicalName);
  return vendorName.length > 0 && (vendorName === cardName || vendorName.includes(cardName) || cardName.includes(vendorName));
}

/**
 * Match a PriceCharting product to a vault_core.asset.
 * Confirmed existing rows are never overwritten.
 */
export function matchVendorProduct(
  vendor: VendorProductInput,
  candidates: MatchCandidate[],
  existing?: ExistingMapRow | null,
): Omit<VendorProductMap, "confirmedBy"> {
  if (existing?.confirmedAt) {
    return {
      vendorProductId: vendor.vendorProductId,
      vendorProductName: vendor.vendorProductName,
      vendorConsoleName: vendor.vendorConsoleName ?? null,
      vendorUpc: vendor.vendorUpc ?? null,
      assetId: existing.assetId,
      pricedUnitId: null,
      matchMethod: existing.matchMethod,
      matchConfidence: existing.matchConfidence,
      needsReview: existing.needsReview,
      confirmedAt: existing.confirmedAt,
    };
  }

  const upc = vendor.vendorUpc?.trim();
  if (upc) {
    const hit = candidates.find((c) => c.upc && c.upc.trim() === upc);
    if (hit) {
      return finish(vendor, hit.assetId, "upc", 0.98, false);
    }
  }

  const comicHits = candidates.filter((c) => c.seriesTitle && comicExactHit(vendor, c));
  if (comicHits.length === 1 && comicHits[0]) {
    const compat = variantCompatibility(
      variantTokens(`${comicHits[0].coverLabel ?? ""} ${comicHits[0].canonicalName}`),
      variantTokens(vendor.vendorProductName),
    );
    const competingIssues =
      variantTokens(vendor.vendorProductName).size === 0
        ? candidates.filter((c) => c.seriesTitle && issueMatches(vendor.vendorProductName, c.issueNumber)).length > 1
        : false;
    return finish(
      vendor,
      comicHits[0].assetId,
      "exact_name",
      0.9,
      compat === "compatible_review" || competingIssues,
    );
  }
  if (comicHits.length > 1) {
    return finish(vendor, comicHits[0]?.assetId ?? null, "exact_name", 0.9, true);
  }

  const pokemonHits = candidates.filter((c) => (c.setName || c.cardName) && pokemonExactHit(vendor, c));
  if (pokemonHits.length === 1 && pokemonHits[0]) {
    return finish(vendor, pokemonHits[0].assetId, "exact_name", 0.9, false);
  }
  if (pokemonHits.length > 1) {
    return finish(vendor, pokemonHits[0]?.assetId ?? null, "exact_name", 0.9, true);
  }

  const exact = candidates.find((c) => namesMatch(vendor.vendorProductName, c.canonicalName));
  if (exact) {
    const bothHaveSet = Boolean(vendor.vendorConsoleName) && Boolean(exact.seriesTitle || exact.setName);
    if (bothHaveSet && (seriesMatches(vendor.vendorConsoleName, exact.seriesTitle) || setMatches(vendor.vendorConsoleName, exact.setName))) {
      return finish(vendor, exact.assetId, "exact_name", 0.9, false);
    }
    if (!bothHaveSet) {
      return finish(vendor, exact.assetId, "exact_name", 0.9, true);
    }
  }

  const fuzzy = candidates
    .filter((c) => typeof c.similarity === "number" && (c.similarity ?? 0) >= TRGM_REVIEW_THRESHOLD)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
  if (fuzzy && fuzzy.similarity != null) {
    return finish(vendor, fuzzy.assetId, "trgm", Number(fuzzy.similarity.toFixed(2)), true);
  }

  return finish(vendor, null, "unmatched", null, true);
}

export type AssetMatchResult = {
  assetId: string;
  vendor: VendorProductInput | null;
  matchMethod: VendorMatchMethod;
  matchConfidence: number | null;
  needsReview: boolean;
  candidatesAfterSeries: number;
  candidatesAfterIssue: number;
};

export function vendorIndexKey(vendor: VendorProductInput, mode: "comic" | "pokemon"): string {
  return mode === "pokemon"
    ? normalizeSetTitle(vendor.vendorConsoleName)
    : normalizeSeriesTitle(vendor.vendorConsoleName);
}

export function assetIndexKey(asset: MatchCandidate): string {
  if (asset.setName || asset.cardName) return normalizeSetTitle(asset.setName ?? asset.seriesTitle);
  return normalizeSeriesTitle(asset.seriesTitle);
}

export function indexVendorsBySeries(
  vendors: VendorProductInput[],
  mode: "comic" | "pokemon",
): Map<string, VendorProductInput[]> {
  const index = new Map<string, VendorProductInput[]>();
  for (const vendor of vendors) {
    const key = vendorIndexKey(vendor, mode);
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(vendor);
    else index.set(key, [vendor]);
  }
  return index;
}

export function matchAssetToVendorProducts(
  asset: MatchCandidate,
  vendors: VendorProductInput[],
  seriesIndex?: Map<string, VendorProductInput[]>,
): AssetMatchResult {
  const mode: "comic" | "pokemon" = asset.setName || asset.cardName ? "pokemon" : "comic";
  const seriesPool = seriesIndex?.get(assetIndexKey(asset)) ?? vendors.filter((vendor) => {
    if (mode === "pokemon") {
      return setMatches(vendor.vendorConsoleName, asset.setName ?? asset.seriesTitle);
    }
    return seriesMatches(vendor.vendorConsoleName, asset.seriesTitle);
  });
  const issueRanked = asset.setName || asset.cardName
    ? seriesPool
        .filter((vendor) => pokemonExactHit(vendor, asset))
        .map((vendor) => ({ vendor, compat: "compatible" as const }))
    : seriesPool
        .filter((vendor) => issueMatches(vendor.vendorProductName, asset.issueNumber))
        .map((vendor) => ({
          vendor,
          compat: variantCompatibility(
            variantTokens(`${asset.coverLabel ?? ""} ${asset.canonicalName}`),
            variantTokens(vendor.vendorProductName),
          ),
        }))
        .filter((row) => row.compat !== "incompatible");
  const issuePool = issueRanked.map((row) => row.vendor);
  const confirmedHits = issueRanked.filter((row) => row.compat === "compatible");
  const reviewHits = issueRanked.filter((row) => row.compat === "compatible_review");

  if (asset.upc) {
    const upcHit = vendors.find((v) => v.vendorUpc && v.vendorUpc.trim() === asset.upc?.trim());
    if (upcHit) {
      return {
        assetId: asset.assetId,
        vendor: upcHit,
        matchMethod: "upc",
        matchConfidence: 0.98,
        needsReview: false,
        candidatesAfterSeries: seriesPool.length,
        candidatesAfterIssue: issuePool.length,
      };
    }
  }

  if (confirmedHits.length === 1 && confirmedHits[0]) {
    return {
      assetId: asset.assetId,
      vendor: confirmedHits[0].vendor,
      matchMethod: "exact_name",
      matchConfidence: 0.9,
      needsReview: false,
      candidatesAfterSeries: seriesPool.length,
      candidatesAfterIssue: issuePool.length,
    };
  }
  if (confirmedHits.length > 1 && confirmedHits[0]) {
    return {
      assetId: asset.assetId,
      vendor: confirmedHits[0].vendor,
      matchMethod: "exact_name",
      matchConfidence: 0.9,
      needsReview: true,
      candidatesAfterSeries: seriesPool.length,
      candidatesAfterIssue: issuePool.length,
    };
  }
  if (reviewHits.length >= 1 && reviewHits[0]) {
    return {
      assetId: asset.assetId,
      vendor: reviewHits[0].vendor,
      matchMethod: "exact_name",
      matchConfidence: 0.9,
      needsReview: true,
      candidatesAfterSeries: seriesPool.length,
      candidatesAfterIssue: issuePool.length,
    };
  }

  const fuzzy = seriesPool
    .map((vendor) => ({
      vendor,
      similarity: tokenDice(vendor.vendorProductName, asset.canonicalName),
    }))
    .filter((row) => row.similarity >= TRGM_REVIEW_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)[0];
  if (fuzzy) {
    return {
      assetId: asset.assetId,
      vendor: fuzzy.vendor,
      matchMethod: "trgm",
      matchConfidence: Number(fuzzy.similarity.toFixed(2)),
      needsReview: true,
      candidatesAfterSeries: seriesPool.length,
      candidatesAfterIssue: issuePool.length,
    };
  }

  return {
    assetId: asset.assetId,
    vendor: null,
    matchMethod: "unmatched",
    matchConfidence: null,
    needsReview: true,
    candidatesAfterSeries: seriesPool.length,
    candidatesAfterIssue: issuePool.length,
  };
}

function tokenDice(a: string, b: string): number {
  const left = new Set(normalizeMatchText(a).split(" ").filter(Boolean));
  const right = new Set(normalizeMatchText(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  return (2 * inter) / (left.size + right.size);
}

function finish(
  vendor: VendorProductInput,
  assetId: string | null,
  matchMethod: VendorMatchMethod,
  matchConfidence: number | null,
  needsReview: boolean,
): Omit<VendorProductMap, "confirmedBy"> {
  return {
    vendorProductId: vendor.vendorProductId,
    vendorProductName: vendor.vendorProductName,
    vendorConsoleName: vendor.vendorConsoleName ?? null,
    vendorUpc: vendor.vendorUpc ?? null,
    assetId,
    pricedUnitId: null,
    matchMethod,
    matchConfidence,
    needsReview,
  };
}
