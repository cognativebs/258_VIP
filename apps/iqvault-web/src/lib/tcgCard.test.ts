import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tcgCardDisplay, tcgCardName } from "./tcgCard";

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
});
