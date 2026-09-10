import type { CatalogCard } from "../schemas.js";
import type { CatalogAdapter, CatalogQuery } from "./types.js";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter already-confirmed catalog rows. External ids win; otherwise token
 * overlap on name / search text. Scoring stays in the pipeline scorer.
 */
export function filterAssetCards(
  cards: CatalogCard[],
  query: CatalogQuery,
): CatalogCard[] {
  const limit = query.limit ?? 5;
  const byExternalId = query.externalIds?.length
    ? cards.filter((card) =>
        card.externalIds.some((ext) =>
          query.externalIds!.some(
            (want) =>
              want.source.toLowerCase() === ext.source.toLowerCase() &&
              want.value.toLowerCase() === ext.value.toLowerCase(),
          ),
        ),
      )
    : [];
  if (byExternalId.length > 0) return byExternalId.slice(0, limit);

  const scoped = query.category
    ? cards.filter((card) => card.category === query.category)
    : cards;
  const q = normalize(query.text);
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return [];

  return scoped
    .filter((card) => {
      const hay = normalize(`${card.searchText} ${card.displayName}`);
      return tokens.some((token) => hay.includes(token));
    })
    .slice(0, limit);
}

export type AssetSearchFn = (query: CatalogQuery) => Promise<CatalogCard[]>;

/**
 * Confirmed-asset catalog (ADR 0010 diagram: "Postgres assets").
 * Live search is injected so this package never talks to the DB.
 */
export function createAssetCatalogAdapter(opts: {
  search?: AssetSearchFn;
  cards?: CatalogCard[];
  id?: string;
  label?: string;
}): CatalogAdapter {
  const cards = opts.cards ?? [];
  const searchFn =
    opts.search ??
    (async (query: CatalogQuery) => filterAssetCards(cards, query));
  return {
    id: opts.id ?? "postgres-assets",
    label: opts.label ?? "Confirmed VIP assets",
    timeoutMs: 800,
    search: searchFn,
  };
}
