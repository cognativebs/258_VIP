import { describe, expect, it } from "vitest";
import { binderSlotToHolding, pgText } from "./binderHoldings.js";

describe("pgText", () => {
  it("reads snake_case or camelCase keys", () => {
    expect(pgText({ card_name: "Charizard" }, "card_name")).toBe("Charizard");
    expect(pgText({ cardName: "Pikachu" }, "card_name")).toBe("Pikachu");
  });
});

describe("binderSlotToHolding", () => {
  it("puts the printed name on cardName from a snake_case slot row", () => {
    const h = binderSlotToHolding({
      slot_id: "s1",
      binder_id: "b1",
      binder_name: "Base",
      page_title: "P1",
      page_index: 0,
      role_label: "",
      source: "pokemontcg",
      external_id: "base1-4",
      card_name: "Charizard",
      set_name: "Base Set",
      number: "4",
      rarity: "Rare Holo",
      image_url: null,
      image_local: null,
      price_market: 10,
      owned: true,
      verification_status: "unverified",
      provenance_source: "binder-vault",
      provenance_method: "api",
      provenance_model_version: "binder-adapter@0.2.0",
      confidence: 0.7,
    });
    expect(h.cardName).toBe("Charizard");
    expect(h.series).toBe("Base Set");
    expect(h.coverImageUrl).toBe("https://images.pokemontcg.io/base1/4.png");
  });

  it("still finds the name when the driver camelCases columns", () => {
    const h = binderSlotToHolding({
      slotId: "s2",
      binderName: "Base",
      pageIndex: 0,
      source: "pokemontcg",
      externalId: "base1-58",
      cardName: "Pikachu",
      setName: "Base Set",
      number: "58",
      owned: false,
    });
    expect(h.id).toBe("binder-slot-s2");
    expect(h.cardName).toBe("Pikachu");
  });
});
