import { describe, expect, it } from "vitest";
import { assertUniqueSkus, buildEbaySku, compactInventoryId, parseEbaySku } from "./sku.js";

const HOLDING = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("ebay SKU", () => {
  it("mints a durable unique SKU that does not encode mutable fields", () => {
    const sku = buildEbaySku("comic", HOLDING);
    expect(sku).toBe("IQV-COMIC-AAAAAAAABBBB4CCC8DDDEEEEEEEEEEEE");
    expect(sku.length).toBeLessThanOrEqual(50);
    expect(sku.includes("BATMAN")).toBe(false);
    expect(parseEbaySku(sku)?.category).toBe("comic");
  });

  it("uses a distinct token per category", () => {
    expect(buildEbaySku("sports", HOLDING)).toContain("SPORTS");
    expect(buildEbaySku("pokemon", HOLDING)).toContain("POKEMON");
    expect(buildEbaySku("mtg", HOLDING)).toContain("MTG");
  });

  it("rejects short or colliding identifiers", () => {
    expect(() => compactInventoryId("abc")).toThrow(/too short/);
    expect(() => assertUniqueSkus(["IQV-COMIC-AAAAAAAA", "IQV-COMIC-AAAAAAAA"])).toThrow(
      /Duplicate SKU/,
    );
    assertUniqueSkus(["IQV-COMIC-AAAAAAAA", "IQV-COMIC-BBBBBBBB"]);
  });
});
