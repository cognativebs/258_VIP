import type { CatalogResolverResult } from "./resolver-schemas.js";

/**
 * Identification cache keyed on `raw_snapshots.content_hash` (ADR 0010 §5).
 * Same bytes must always yield the same candidates without a provider call.
 */
export type IdentificationCache = {
  get: (contentHash: string) => CatalogResolverResult | undefined;
  set: (contentHash: string, result: CatalogResolverResult) => void;
  size: () => number;
};

export function createMemoryIdentificationCache(): IdentificationCache {
  const store = new Map<string, CatalogResolverResult>();
  return {
    get(contentHash) {
      const hit = store.get(contentHash);
      return hit ? structuredClone(hit) : undefined;
    },
    set(contentHash, result) {
      store.set(contentHash, structuredClone(result));
    },
    size: () => store.size,
  };
}

/** Stable JSON for the "byte-identical candidates" replay gate. */
export function canonicalizeCandidatesJson(
  candidates: CatalogResolverResult["candidates"],
): string {
  const rows = candidates.map((c) => ({
    assetId: c.assetId ?? null,
    catalogKey: c.catalogKey,
    category: c.category,
    displayName: c.displayName,
    setName: c.setName ?? null,
    collectorNumber: c.collectorNumber ?? null,
    playerOrCharacter: c.playerOrCharacter ?? null,
    year: c.year ?? null,
    adapterId: c.adapterId ?? null,
    confidence: c.confidence,
    matchReasons: [...c.matchReasons].sort(),
    externalIds: [...c.externalIds]
      .map((e) => ({ source: e.source, value: e.value }))
      .sort((a, b) =>
        `${a.source}:${a.value}`.localeCompare(`${b.source}:${b.value}`),
      ),
    provenance: {
      source: c.provenance.source,
      method: c.provenance.method,
      ruleOrModelVersion: c.provenance.ruleOrModelVersion,
      verificationStatus: c.provenance.verificationStatus,
    },
  }));
  rows.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.catalogKey.localeCompare(b.catalogKey);
  });
  return JSON.stringify(rows);
}
