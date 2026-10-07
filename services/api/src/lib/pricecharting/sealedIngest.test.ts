import { describe, expect, it } from "vitest";
import { OWNED_SEALED_HOLDINGS, sealedProductType, slugForSealed } from "./sealedIngest.js";

describe("sealedProductType", () => {
  it("maps hunt booster boxes and PC ETBs", () => {
    expect(sealedProductType("booster_box", "Destined Rivals Booster Box")).toBe("booster_box");
    expect(sealedProductType("pc_etb", "Perfect Order Pokémon Center ETB")).toBe("etb");
  });
});

describe("OWNED_SEALED_HOLDINGS", () => {
  it("is the three hunt-owned sealed SKUs", () => {
    expect(OWNED_SEALED_HOLDINGS.map((h) => h.sourceRowId)).toEqual([
      "hold-destined-rivals-bb",
      "hold-chaos-rising-bb",
      "hold-perfect-order-pc-etb",
    ]);
    expect(OWNED_SEALED_HOLDINGS.every((h) => h.setName && h.name)).toBe(true);
  });
});

describe("slugForSealed", () => {
  it("builds a stable pokemon sealed slug", () => {
    expect(slugForSealed("Destined Rivals Booster Box")).toBe(
      "pokemon-sealed-destined-rivals-booster-box",
    );
  });
});
