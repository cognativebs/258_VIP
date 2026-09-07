import type { CatalogResolverResult } from "./resolver-schemas.js";

export const FIXTURE_ADAPTER_ID = "fixture-catalog";

export type PersistQueryHint = {
  nameHint?: string;
  collectorNumber?: string;
};

/**
 * Persist only a completed real-adapter pass, or a fixture-only resolver
 * (tests / VIP_CATALOG_FIXTURE=1). A TCGdex timeout must not freeze
 * Charizard/Pikachu onto this hash forever. An empty miss without a
 * name/number query must not freeze "unknown" onto noisy OCR forever.
 */
export function shouldPersistIdentification(
  result: CatalogResolverResult,
  query?: PersistQueryHint,
): boolean {
  const real = result.outcomes.filter((o) => o.adapterId !== FIXTURE_ADAPTER_ID);
  if (real.length === 0) {
    return result.outcomes.some((o) => o.status === "ok" && o.called);
  }
  if (!real.some((o) => o.status === "ok")) return false;
  if (result.candidates.length === 0) {
    return Boolean(query?.nameHint?.trim() || query?.collectorNumber?.trim());
  }
  return true;
}

/**
 * Identification cache keyed on `raw_snapshots.content_hash` (ADR 0010 §5).
 * Same bytes must always yield the same candidates without a provider call.
 */
export type IdentificationCache = {
  get: (contentHash: string) => Promise<CatalogResolverResult | undefined>;
  set: (contentHash: string, result: CatalogResolverResult) => Promise<void>;
  size?: () => number;
};

export function createMemoryIdentificationCache(): IdentificationCache {
  const store = new Map<string, CatalogResolverResult>();
  return {
    async get(contentHash) {
      const hit = store.get(contentHash);
      return hit ? structuredClone(hit) : undefined;
    },
    async set(contentHash, result) {
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
