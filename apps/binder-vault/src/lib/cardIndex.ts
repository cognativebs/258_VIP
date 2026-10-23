import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CardResult } from "./contracts";
import type { SetOption } from "./filters";

/**
 * Local Pokémon card index — the primary search adapter (AGENTS.md rule 5).
 *
 * Built from the open PokemonTCG/pokemon-tcg-data repository: the same card ids as
 * api.pokemontcg.io (so slots, prices and FMV keep working), without that API's
 * intermittent 500s. Cached on disk (.data/card-index.json) and refreshed in the
 * background once it is a week old. Search runs in memory: card name, collector
 * number ("25", "4/102", "SWSH045"), set name, set id or set code, in any mix.
 */

const DATA_BASE = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
export const CARD_INDEX_SOURCE = "pokemon-tcg-data (pokemontcg.io ids)";
const INDEX_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type IndexedSet = {
  id: string;
  name: string;
  series: string;
  printedTotal: number | null;
  ptcgoCode: string | null;
  releaseDate: string;
};

export type IndexedCard = {
  id: string;
  name: string;
  number: string;
  setId: string;
  rarity: string | null;
  imageSmall: string | null;
  imageHigh: string | null;
};

export type CardIndex = {
  version: number;
  builtAt: number;
  sets: IndexedSet[];
  cards: IndexedCard[];
};

type Prepared = {
  card: IndexedCard;
  set: IndexedSet | undefined;
  nameWords: string[];
  nameFull: string;
  nameSquashed: string;
  number: string;
  setWords: string[];
  setKeys: Set<string>;
};

export type IndexSearchFilters = {
  setId?: string | null;
  /** Exact rarity strings (already expanded from chip keys); empty = any. */
  rarities?: string[];
};

/** Lowercase, strip accents and apostrophes, punctuation to spaces ("Farfetch'd" → "farfetchd"). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

/** Collector numbers compare without leading zeros: "004" = "4", "SWSH045" = "swsh45". */
export function normalizeNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(^|[a-z])0+(?=\d)/g, "$1");
}

const prepared = new WeakMap<CardIndex, Prepared[]>();

function prepare(index: CardIndex): Prepared[] {
  const hit = prepared.get(index);
  if (hit) return hit;
  const sets = new Map(index.sets.map((s) => [s.id, s]));
  const rows = index.cards.map((card) => {
    const set = sets.get(card.setId);
    const nameFull = normalizeText(card.name);
    const setKeys = new Set<string>([card.setId.toLowerCase()]);
    if (set?.ptcgoCode) setKeys.add(set.ptcgoCode.toLowerCase());
    return {
      card,
      set,
      nameWords: nameFull.split(" ").filter(Boolean),
      nameFull,
      nameSquashed: nameFull.replace(/ /g, ""),
      number: normalizeNumber(card.number),
      setWords: set ? normalizeText(set.name).split(" ").filter(Boolean) : [],
      setKeys,
    };
  });
  prepared.set(index, rows);
  return rows;
}

type Hit = { row: Prepared; score: number };

/** Score one card against the query tokens; null when any token matches nothing. */
function scoreCard(row: Prepared, tokens: string[], nameQuery: string): number | null {
  let score = 0;
  let nameTokens = 0;
  for (const token of tokens) {
    const slash = token.match(/^([a-z0-9]+)\/([a-z0-9]+)$/);
    if (slash) {
      if (normalizeNumber(slash[1]!) !== row.number) return null;
      // "4/102": a set that prints another total is not this card; promo sets without a total stay in.
      const total = Number.parseInt(slash[2]!, 10);
      if (row.set?.printedTotal && Number.isFinite(total) && row.set.printedTotal !== total) return null;
      score += row.set?.printedTotal ? 70 : 40;
      continue;
    }
    let best = 0;
    if (row.nameWords.some((w) => w === token)) best = 30;
    else if (row.nameWords.some((w) => w.startsWith(token))) best = 20;
    else if (token.length >= 3 && row.nameSquashed.startsWith(token)) best = 15;
    if (best) nameTokens += 1;
    if (/\d/.test(token) && normalizeNumber(token) === row.number) best = Math.max(best, 40);
    if (row.setKeys.has(token)) best = Math.max(best, 12);
    else if (row.setWords.includes(token)) best = Math.max(best, 10);
    else if (token.length >= 3 && row.setWords.some((w) => w.startsWith(token))) best = Math.max(best, 6);
    if (!best) return null;
    score += best;
  }
  if (nameQuery && nameTokens) {
    if (row.nameFull === nameQuery) score += 60;
    else if (row.nameFull.startsWith(nameQuery)) score += 25;
  }
  return score;
}

