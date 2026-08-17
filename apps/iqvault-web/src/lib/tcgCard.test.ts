import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pokemontcgImageUrl, tcgArtUrl, tcgCardDisplay, tcgCardName } from "./tcgCard";

describe("tcgCardName", () => {
  it("prefers the dedicated cardName field", () => {
    assert.equal(
      tcgCardName({
        cardName: "Charizard",
        assetName: "Base Set #4 Charizard",
        series: "Base Set",
        issue: "4",
      }),
      "Charizard",
    );
  });

  it("strips set and number from a Binder assetName", () => {
    assert.equal(
      tcgCardName({
        cardName: null,
        assetName: "Base Set #4 Charizard Holo",
        series: "Base Set",
        issue: "4",
      }),
      "Charizard Holo",
    );
  });

  it("does not treat a copied set name as the printed card", () => {
    assert.equal(
      tcgCardName({
        cardName: "Base Set",
        assetName: "Base Set #4 Charizard Holo",
        series: "Base Set",
        issue: "4",
      }),
      "Charizard Holo",
    );
  });

  it("finds the printed name after #number even when series does not match the asset prefix", () => {
    assert.equal(
      tcgCardName({
        cardName: null,
        assetName: "Base Set #4 Charizard Holo",
        series: "Base",
        issue: "4",
      }),
      "Charizard Holo",
    );
  });

  it("does not treat the set name as the card", () => {
    const display = tcgCardDisplay({
      cardName: "Pikachu",
      assetName: "Base Set #58 Pikachu",
      series: "Base Set",
      issue: "58",
    });
    assert.equal(display.cardName, "Pikachu");
    assert.equal(display.setName, "Base Set");
    assert.equal(display.number, "58");
  });

  it("does not invent a name for Unnamed card", () => {
    assert.equal(
      tcgCardName({
        cardName: "Unnamed card",
        assetName: "Base Set #4 Unnamed card",
        series: "Base Set",
        issue: "4",
      }),
      "—",
    );
  });
});

describe("tcgArtUrl", () => {
  it("uses an explicit cover URL when present", () => {
    assert.equal(
      tcgArtUrl({
        cardName: "Charizard",
        assetName: "Base Set #4 Charizard",
        series: "Base Set",
        issue: "4",
        coverImageUrl: "https://images.pokemontcg.io/base1/4_hires.png",
        externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
      }),
      "https://images.pokemontcg.io/base1/4_hires.png",
    );
  });

  it("derives official art from a pokemontcg id when cover is missing", () => {
    assert.equal(pokemontcgImageUrl("base1-4"), "https://images.pokemontcg.io/base1/4.png");
    assert.equal(
      tcgArtUrl({
        cardName: "Charizard Holo",
        assetName: "Base Set #4 Charizard Holo",
        series: "Base Set",
        issue: "4",
        coverImageUrl: null,
        externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
      }),
      "https://images.pokemontcg.io/base1/4.png",
    );
  });
});
