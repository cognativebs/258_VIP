import type { CatalogCard } from "../schemas.js";
import { FIXTURE_CATALOG } from "./fixture-catalog.js";
import type { CatalogQuery, SyncCatalogAdapter } from "./types.js";

/**
 * Offline catalog used by tests and by a fresh install with no real catalog
 * wired up. Deliberately tiny: it must never be mistaken for coverage.
 */
export function createFixtureCatalogAdapter(
  cards: CatalogCard[] = FIXTURE_CATALOG,
): SyncCatalogAdapter {
  const searchSync = (query: CatalogQuery): CatalogCard[] => {
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
    if (byExternalId.length > 0) return byExternalId;

    return query.category
      ? cards.filter((card) => card.category === query.category)
      : [...cards];
  };

  return {
    id: "fixture-catalog",
    label: "Built-in fixture catalog (5 cards)",
    searchSync,
    search: async (query) => searchSync(query),
  };
}

export const FIXTURE_CATALOG_ADAPTER = createFixtureCatalogAdapter();
