import { describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import {
  createTcgdexCatalogAdapter,
  parseTcgdexCards,
  resetTcgdexSetsCache,
  setTotalFromCollector,
  tcgdexSearchTerms,
} from "./tcgdexAdapter.js";

beforeEach(() => resetTcgdexSetsCache());

const SETS = [
  { id: "swsh12.5", name: "Crown Zenith", cardCount: { official: 159, total: 160 } },
  { id: "sv09", name: "Journey Together", cardCount: { official: 159, total: 190 } },
  { id: "me02", name: "Phantasmal Flames", cardCount: { official: 94, total: 130 } },
];
function fake(routes: Record<string, unknown>, urls: string[] = [], status: Record<string, number> = {}) {
  return async (url: string) => {
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.endsWith(k) || url.includes(k));
    const code = Object.entries(status).find(([k]) => url.includes(k))?.[1];
    if (code) return { ok: false, status: code, headers: { get: () => null }, text: async () => "" };
    if (key === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
    return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify(routes[key]) };
  };
}

describe("TCGdex lookups the scanner needs", () => {
  it("reads the printed set total", () => {
    expect(setTotalFromCollector("146/159")).toBe(159);
    expect(setTotalFromCollector("082 / 094")).toBe(94);
    expect(setTotalFromCollector("SWSH123")).toBeUndefined();
  });

  it("a number-only scan finds the card in every set with that printed total, with set names", async () => {
    const adapter = createTcgdexCatalogAdapter({
      fetch: fake({
        "/sets": SETS,
        "/cards/swsh12.5-146": { id: "swsh12.5-146", localId: "146", name: "Lumineon V", set: { id: "swsh12.5", name: "Crown Zenith" } },
        "/cards/sv09-146": { id: "sv09-146", localId: "146", name: "Energy Swatter", set: { id: "sv09", name: "Journey Together" } },
      }),
    });
    const cards = await adapter.search({ text: "146/159", category: "pokemon", collectorNumber: "146/159" });
    expect(cards.map((c) => [c.externalIds[0]?.value, c.setName, c.collectorNumber])).toEqual([
      ["swsh12.5-146", "Crown Zenith", "146"],
      ["sv09-146", "Journey Together", "146"],
    ]);
  });

  it("name search rows get their set name from the set list; padded and bare numbers both resolve", async () => {
    const urls: string[] = [];
    const adapter = createTcgdexCatalogAdapter({
      fetch: fake(
        {
          "/sets": SETS,
          "name=Linoone&localId=082": [{ id: "me02-082", localId: "082", name: "Linoone" }],
        },
        urls,
      ),
    });
    const cards = await adapter.search({ text: "Linoone 082/094", category: "pokemon", nameHint: "Linoone", collectorNumber: "082/094" });
    expect(cards[0]).toMatchObject({ displayName: "Linoone", setName: "Phantasmal Flames", collectorNumber: "082" });
    // The name search already found me02-082, so no second fetch for that set.
    expect(urls.some((u) => u.includes("/cards/me02-"))).toBe(false);
  });

  it("an HTTP error is an error (retried once), never 'no such card'", async () => {
    const urls: string[] = [];
    const adapter = createTcgdexCatalogAdapter({ fetch: fake({ "/sets": SETS }, urls, { "/cards?": 429 }) });
    await expect(adapter.search({ text: "Wailmer", category: "pokemon", nameHint: "Wailmer" })).rejects.toThrow(/TCGdex HTTP 429/);
    expect(urls.filter((u) => u.includes("/cards?"))).toHaveLength(2);
  });
});

