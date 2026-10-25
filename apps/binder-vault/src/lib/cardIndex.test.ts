import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCardIndex,
  normalizeNumber,
  normalizeText,
  searchCardIndex,
  setCardIndexForTests,
} from "./cardIndex";
import { searchCards } from "./cards";

const SETS = [
  { id: "base1", name: "Base", series: "Base", printedTotal: 102, ptcgoCode: "BS", releaseDate: "1999/01/09" },
  { id: "sv3pt5", name: "151", series: "Scarlet & Violet", printedTotal: 165, ptcgoCode: "MEW", releaseDate: "2023/09/22" },
  { id: "swshp", name: "SWSH Black Star Promos", series: "Sword & Shield", releaseDate: "2019/11/15" },
  { id: "base2", name: "Jungle", series: "Base", printedTotal: 64, ptcgoCode: "JU", releaseDate: "1999/06/16" },
];

const card = (id: string, name: string, number: string, rarity: string | null = "Rare") => ({
  id,
  name,
  number,
  rarity: rarity ?? undefined,
  images: { small: `${id}.png`, large: `${id}_hires.png` },
});

const CARDS = new Map([
  ["base1", [card("base1-4", "Charizard", "4", "Rare Holo"), card("base1-58", "Pikachu", "58", "Common"), card("base1-25", "Dewgong", "25", "Uncommon")]],
  [
    "sv3pt5",
    [
      card("sv3pt5-6", "Charizard ex", "6", "Double Rare"),
      card("sv3pt5-25", "Pikachu", "25", "Common"),
      card("sv3pt5-199", "Charizard ex", "199", "Special Illustration Rare"),
      card("sv3pt5-83", "Farfetch'd", "83", "Common"),
    ],
  ],
  ["swshp", [card("swshp-SWSH045", "Charizard V", "SWSH045", "Promo")]],
  ["base2", [card("base2-60", "Pikachu", "60", "Common"), card("base2-27", "Mr. Mime", "27", "Rare")]],
]);

const INDEX = buildCardIndex(SETS, CARDS, Date.now());
const ids = (q: string, filters = {}, limit = 20) => searchCardIndex(INDEX, q, filters, limit).map((h) => h.card.id);

afterEach(() => {
  setCardIndexForTests(null);
  vi.unstubAllGlobals();
});

describe("normalisers", () => {
  it("strips accents, apostrophes and leading zeros", () => {
    expect(normalizeText("Flabébé")).toBe("flabebe");
    expect(normalizeText("Farfetch'd")).toBe("farfetchd");
    expect(normalizeNumber("004")).toBe("4");
    expect(normalizeNumber("SWSH045")).toBe("swsh45");
  });
});

describe("searchCardIndex", () => {
  it("finds a card by name, exact name first, newest set first", () => {
    expect(ids("charizard")).toEqual(["base1-4", "sv3pt5-6", "sv3pt5-199", "swshp-SWSH045"]);
    expect(ids("pika")).toEqual(["sv3pt5-25", "base2-60", "base1-58"]);
  });

  it("finds cards by collector number alone, with or without the set total", () => {
    expect(ids("25")).toEqual(["sv3pt5-25", "base1-25"]);
    expect(ids("4/102")).toEqual(["base1-4"]);
    expect(ids("004/102")).toEqual(["base1-4"]);
    // A different printed total rules a set out; a secret rare's number can exceed the total.
    expect(ids("25/102")).toEqual(["base1-25"]);
    expect(ids("199/165")).toEqual(["sv3pt5-199"]);
    expect(ids("swsh045")).toEqual(["swshp-SWSH045"]);
  });

  it("combines name with number, set name or set code", () => {
    expect(ids("charizard 4/102")).toEqual(["base1-4"]);
    expect(ids("pikachu 25")).toEqual(["sv3pt5-25"]);
    expect(ids("charizard 199")).toEqual(["sv3pt5-199"]);
    expect(ids("pikachu jungle")).toEqual(["base2-60"]);
    expect(ids("pikachu 151")[0]).toBe("sv3pt5-25");
    expect(ids("charizard mew")).toEqual(["sv3pt5-6", "sv3pt5-199"]);
  });

  it("ignores punctuation and accents in names", () => {
    expect(ids("farfetchd")).toEqual(["sv3pt5-83"]);
    expect(ids("mr mime")).toEqual(["base2-27"]);
    expect(ids("mr. mime")).toEqual(["base2-27"]);
  });

  it("returns nothing for words that match no card", () => {
    expect(ids("charizard zzz")).toEqual([]);
  });

  it("browses a set in collector order and applies exact rarity filters", () => {
    expect(ids("", { setId: "sv3pt5" })).toEqual(["sv3pt5-6", "sv3pt5-25", "sv3pt5-83", "sv3pt5-199"]);
    expect(ids("charizard", { rarities: ["Special Illustration Rare"] })).toEqual(["sv3pt5-199"]);
  });
});

describe("searchCards with the local index", () => {
  it("answers from the index without calling pokemontcg.io", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("", { status: 404 });
    });
    setCardIndexForTests(INDEX);
    const out = await searchCards("charizard 4/102", { source: "all", limit: 10 });
    expect(out.results.map((r) => r.externalId)).toEqual(["base1-4"]);
    expect(out.results[0]?.source).toBe("pokemontcg");
    expect(out.results[0]?.setName).toBe("Base");
    expect(urls.some((u) => u.includes("api.pokemontcg.io"))).toBe(false);
  });
});
