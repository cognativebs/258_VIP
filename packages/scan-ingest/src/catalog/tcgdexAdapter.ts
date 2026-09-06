import type { CatalogCard } from "../schemas.js";
import type {
  CatalogAdapter,
  CatalogQuery,
  CatalogRawResponse,
} from "./types.js";

const TCGDEX = "https://api.tcgdex.net/v2/en";

export function parseTcgdexCards(
  raw: CatalogRawResponse,
  query: CatalogQuery,
): CatalogCard[] {
  let rows: Array<{ id?: string; name?: string; localId?: string }>;
  try {
    rows = JSON.parse(raw.payload) as Array<{
      id?: string;
      name?: string;
      localId?: string;
    }>;
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : []).slice(0, query.limit ?? 5).map((row) => ({
    catalogKey: `pokemon:tcgdex:${row.id ?? row.name}`,
    category: "pokemon" as const,
    displayName: row.name ?? "Unknown",
    setName: null,
    collectorNumber: row.localId ?? null,
    playerOrCharacter: row.name ?? null,
    year: null,
    searchText: `${row.name ?? ""} ${row.localId ?? ""} ${row.id ?? ""}`,
    externalIds: row.id ? [{ source: "tcgdex", value: row.id }] : [],
  }));
}

export async function fetchTcgdexRaw(
  query: CatalogQuery,
): Promise<CatalogRawResponse | null> {
  const q = query.text.trim();
  if (!q) return null;
  const category = query.category;
  if (category && category !== "pokemon") return null;
  const name = q.split(/\s+/).slice(0, 3).join(" ");
  const url = `${TCGDEX}/cards?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
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
export function createTcgdexCatalogAdapter(): CatalogAdapter {
  return {
    id: "tcgdex",
    label: "TCGdex (pokemon)",
    categories: ["pokemon"],
    fetchRaw: fetchTcgdexRaw,
    parseRaw: parseTcgdexCards,
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      const raw = await fetchTcgdexRaw(query);
      if (!raw) return [];
      return parseTcgdexCards(raw, query);
    },
  };
}
