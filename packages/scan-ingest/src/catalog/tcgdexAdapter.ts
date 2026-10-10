import type { CatalogCard } from "../schemas.js";
import type {
  CatalogAdapter,
  CatalogQuery,
  CatalogRawResponse,
} from "./types.js";

const TCGDEX = "https://api.tcgdex.net/v2/en";
/** Set list (id, name, official card count) is re-read at most every 6 hours. */
const SETS_TTL_MS = 6 * 60 * 60 * 1000;
/** At most this many sets share one printed total in practice; more is noise. */
const MAX_SETS_PER_TOTAL = 4;

type TcgdexSet = { id: string; name: string; cardCount?: { official?: number; total?: number } };
let setsCache: { at: number; sets: TcgdexSet[] } | null = null;

/** Test hook. */
export function resetTcgdexSetsCache(): void {
  setsCache = null;
}

/** "146/159" → 159 (the set's printed total), so a number-only scan can still find its set. */
export function setTotalFromCollector(raw?: string): number | undefined {
  const m = raw?.match(/\d{1,3}[a-z]?\s*\/\s*(\d{2,4})/i);
  return m ? Number(m[1]) : undefined;
}

function localIdFromCollector(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.replace(/^#/, "").trim();
  const m = t.match(/^(\d{1,3}[a-z]?)(?:\s*\/\s*\d{1,4})?$/i);
  return m?.[1];
}

const TCGDEX_SKIP = new Set([
  "base",
  "set",
  "holo",
  "holofoil",
  "rare",
  "pokemon",
  "pokémon",
  "tcg",
  "the",
  "and",
  "hp",
  "basic",
  "stage",
  "ex",
  "gx",
  "vmax",
  "vstar",
  "scarlet",
  "violet",
  "card",
  "english",
  "japanese",
  "promo",
  "illustration",
  "trainer",
  "front",
  "back",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "webp",
  "image",
  "scan",
]);

/**
 * Pull a TCGdex `name` + optional `localId` out of structured scan text.
 * First-three-tokens of "1999 Pokémon #4 Charizard" is "1999 Pokémon #4" and
 * misses the card. Prefer a privileged name hint, then alphabetic tokens.
 */
export function tcgdexSearchTerms(input: {
  text: string;
  nameHint?: string;
  collectorNumber?: string;
}): { name: string; localId?: string } {
  const text = input.text
    .trim()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  const hashNum = text.match(/#\s*(\d{1,4}[a-z]?)/i);
  const tokens = text
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/[._]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const yearLike = /^(19|20)\d{2}$/;
  const nums = tokens.filter(
    (t) => /^\d{1,4}[a-z]?$/.test(t) && !yearLike.test(t),
  );
  const fromHint = localIdFromCollector(input.collectorNumber);
  const localId = fromHint || hashNum?.[1] || nums[0];

  const hint = input.nameHint?.trim();
  if (hint) {
    return {
      name: hint.split(/\s+/).slice(0, 3).join(" "),
      localId,
    };
  }

  const nameTokens = tokens.filter(
    (t) => !/^\d/.test(t) && !TCGDEX_SKIP.has(t) && t.length > 2,
  );
  const unique: string[] = [];
  for (const token of nameTokens) {
    if (!unique.includes(token)) unique.push(token);
  }
  return {
    name: unique.slice(0, 2).join(" "),
    localId,
  };
}

export function parseTcgdexCards(
  raw: CatalogRawResponse,
  query: CatalogQuery,
): CatalogCard[] {
  let rows: Array<{
    id?: string;
    name?: string;
    localId?: string;
    set?: { name?: string } | string;
    /** Set name looked up from the TCGdex set list by id prefix (brief search rows carry no set). */
    _setName?: string;
    /** The set's official (printed) card count, from the same list. */
    _setTotal?: number;
  }>;
  try {
    rows = JSON.parse(raw.payload) as typeof rows;
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : []).slice(0, query.limit ?? 8).map((row) => {
    const setName =
      typeof row.set === "string" ? row.set : (row.set?.name ?? row._setName ?? null);
    return {
      catalogKey: `pokemon:tcgdex:${row.id ?? row.name}`,
      category: "pokemon" as const,
      displayName: row.name ?? "Unknown",
      setName,
      collectorNumber: row.localId ?? null,
      playerOrCharacter: row.name ?? null,
      year: null,
      // "002/094" in the text: a scan's printed number/total then favours the set it came from.
      searchText: `${row.name ?? ""} ${row.localId ?? ""} ${row.id ?? ""} ${setName ?? ""}${
        row._setTotal && row.localId ? ` ${printed(row.localId, row._setTotal)}` : ""
      }`,
      externalIds: row.id ? [{ source: "tcgdex", value: row.id }] : [],
    };
  });
}

export type TcgdexFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status?: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

/**
 * GET one TCGdex URL. 404 → null (no such card). Any other failure throws, so the resolver
 * records an error instead of "no cards" and the result is not cached; one retry after a short
 * pause covers rate limits and blips (a 25-card batch otherwise lost half its lookups).
 */
async function getTcgdex(
  fetchImpl: TcgdexFetch,
  url: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ text: string; contentType: string } | null> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.ok) {
      return { text: await res.text(), contentType: res.headers.get("content-type") ?? "application/json" };
    }
    if (res.status === 404) return null;
    const retryable = res.status === undefined || res.status === 429 || res.status >= 500;
    if (attempt >= 2 || !retryable) throw new Error(`TCGdex HTTP ${res.status ?? "error"} for ${url}`);
    await sleep(800);
  }
}

