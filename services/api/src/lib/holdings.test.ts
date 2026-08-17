import { describe, expect, it } from "vitest";
import { mapInventoryRow } from "./holdings.js";

describe("mapInventoryRow Pokémon card name", () => {
  it("uses Edition / Variant as the printed card name, not the set", () => {
    const row = mapInventoryRow(
      {
        "CLZ Hash": "pokemon-base1-4",
        Series: "Base Set",
        "Issue Full": "4",
        "Edition / Variant": "Charizard Holo",
        Publisher: "Wizards of the Coast",
        ExternalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
        "Assumed Grade": "NM assumed · unverified",
        "Slab Status": "raw",
      },
      0,
    );
    expect(row.cardName).toBe("Charizard Holo");
    expect(row.series).toBe("Base Set");
    expect(row.issue).toBe("4");
    expect(row.assetName).toContain("Charizard Holo");
  });
});
