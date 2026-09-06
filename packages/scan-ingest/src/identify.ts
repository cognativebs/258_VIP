import { markInferred } from "@vip/evidence";
import { SCAN_ID_RULE } from "./constants.js";
import { FIXTURE_CATALOG } from "./catalog/fixture-catalog.js";
import type { CatalogAdapter, CatalogQuery } from "./catalog/types.js";
import type {
  CatalogCard,
  IdentityCandidate,
  ScanCategory,
  ScanUnit,
} from "./schemas.js";
import { sportsParsedCandidate } from "./sportsIdentity.js";

export type IdentifyOptions = {
  catalog?: CatalogCard[];
  categoryHint?: ScanCategory | null;
  /** Max candidates returned (ranked). */
  limit?: number;
  /** Exact ids read from a barcode / QR, when the capture provides them. */
  externalIds?: Array<{ source: string; value: string }>;
};

type IdentifyInput = Pick<
  ScanUnit,
  "ocrText" | "frontStorageRef" | "categoryHint"
>;

/** PaperStream default names carry no identity — do not score them. */
export function isGenericScanFileName(name: string): boolean {
  const stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, "");
  return /^(img|image|scan|doc|dsc)[_-]?\d+$/i.test(stem);
}

/** Text the matcher scores against: OCR when present, else a non-generic file name. */
export function queryTextFor(unit: IdentifyInput): string {
  const file = baseName(unit.frontStorageRef);
  const name = isGenericScanFileName(file) ? "" : file;
  return normalize([unit.ocrText, name].filter(Boolean).join(" "));
}

export function buildCatalogQuery(
  unit: IdentifyInput,
  opts: IdentifyOptions = {},
): CatalogQuery {
  return {
    text: queryTextFor(unit),
    category: opts.categoryHint ?? unit.categoryHint ?? null,
    externalIds: opts.externalIds ?? [],
    limit: opts.limit ?? 5,
  };
}

/**
 * Score OCR / filename text against a catalog.
 * Results are always inferred · unverified until human confirm (ADR 0009).
 */
export function identifyUnit(
  unit: IdentifyInput,
  opts: IdentifyOptions = {},
): IdentityCandidate[] {
  const catalog = opts.catalog ?? FIXTURE_CATALOG;
  const hint = opts.categoryHint ?? unit.categoryHint ?? null;
  const query = queryTextFor(unit);
  const externalIds = opts.externalIds ?? [];

  if (!query && externalIds.length === 0) {
    return [];
  }

  const ranked = rankCandidates(
    catalog.filter((card) => !hint || card.category === hint),
    query,
    externalIds,
    opts.limit ?? 5,
  );
  return withSportsParse(ranked, query, hint, opts.limit ?? 5);
}

/**
 * Adapter-backed identification. Same scoring for every adapter so a swap
 * cannot quietly change what "0.9 confidence" means.
 */
export async function identifyUnitWithAdapter(
  unit: IdentifyInput,
  adapter: CatalogAdapter,
  opts: IdentifyOptions = {},
): Promise<IdentityCandidate[]> {
  const query = buildCatalogQuery(unit, opts);
  if (!query.text && (query.externalIds?.length ?? 0) === 0) return [];
  const cards = await adapter.search(query);
  const ranked = rankCandidates(
    cards,
    query.text,
    query.externalIds ?? [],
    query.limit ?? 5,
    adapter.id,
  );
  return withSportsParse(
    ranked,
    query.text,
    opts.categoryHint ?? unit.categoryHint ?? query.category ?? null,
    query.limit ?? 5,
  );
}

function withSportsParse(
  ranked: IdentityCandidate[],
  query: string,
  hint: ScanCategory | null,
  limit: number,
): IdentityCandidate[] {
  const sportsHint = !hint || hint === "sports";
  if (!sportsHint || !query) return ranked;
  const parsed = sportsParsedCandidate(query);
  if (!parsed) return ranked;
  const already = ranked.some(
    (c) =>
      c.playerOrCharacter &&
      parsed.playerOrCharacter &&
      normalize(c.playerOrCharacter) === normalize(parsed.playerOrCharacter) &&
      c.year === parsed.year,
  );
  if (already) return ranked;
  return [...ranked, parsed]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Same pipeline scorer every adapter uses (ADR 0010). A swap cannot
 * silently redefine what 0.9 means.
 */
export function scoreCatalogCards(
  cards: CatalogCard[],
  query: string,
  externalIds: Array<{ source: string; value: string }>,
  limit: number,
  adapterId?: string,
): IdentityCandidate[] {
  return rankCandidates(cards, query, externalIds, limit, adapterId);
}

function rankCandidates(
  cards: CatalogCard[],
  query: string,
  externalIds: Array<{ source: string; value: string }>,
  limit: number,
  adapterId?: string,
): IdentityCandidate[] {
  return cards
    .map((card) => {
      const exact = matchesExternalId(card, externalIds);
      const score = exact ? 1 : scoreMatch(query, card);
      return { card, score, exact };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ card, score, exact }) =>
      toCandidate(card, score, matchReasons(query, card, exact), adapterId),
    );
}

function matchesExternalId(
  card: CatalogCard,
  externalIds: Array<{ source: string; value: string }>,
): boolean {
  if (externalIds.length === 0) return false;
  return card.externalIds.some((ext) =>
    externalIds.some(
      (want) =>
        want.source.toLowerCase() === ext.source.toLowerCase() &&
        want.value.toLowerCase() === ext.value.toLowerCase(),
    ),
  );
}

function toCandidate(
  card: CatalogCard,
  confidence: number,
  matchReasons: string[],
  adapterId?: string,
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
    adapterId,
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

function matchReasons(
  query: string,
  card: CatalogCard,
  exactExternalId = false,
): string[] {
  const reasons: string[] = [];
  if (exactExternalId) {
    const ext = card.externalIds[0];
    reasons.push(`external_id:${ext ? ext.source : "match"}`);
  }
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

/**
 * Last path segment for POSIX and Windows refs. PaperStream writes
 * `D:\VIP\scans\001_front.jpg`, so splitting on "/" alone would leave the whole
 * path in the query and dilute token scoring.
 */
function baseName(ref: string): string {
  return ref.split(/[\\/]/).pop() ?? ref;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