async function tcgdexSets(fetchImpl: TcgdexFetch): Promise<TcgdexSet[]> {
  if (setsCache && Date.now() - setsCache.at < SETS_TTL_MS) return setsCache.sets;
  const got = await getTcgdex(fetchImpl, `${TCGDEX}/sets`);
  const sets = got ? (JSON.parse(got.text) as TcgdexSet[]) : [];
  setsCache = { at: Date.now(), sets: Array.isArray(sets) ? sets : [] };
  return setsCache.sets;
}

/** "2", 94 → "002/094"; TCGdex sets print numbers to the width of the total. */
function printed(localId: string, total: number): string {
  const width = String(total).length < 3 ? 3 : String(total).length;
  const bare = localId.replace(/^0+(?=\d)/, "");
  return `${/^\d+$/.test(bare) ? bare.padStart(width, "0") : bare}/${String(total).padStart(width, "0")}`;
}

function setIdOf(cardId: string | undefined): string | undefined {
  const i = cardId?.lastIndexOf("-") ?? -1;
  return i > 0 ? cardId!.slice(0, i) : undefined;
}

function sameLocalId(a: string, b: string): boolean {
  return a.replace(/^0+(?=\d)/, "").toLowerCase() === b.replace(/^0+(?=\d)/, "").toLowerCase();
}

/** One card by set + number; TCGdex pads some sets' numbers ("me05-015") and not others ("swsh4-31"). */
async function fetchTcgdexCard(
  fetchImpl: TcgdexFetch,
  setId: string,
  localId: string,
): Promise<Record<string, unknown> | null> {
  const bare = localId.replace(/^0+(?=\d)/, "");
  const tries = [...new Set([localId, bare, bare.padStart(3, "0")])];
  for (const id of tries) {
    const got = await getTcgdex(fetchImpl, `${TCGDEX}/cards/${encodeURIComponent(`${setId}-${id}`)}`);
    if (got) return JSON.parse(got.text) as Record<string, unknown>;
  }
  return null;
}

export async function fetchTcgdexRaw(
  query: CatalogQuery,
  fetchImpl: TcgdexFetch = fetch,
): Promise<CatalogRawResponse | null> {
  const q = query.text.trim() || query.nameHint?.trim() || "";
  if (!q && !query.nameHint) return null;
  const category = query.category;
  if (category && category !== "pokemon") return null;
  const terms = tcgdexSearchTerms({
    text: query.text,
    nameHint: query.nameHint,
    collectorNumber: query.collectorNumber,
  });
  const total = setTotalFromCollector(query.collectorNumber) ?? setTotalFromCollector(query.text);
  if (!terms.name && !(terms.localId && total)) return null;

  const rows: Array<Record<string, unknown>> = [];
  if (terms.name) {
    let found = await fetchTcgdexCards(fetchImpl, terms.name, terms.localId);
    if (terms.localId && found && isEmptyCardPayload(found.payload)) {
      found = await fetchTcgdexCards(fetchImpl, terms.name, undefined);
    }
    if (found) rows.push(...(JSON.parse(found.payload) as Array<Record<string, unknown>>));
  }

  // A printed "NNN/TTT" names the set by its official card count: fetch that card from each
  // set with that count, so a scan whose name OCR failed still gets an exact set + number.
  const sets = await tcgdexSets(fetchImpl);
  if (terms.localId && total) {
    const matching = sets.filter((s) => s.cardCount?.official === total).slice(0, MAX_SETS_PER_TOTAL);
    for (const set of matching) {
      const already = rows.some(
        (r) => setIdOf(String(r.id ?? "")) === set.id && sameLocalId(String(r.localId ?? ""), terms.localId!),
      );
      if (already) continue;
      const card = await fetchTcgdexCard(fetchImpl, set.id, terms.localId);
      if (card) rows.push({ ...card, _byPrintedTotal: total });
    }
  }
  const byId = new Map(sets.map((s) => [s.id, s]));
  const annotated = rows.map((r) => {
    const set = byId.get(setIdOf(String(r.id ?? "")) ?? "");
    if (!set) return r;
    return {
      ...r,
      ...(r.set ? {} : { _setName: set.name }),
      ...(set.cardCount?.official ? { _setTotal: set.cardCount.official } : {}),
    };
  });
  return { payload: JSON.stringify(annotated), contentType: "application/json" };
}

function isEmptyCardPayload(payload: string): boolean {
  try {
    const rows = JSON.parse(payload) as unknown;
    return Array.isArray(rows) && rows.length === 0;
  } catch {
    return false;
  }
}

async function fetchTcgdexCards(
  fetchImpl: TcgdexFetch,
  name: string,
  localId?: string,
): Promise<CatalogRawResponse | null> {
  const params = new URLSearchParams({ name });
  if (localId) params.set("localId", localId);
  const got = await getTcgdex(fetchImpl, `${TCGDEX}/cards?${params.toString()}`);
  if (!got) return null;
  return { payload: got.text, contentType: got.contentType };
}

/**
 * Pokémon / TCG text search — same public API Binder already uses.
 * Not used for sports. TCGplayer public API is closed (AGENTS.md).
 * Catalog truth only — never a valuation (ADR 0010 / plan 0001 Phase 1).
 */
export function createTcgdexCatalogAdapter(opts: { fetch?: TcgdexFetch } = {}): CatalogAdapter {
  const fetchImpl = opts.fetch ?? fetch;
  return {
    id: "tcgdex",
    label: "TCGdex (pokemon)",
    categories: ["pokemon"],
    // A lookup can be a name search plus a few set + number fetches (and one retry).
    timeoutMs: 9000,
    fetchRaw: (query) => fetchTcgdexRaw(query, fetchImpl),
    parseRaw: parseTcgdexCards,
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      const raw = await fetchTcgdexRaw(query, fetchImpl);
      if (!raw) return [];
      return parseTcgdexCards(raw, query);
    },
  };
}