function byNumber(a: Prepared, b: Prepared): number {
  return a.card.number.localeCompare(b.card.number, undefined, { numeric: true });
}

/** Pure search over an index. Set browse (setId, no text) returns the set in collector order. */
export function searchCardIndex(
  index: CardIndex,
  query: string,
  filters: IndexSearchFilters,
  limit: number,
): IndexedCardHit[] {
  const rows = prepare(index);
  const setId = filters.setId?.trim() || null;
  const allow = filters.rarities?.length ? new Set(filters.rarities.map((r) => r.toLowerCase())) : null;
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  // The part of the query that reads as a name: drop pure numbers and n/total tokens.
  const nameQuery = tokens.filter((t) => !/^\d+$/.test(t) && !t.includes("/")).join(" ");

  const hits: Hit[] = [];
  for (const row of rows) {
    if (setId && row.card.setId !== setId) continue;
    if (allow && !(row.card.rarity && allow.has(row.card.rarity.toLowerCase()))) continue;
    if (!tokens.length) {
      hits.push({ row, score: 0 });
      continue;
    }
    const score = scoreCard(row, tokens, nameQuery);
    if (score != null) hits.push({ row, score });
  }

  if (setId && !tokens.length) {
    hits.sort((a, b) => byNumber(a.row, b.row));
  } else {
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        (b.row.set?.releaseDate ?? "").localeCompare(a.row.set?.releaseDate ?? "") ||
        byNumber(a.row, b.row),
    );
  }
  return hits.slice(0, limit).map(({ row }) => ({ card: row.card, set: row.set }));
}

export type IndexedCardHit = { card: IndexedCard; set: IndexedSet | undefined };

export function indexHitToResult({ card, set }: IndexedCardHit): CardResult {
  return {
    source: "pokemontcg",
    externalId: card.id,
    name: card.name,
    setName: set?.name ?? null,
    number: card.number,
    rarity: card.rarity,
    imageSmall: card.imageSmall,
    imageHigh: card.imageHigh,
    priceMarket: null,
    priceCurrency: null,
    provenance: {
      method: "api",
      source: CARD_INDEX_SOURCE,
      modelVersion: `card-index@${INDEX_VERSION}`,
      confidence: 0.92,
      verificationStatus: "verified",
    },
  };
}

const byId = new WeakMap<CardIndex, Map<string, IndexedCard>>();

/** One card by its pokemontcg id (rarity, number) without a network call. */
export function findIndexedCard(index: CardIndex, externalId: string): IndexedCard | null {
  let map = byId.get(index);
  if (!map) {
    map = new Map(index.cards.map((c) => [c.id, c]));
    byId.set(index, map);
  }
  return map.get(externalId) ?? null;
}

export function indexSets(index: CardIndex): SetOption[] {
  return [...index.sets]
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .map((s) => ({ id: s.id, name: s.name, series: s.series, releaseDate: s.releaseDate }));
}

// ---------------------------------------------------------------- build + cache

type RawSet = {
  id: string;
  name: string;
  series?: string;
  printedTotal?: number;
  ptcgoCode?: string;
  releaseDate?: string;
};
type RawCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  images?: { small?: string; large?: string };
};

