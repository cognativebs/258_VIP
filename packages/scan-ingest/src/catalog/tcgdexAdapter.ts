import type { CatalogCard } from "../schemas.js";
import type {
  CatalogAdapter,
  CatalogQuery,
  CatalogRawResponse,
} from "./types.js";

const TCGDEX = "https://api.tcgdex.net/v2/en";

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
  const fromHint = input.collectorNumber?.replace(/^#/, "").trim();
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
  }>;
  try {
    rows = JSON.parse(raw.payload) as typeof rows;
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : []).slice(0, query.limit ?? 8).map((row) => {
    const setName =
      typeof row.set === "string" ? row.set : (row.set?.name ?? null);
    return {
      catalogKey: `pokemon:tcgdex:${row.id ?? row.name}`,
      category: "pokemon" as const,
      displayName: row.name ?? "Unknown",
      setName,
      collectorNumber: row.localId ?? null,
      playerOrCharacter: row.name ?? null,
      year: null,
      searchText: `${row.name ?? ""} ${row.localId ?? ""} ${row.id ?? ""} ${setName ?? ""}`,
      externalIds: row.id ? [{ source: "tcgdex", value: row.id }] : [],
    };
  });
}

export type TcgdexFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

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
  if (!terms.name) return null;
  const params = new URLSearchParams({ name: terms.name });
  if (terms.localId) params.set("localId", terms.localId);
  const url = `${TCGDEX}/cards?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const payload = await res.text();
  return {
    payload,
    contentType: res.headers.get("content-type") ?? "application/json",
  };
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
    timeoutMs: 2500,
    fetchRaw: (query) => fetchTcgdexRaw(query, fetchImpl),
    parseRaw: parseTcgdexCards,
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      const raw = await fetchTcgdexRaw(query, fetchImpl);
      if (!raw) return [];
      return parseTcgdexCards(raw, query);
    },
  };
}
