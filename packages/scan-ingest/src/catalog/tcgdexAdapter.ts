import type { CatalogCard } from "../schemas.js";
import type { CatalogAdapter, CatalogQuery } from "./types.js";

const TCGDEX = "https://api.tcgdex.net/v2/en";

/**
 * Pokémon / TCG text search — same public API Binder already uses.
 * Not used for sports. TCGplayer public API is closed (AGENTS.md).
 */
export function createTcgdexCatalogAdapter(): CatalogAdapter {
  return {
    id: "tcgdex",
    label: "TCGdex (pokemon)",
    async search(query: CatalogQuery): Promise<CatalogCard[]> {
      const q = query.text.trim();
      if (!q) return [];
      const category = query.category;
      if (category && category !== "pokemon") return [];
      const name = q.split(/\s+/).slice(0, 3).join(" ");
      try {
        const url = `${TCGDEX}/cards?name=${encodeURIComponent(name)}`;
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) return [];
        const rows = (await res.json()) as Array<{
          id?: string;
          name?: string;
          localId?: string;
        }>;
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
      } catch {
        return [];
      }
    },
  };
}
