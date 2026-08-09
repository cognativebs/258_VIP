import { markInferred } from "@vip/evidence";
import { SCAN_ID_RULE } from "./constants.js";
import { FIXTURE_CATALOG } from "./catalog/fixture-catalog.js";
import type {
  CatalogCard,
  IdentityCandidate,
  ScanCategory,
  ScanUnit,
} from "./schemas.js";

export type IdentifyOptions = {
  catalog?: CatalogCard[];
  categoryHint?: ScanCategory | null;
  /** Max candidates returned (ranked). */
  limit?: number;
};

/**
 * Score OCR / filename text against a catalog.
 * Results are always inferred · unverified until human confirm.
 */
export function identifyUnit(
  unit: Pick<ScanUnit, "ocrText" | "frontStorageRef" | "categoryHint">,
  opts: IdentifyOptions = {},
): IdentityCandidate[] {
  const catalog = opts.catalog ?? FIXTURE_CATALOG;
  const hint = opts.categoryHint ?? unit.categoryHint ?? null;
  const limit = opts.limit ?? 5;
  const query = normalize(
    [unit.ocrText, unit.frontStorageRef.split("/").pop()].filter(Boolean).join(" "),
  );

  if (!query) {
    return [];
  }

  const scored = catalog
    .filter((card) => !hint || card.category === hint)
    .map((card) => ({ card, score: scoreMatch(query, card) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ card, score }) =>
    toCandidate(card, score, matchReasons(query, card)),
  );
}

function toCandidate(
  card: CatalogCard,
  confidence: number,
  matchReasons: string[],
): IdentityCandidate {
  return {
    assetId: card.assetId ?? null,
    catalogKey: card.catalogKey,
    category: card.category,
    displayName: card.displayName,
    setName: card.setName ?? null,
    collectorNumber: card.collectorNumber ?? null,
    playerOrCharacter: card.playerOrCharacter ?? null,
    year: card.year ?? null,
    externalIds: card.externalIds,
    confidence,
    matchReasons,
    provenance: markInferred({
      source: "scan_id_matcher",
      ruleOrModelVersion: SCAN_ID_RULE,
      confidence,
      notes: "Catalog match from OCR/filename · unverified until operator confirm",
    }),
  };
}

function scoreMatch(query: string, card: CatalogCard): number {
  const hay = normalize(card.searchText);
  const tokens = query.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return 0;

  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) hits += 1;
  }
  const ratio = hits / tokens.length;

  // Boost exact collector number / name hits
  let boost = 0;
  if (card.collectorNumber && query.includes(normalize(card.collectorNumber))) {
    boost += 0.15;
  }
  if (card.playerOrCharacter && hay.includes(normalize(card.playerOrCharacter))) {
    const nameTokens = normalize(card.playerOrCharacter).split(/\s+/);
    if (nameTokens.every((t) => query.includes(t))) boost += 0.2;
  }

  const raw = Math.min(1, ratio * 0.75 + boost);
  return Number(raw.toFixed(3));
}

function matchReasons(query: string, card: CatalogCard): string[] {
  const reasons: string[] = [];
  const q = normalize(query);
  if (card.collectorNumber && q.includes(normalize(card.collectorNumber))) {
    reasons.push(`collector_number:${card.collectorNumber}`);
  }
  if (card.playerOrCharacter) {
    const name = normalize(card.playerOrCharacter);
    if (name.split(/\s+/).every((t) => q.includes(t))) {
      reasons.push(`name:${card.playerOrCharacter}`);
    }
  }
  if (card.setName && q.includes(normalize(card.setName))) {
    reasons.push(`set:${card.setName}`);
  }
  if (reasons.length === 0) reasons.push("token_overlap");
  return reasons;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
