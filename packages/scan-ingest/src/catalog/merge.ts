import type { IdentityCandidate } from "../schemas.js";

function extKey(source: string, value: string): string {
  return `${source.toLowerCase()}::${value.toLowerCase()}`;
}

/** Canonical identity keys for a candidate — never display name. */
export function candidateIdentityKeys(candidate: IdentityCandidate): string[] {
  const keys = candidate.externalIds.map((ext) => extKey(ext.source, ext.value));
  if (keys.length === 0) keys.push(`catalogKey::${candidate.catalogKey}`);
  return keys;
}

function unionExternalIds(
  a: IdentityCandidate["externalIds"],
  b: IdentityCandidate["externalIds"],
): IdentityCandidate["externalIds"] {
  const seen = new Set<string>();
  const out: IdentityCandidate["externalIds"] = [];
  for (const ext of [...a, ...b]) {
    const key = extKey(ext.source, ext.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: ext.source, value: ext.value });
  }
  return out;
}

/**
 * Merge adapter-scored candidates that share an `external_id`.
 *
 * Two adapters agreeing is a corroboration signal in `match_reasons`, not a
 * second row and not a confidence boost — adding scores would inflate the
 * auto-resolve margin (plan 0001 Phase 0 risk).
 */
export function mergeCandidatesByExternalId(
  scored: IdentityCandidate[],
): IdentityCandidate[] {
  const groups: IdentityCandidate[][] = [];
  const groupByKey = new Map<string, number>();

  const findGroup = (candidate: IdentityCandidate): number | undefined => {
    for (const key of candidateIdentityKeys(candidate)) {
      const idx = groupByKey.get(key);
      if (idx !== undefined) return idx;
    }
    return undefined;
  };

  for (const candidate of scored) {
    const existing = findGroup(candidate);
    if (existing === undefined) {
      const idx = groups.length;
      groups.push([candidate]);
      for (const key of candidateIdentityKeys(candidate)) {
        groupByKey.set(key, idx);
      }
    } else {
      groups[existing]!.push(candidate);
      for (const key of candidateIdentityKeys(candidate)) {
        groupByKey.set(key, existing);
      }
    }
  }

  return groups
    .map((group) => {
      const ranked = [...group].sort((a, b) => b.confidence - a.confidence);
      const primary = ranked[0]!;
      if (ranked.length === 1) return primary;

      const reasons = new Set(primary.matchReasons);
      const adapterIds = new Set(
        ranked.map((c) => c.adapterId).filter((id): id is string => Boolean(id)),
      );
      for (const other of ranked.slice(1)) {
        for (const reason of other.matchReasons) reasons.add(reason);
        if (other.adapterId && other.adapterId !== primary.adapterId) {
          reasons.add(`corroborated:${other.adapterId}`);
        }
      }
      if (adapterIds.size > 1) {
        reasons.add(`corroborated:${[...adapterIds].sort().join("+")}`);
      }

      let externalIds = primary.externalIds;
      for (const other of ranked.slice(1)) {
        externalIds = unionExternalIds(externalIds, other.externalIds);
      }

      // Keep the best single-adapter score. Do not sum / average / boost.
      return {
        ...primary,
        externalIds,
        matchReasons: [...reasons],
        confidence: primary.confidence,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
