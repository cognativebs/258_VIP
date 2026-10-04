import { SPECIES_BY_DEX } from "@vip/core-model";
import { describe, expect, it } from "vitest";
import { entityKey, extractPokemonEntities, quotedSetCandidates, type PokemonCatalog } from "./pokemon-entities.js";

const catalog: PokemonCatalog = {
  species: SPECIES_BY_DEX,
  sets: [
    { name: "Surging Sparks", ref: "binder_set:surging-sparks" },
    { name: "Mega Evolution", ref: "binder_set:mega-evolution" },
    { name: "151", ref: "binder_set:151" },
  ],
  learnedSets: ["Fixture Storm"],
  knownCardKeys: new Set(["mew-ex"]),
};
const pick = (text: string, c: PokemonCatalog = catalog) =>
  extractPokemonEntities(text, c).map((e) => `${e.kind}:${e.normalizedKey}:${e.entityRef ?? "-"}:${e.method}`).sort();

describe("Pokémon entity extraction", () => {
  it("matches species to the national Dex, longest name first, and never Mew inside Mewtwo", () => {
    expect(pick("Mewtwo and Mew Headline the Next Box")).toEqual([
      "pokemon:mew:pokemon:dex:151:species_catalog",
      "pokemon:mewtwo:pokemon:dex:150:species_catalog",
    ]);
    expect(pick("Flabébé Gets a Special Illustration Rare")).toEqual(["pokemon:flabebe:pokemon:dex:669:species_catalog"]);
  });

  it("ignores lowercase words that happen to be species names", () => {
    expect(pick("Prices rose, ditto for sealed product")).toEqual([]);
  });

  it("reads cards from suffixes and Mega, and links a card IQVault already holds", () => {
    expect(pick("Exploring Mew ex and Heat Rotom ex")).toEqual([
      "card:heat-rotom-ex:-:card_pattern",
      "card:mew-ex:binder_card:mew-ex:card_pattern",
      "pokemon:mew:pokemon:dex:151:species_catalog",
      "pokemon:rotom:pokemon:dex:479:species_catalog",
    ]);
    expect(pick("Fixing Mega Excadrill")).toContain("card:mega-excadrill:-:card_pattern");
  });

  it("reads products once each; a Pokémon Center ETB is not also a plain ETB", () => {
    expect(pick("Pokémon Center Elite Trainer Box and Booster Bundle Restock")).toEqual([
      "product:booster-bundle:product:booster-bundle:product_pattern",
      "product:pokemon-center-etb:product:pokemon-center-etb:product_pattern",
    ]);
    expect(pick("New Premium Binders and Sleeves")).toEqual([
      "product:accessory:product:accessory:product_pattern",
      "product:binder:product:binder:product_pattern",
    ]);
  });

  it("learns quoted set names in PokéBeach's style, with no identity, and skips app names", () => {
    expect(pick("“Fixture Rise” Preorders Now Live")).toEqual(["set:fixture-rise:-:quoted_set_name"]);
    expect(pick("All 429 “Deluxe Pack Mega” Cards Revealed for “Pocket!”")).toEqual(["set:deluxe-pack-mega:-:quoted_set_name"]);
    expect(quotedSetCandidates("20+ “Fixture Rise” Card Images Revealed!")).toEqual(["Fixture Rise"]);
    expect(quotedSetCandidates("Pokémon to Release “Something Fun” Next Year")).toEqual([]);
  });

  it("matches catalog and learned set names; an ambiguous name needs a set word next to it", () => {
    expect(pick("Surging Sparks Booster Box Restock")).toContain("set:surging-sparks:binder_set:surging-sparks:set_catalog");
    expect(pick("Cards Revealed from Fixture Storm!")).toEqual(["set:fixture-storm:-:learned_set_name"]);
    expect(pick("How Mega Evolution Changed the Meta")).toEqual([]);
    expect(pick("Mega Evolution Elite Trainer Box Revealed")).toContain("set:mega-evolution:binder_set:mega-evolution:set_catalog");
    expect(pick("All 1,025 Pokémon")).toEqual([]);
  });

  it("normalizes keys the same way everywhere", () => {
    expect(entityKey("Pokémon Center ETB")).toBe("pokemon-center-etb");
    expect(entityKey("Nidoran♀")).toBe("nidoran-f");
    expect(entityKey("Farfetch’d")).toBe("farfetch-d");
  });
});
