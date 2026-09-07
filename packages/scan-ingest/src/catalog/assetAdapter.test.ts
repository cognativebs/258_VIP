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

  it("returns empty when the query has no identity signal", async () => {
    const adapter = createAssetCatalogAdapter({ cards: [CONFIRMED] });
    expect(await adapter.search({ text: "", category: "pokemon" })).toEqual([]);
  });
});
