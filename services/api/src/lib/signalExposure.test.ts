import { describe, expect, it } from "vitest";
import { pokemon30thHunt } from "../seeds/hunts.js";
import { exposureFor, huntTexts, parseEntityRef, type BinderSlot } from "./signalExposure.js";

const binder: BinderSlot[] = [
  { setName: "Surging Sparks", cardName: "Pikachu ex", owned: true, wishlist: false },
  { setName: "Surging Sparks", cardName: "Mew ex", owned: false, wishlist: true },
  { setName: "Prismatic Evolutions", cardName: "Umbreon ex", owned: true, wishlist: false },
  { setName: "151", cardName: "Mewtwo ex", owned: false, wishlist: true },
];

describe("signal exposure", () => {
  it("reads entity refs written by extraction and synthesis", () => {
    expect(parseEntityRef("pokemon:dex:151")).toEqual({ kind: "pokemon", key: "mew" });
    expect(parseEntityRef("binder_set:surging-sparks")).toEqual({ kind: "set", key: "surging-sparks" });
    expect(parseEntityRef("set:delta-reign")).toEqual({ kind: "set", key: "delta-reign" });
    expect(parseEntityRef("binder_card:mew-ex")).toEqual({ kind: "card", key: "mew-ex" });
    expect(parseEntityRef("something:else")).toBeNull();
    expect(parseEntityRef(null)).toBeNull();
  });

  it("counts owned and wishlisted Binder slots for a set, a card, or a Pokémon (never Mew inside Mewtwo)", () => {
    expect(exposureFor("binder_set:surging-sparks", binder, [])).toMatchObject({ owned: 1, wishlist: 1 });
    expect(exposureFor("binder_card:mew-ex", binder, [])).toMatchObject({ owned: 0, wishlist: 1, matched: ["Mew ex · Surging Sparks"] });
    expect(exposureFor("pokemon:dex:151", binder, [])).toMatchObject({ owned: 0, wishlist: 1 });
    expect(exposureFor("set:delta-reign", binder, [])).toEqual({ owned: 0, wishlist: 0, hunts: [], matched: [] });
  });

  it("finds Pokémon hunts that name the entity", () => {
    const hunts = huntTexts([pokemon30thHunt]);
    expect(exposureFor("set:30th-celebration", binder, hunts).hunts).toEqual(["Pokémon 30th Celebration"]);
    expect(exposureFor("set:delta-reign", binder, hunts).hunts).toEqual([]);
  });
});