describe("tcgdexSearchTerms", () => {
  it("extracts Charizard from a structured year/set query", () => {
    const terms = tcgdexSearchTerms({
      text: "1999 Pokémon #4 Charizard",
    });
    expect(terms.name.toLowerCase()).toBe("charizard");
    expect(terms.localId).toBe("4");
  });

  it("keeps Mewtwo when OCR says Pokémon and the file is *_front.jpg", () => {
    const terms = tcgdexSearchTerms({
      text: "1999 Pokémon #150 Mewtwo mewtwo_front.jpg",
    });
    expect(terms.name.toLowerCase()).toBe("mewtwo");
    expect(terms.localId).toBe("150");
  });

  it("ignores *_front.jpg filename tokens", () => {
    const terms = tcgdexSearchTerms({
      text: "1999 pokemon #150 mewtwo mewtwo front jpg",
    });
    expect(terms.name.toLowerCase()).toBe("mewtwo");
    expect(terms.localId).toBe("150");
  });

  it("prefers a privileged name hint over raw tokens", () => {
    const terms = tcgdexSearchTerms({
      text: "1999 Pokémon #150",
      nameHint: "Mewtwo",
      collectorNumber: "150",
    });
    expect(terms.name).toBe("Mewtwo");
    expect(terms.localId).toBe("150");
  });

  it("strips set size from a collector NNN/NNN hint", () => {
    const terms = tcgdexSearchTerms({
      text: "2025 Pokémon #082/094 Linoone",
      nameHint: "Linoone",
      collectorNumber: "082/094",
    });
    expect(terms.name).toBe("Linoone");
    expect(terms.localId).toBe("082");
  });

  it("searches the Pokémon name, not year/brand/number", () => {
    expect(tcgdexSearchTerms({ text: "1999 Pokemon #4 Charizard" })).toMatchObject({
      name: "charizard",
      localId: "4",
    });
    // "Base" is a set word, so it belongs in the localId filter, not the name.
    expect(tcgdexSearchTerms({ text: "Charizard #4 Base" })).toMatchObject({
      name: "charizard",
      localId: "4",
    });
    expect(tcgdexSearchTerms({ text: "1999 Pokemon HP 120" }).name).toBe("");
  });
});

describe("TcgdexCatalogAdapter", () => {
  it("does not call the provider when no name survives the query", async () => {
    let called = 0;
    const adapter = createTcgdexCatalogAdapter({
      fetch: async () => {
        called += 1;
        return {
          ok: true,
          headers: { get: () => "application/json" },
          text: async () => "[]",
        };
      },
    });
    expect(await adapter.search({ text: "1999 Pokemon HP 120", category: "pokemon" })).toEqual([]);
    expect(called).toBe(0);
  });

  it("parses provider JSON into catalog cards with tcgdex external ids", () => {
    const cards = parseTcgdexCards(
      {
        payload: JSON.stringify([{ id: "base1-4", name: "Charizard", localId: "4" }]),
        contentType: "application/json",
      },
      { text: "Charizard", category: "pokemon", limit: 5 },
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.externalIds).toEqual([{ source: "tcgdex", value: "base1-4" }]);
    expect(cards[0]?.collectorNumber).toBe("4");
  });

  it("retries without localId when name+number returns no cards", async () => {
    const urls: string[] = [];
    const adapter = createTcgdexCatalogAdapter({
      fetch: async (url) => {
        urls.push(url);
        const empty = url.includes("localId");
        return {
          ok: true,
          headers: { get: () => "application/json" },
          text: async () =>
            empty
              ? "[]"
              : JSON.stringify([{ id: "me02-021", name: "Seel", localId: "021" }]),
        };
      },
    });
    const cards = await adapter.search({
      text: "Seel 021/094",
      category: "pokemon",
      nameHint: "Seel",
      collectorNumber: "021/094",
    });
    const searches = urls.filter((u) => u.includes("/cards?"));
    expect(searches).toHaveLength(2);
    expect(searches[0]).toContain("localId");
    expect(searches[1]).not.toContain("localId");
    expect(cards[0]?.externalIds[0]?.value).toBe("me02-021");
  });

  it("skips non-pokemon queries and snapshots via fetchRaw", async () => {
    let called = 0;
    const adapter = createTcgdexCatalogAdapter({
      fetch: async () => {
        called += 1;
        return {
          ok: true,
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify([{ id: "sv1-25", name: "Pikachu", localId: "025" }]),
        };
      },
    });
    expect(adapter.categories).toEqual(["pokemon"]);
    const sports = await adapter.search({ text: "Jordan", category: "sports" });
    expect(sports).toEqual([]);
    expect(called).toBe(0);

    const raw = await adapter.fetchRaw!({ text: "Pikachu", category: "pokemon" });
    expect(raw?.payload).toContain("sv1-25");
    const cards = adapter.parseRaw!(raw!, { text: "Pikachu", category: "pokemon" });
    expect(cards[0]?.externalIds[0]?.source).toBe("tcgdex");
  });
});