/** Pure: raw dataset files → index. */
export function buildCardIndex(sets: RawSet[], cardsBySet: Map<string, RawCard[]>, builtAt = Date.now()): CardIndex {
  const cards: IndexedCard[] = [];
  for (const set of sets) {
    for (const c of cardsBySet.get(set.id) ?? []) {
      cards.push({
        id: c.id,
        name: c.name,
        number: c.number ?? "",
        setId: set.id,
        rarity: c.rarity ?? null,
        imageSmall: c.images?.small ?? null,
        imageHigh: c.images?.large ?? null,
      });
    }
  }
  return {
    version: INDEX_VERSION,
    builtAt,
    sets: sets.map((s) => ({
      id: s.id,
      name: s.name,
      series: s.series ?? "",
      printedTotal: s.printedTotal ?? null,
      ptcgoCode: s.ptcgoCode ?? null,
      releaseDate: s.releaseDate ?? "",
    })),
    cards,
  };
}

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let last = "failed";
  for (let i = 0; i < attempts; i++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30_000);
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, signal: ac.signal });
        if (res.ok) return (await res.json()) as T;
        last = String(res.status);
        if (res.status === 404) break;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw new Error(`card data ${last}: ${url}`);
}

/** Download the dataset and build an index. A set file that fails is skipped (logged in the result). */
export async function downloadCardIndex(concurrency = 8): Promise<{ index: CardIndex; failedSets: string[] }> {
  const sets = await fetchJson<RawSet[]>(`${DATA_BASE}/sets/en.json`);
  const cardsBySet = new Map<string, RawCard[]>();
  const failedSets: string[] = [];
  for (let i = 0; i < sets.length; i += concurrency) {
    await Promise.all(
      sets.slice(i, i + concurrency).map(async (s) => {
        try {
          cardsBySet.set(s.id, await fetchJson<RawCard[]>(`${DATA_BASE}/cards/en/${encodeURIComponent(s.id)}.json`));
        } catch {
          failedSets.push(s.id);
        }
      }),
    );
  }
  return { index: buildCardIndex(sets, cardsBySet), failedSets };
}

function indexPath(): string {
  return process.env.BINDER_CARD_INDEX_PATH || join(process.cwd(), ".data", "card-index.json");
}

function readIndexFromDisk(): CardIndex | null {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), "utf8")) as CardIndex;
    return parsed.version === INDEX_VERSION && Array.isArray(parsed.cards) && parsed.cards.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeIndexToDisk(index: CardIndex) {
  try {
    const path = indexPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(index), "utf8");
    renameSync(`${path}.tmp`, path);
  } catch {
    /* best effort: the in-memory index still serves */
  }
}

let current: CardIndex | null = null;
let building: Promise<CardIndex | null> | null = null;
let lastBuildError: string | null = null;

function rebuild(): Promise<CardIndex | null> {
  if (!building) {
    building = downloadCardIndex()
      .then(({ index }) => {
        current = index;
        lastBuildError = null;
        writeIndexToDisk(index);
        return index;
      })
      .catch((err) => {
        lastBuildError = err instanceof Error ? err.message : String(err);
        return current;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

/**
 * The index if one is available now (memory or disk); starts a background build when missing or
 * stale. waitMs > 0 waits that long for a first build instead of returning null at once.
 */
export async function getCardIndex(waitMs = 0): Promise<CardIndex | null> {
  // BINDER_CARD_INDEX=off: live APIs only, unless a test injected an index.
  if (process.env.BINDER_CARD_INDEX === "off") return current;
  if (!current) current = readIndexFromDisk();
  const stale = !current || Date.now() - current.builtAt > MAX_AGE_MS;
  if (stale) {
    const pending = rebuild();
    if (!current && waitMs > 0) {
      return Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
    }
  }
  return current;
}

export function cardIndexStatus() {
  return {
    loaded: !!current,
    builtAt: current ? new Date(current.builtAt).toISOString() : null,
    cards: current?.cards.length ?? 0,
    sets: current?.sets.length ?? 0,
    building: !!building,
    lastBuildError,
  };
}

/** Tests only. */
export function setCardIndexForTests(index: CardIndex | null) {
  current = index;
}
