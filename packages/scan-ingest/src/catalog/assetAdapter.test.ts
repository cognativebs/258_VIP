import { describe, expect, it } from "vitest";
import { createAssetCatalogAdapter, filterAssetCards } from "./assetAdapter.js";
import type { CatalogCard } from "../schemas.js";

const CONFIRMED: CatalogCard = {
  catalogKey: "pokemon:confirmed:charizard",
  category: "pokemon",
  displayName: "Charizard",
  setName: "Base Set",
  collectorNumber: "4",
  playerOrCharacter: "Charizard",
  year: 1999,
  searchText: "charizard base set 4",
  assetId: "11111111-1111-4111-8111-111111111111",
  externalIds: [{ source: "tcgdex", value: "base1-4" }],
};

describe("asset catalog adapter", () => {
  it("matches confirmed cards by external id first", () => {
    const hit = filterAssetCards([CONFIRMED], {
      text: "unrelated",
      externalIds: [{ source: "tcgdex", value: "base1-4" }],
    });
    expect(hit).toHaveLength(1);
    expect(hit[0]?.assetId).toBe(CONFIRMED.assetId);
  });

  it("matches by name tokens and keeps assetId", async () => {
    const adapter = createAssetCatalogAdapter({ cards: [CONFIRMED] });
    expect(adapter.id).toBe("postgres-assets");
    const cards = await adapter.search({
      text: "Charizard Base Set 4/102",
      category: "pokemon",
    });
    expect(cards[0]?.assetId).toBe(CONFIRMED.assetId);
    expect(cards[0]?.externalIds).toEqual([{ source: "tcgdex", value: "base1-4" }]);
  });

  it("never guesses a sports card from scraps when no player was read", async () => {
    const rourke: CatalogCard = {
      catalogKey: "asset:rourke",
      category: "sports",
      displayName: "2025 Panini Prizm Kurtis Rourke #397",
      setName: null,
      collectorNumber: "397",
      playerOrCharacter: "Kurtis Rourke",
      year: 2025,
      searchText: "2025 panini prizm kurtis rourke 397",
      assetId: "22222222-2222-4222-8222-222222222222",
      externalIds: [{ source: "sports_parsed", value: "rourke-397" }],
    };
    let searched = 0;
    const adapter = createAssetCatalogAdapter({
      search: async (q) => {
        searched += 1;
        return filterAssetCards([rourke], q);
      },
    });
    expect(await adapter.search({ text: "2025 Panini Prizm", category: "sports" })).toEqual([]);
    expect(searched).toBe(0);
    expect(await adapter.search({ text: "2025 Panini Prizm Kurtis Rourke", category: "sports", nameHint: "Kurtis Rourke" })).toHaveLength(1);
    expect(
      await adapter.search({ text: "x", category: "sports", externalIds: [{ source: "sports_parsed", value: "rourke-397" }] }),
    ).toHaveLength(1);
  });

  it("returns empty when the query has no identity signal", async () => {
    const adapter = createAssetCatalogAdapter({ cards: [CONFIRMED] });
    expect(await adapter.search({ text: "", category: "pokemon" })).toEqual([]);
  });
});
