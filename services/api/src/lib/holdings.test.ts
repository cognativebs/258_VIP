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
    expect(row.coverImageUrl).toBe("https://images.pokemontcg.io/base1/4.png");
    expect(row.series).toBe("Base Set");
    expect(row.issue).toBe("4");
    expect(row.assetName).toContain("Charizard Holo");
  });
});

describe("mapInventoryRow inventory buckets", () => {
  it("classifies Batman as personal collection", () => {
    const h = mapInventoryRow(
      {
        "CLZ Hash": "clz-batman",
        Series: "Batman",
        "Issue Full": "1",
        Publisher: "DC",
        "Collection Pillar": "Batman",
        Recommendation: "Museum Candidate",
        "Current Price": 46,
      },
      0,
    );
    expect(h.inventoryBucket).toBe("personal_collection");
    expect(h.inventoryBucketAssignment).toBe("inferred");
  });

  it("keeps an operator override", () => {
    const h = mapInventoryRow(
      {
        "CLZ Hash": "clz-x",
        Series: "X-Men",
        "Collection Pillar": "X-Men",
        "Inventory Bucket": "dealer_inventory",
        "Inventory Bucket Source": "operator",
      },
      0,
    );
    expect(h.inventoryBucket).toBe("dealer_inventory");
    expect(h.inventoryBucketAssignment).toBe("operator");
  });

  it("treats blank current disposition as unset", () => {
    const h = mapInventoryRow(
      {
        "CLZ Hash": "clz-blank-disp",
        Series: "X-Men",
        "Current Disposition": "",
        "Sales Path State": "",
        "eBay SKU": "",
      },
      0,
    );
    expect(h.currentDisposition).toBeNull();
    expect(h.salesPathState).toBe("available");
    expect(h.ebaySku).toBeNull();
  });
});
