import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdingToPokemonRow } from "./holdingToComic";
import type { Holding } from "./api";

function seedHolding(): Holding {
  return {
    id: "pokemon-base1-4",
    assetName: "Base Set #4 Charizard Holo",
    series: "Base Set",
    issue: "4",
    publisher: "Wizards of the Coast",
    quantity: 1,
    pillar: "Investment Portfolio",
    museumScore: 72,
    investmentScore: 80,
    liquidityScore: 65,
    recommendationLabel: "Hold",
    sellPriority: "Low",
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: "seed",
    currentPrice: 350,
    assumedGrade: "NM",
    gradeRating: null,
    coverImageUrl: null,
    cardName: "Charizard Holo",
    rarity: "Holo Rare",
    externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
    provenance: {
      source: "vip_pokemon_seed",
      method: "inferred",
      confidence: 0.5,
      verificationStatus: "unverified",
      ruleOrModelVersion: "pokemon-seed@0.1.0",
    },
  };
}

describe("holdingToPokemonRow", () => {
  it("puts printed name in Title and official art in Cover Image URL for Inspector", () => {
    const row = holdingToPokemonRow(seedHolding());
    assert.equal(row.Title, "Charizard Holo");
    assert.equal(row["Cover Image URL"], "https://images.pokemontcg.io/base1/4.png");
    assert.equal(row.Series, "Base Set");
    assert.equal(row["Issue Full"], "4");
  });

  it("recovers the printed name from assetName when cardName is missing", () => {
    const row = holdingToPokemonRow({ ...seedHolding(), cardName: null });
    assert.equal(row.Title, "Charizard Holo");
  });
});
