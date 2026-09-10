import { describe, expect, it } from "vitest";
import {
  createTcgdexCatalogAdapter,
  parseTcgdexCards,
  tcgdexSearchTerms,
} from "./tcgdexAdapter.js";

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
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("localId");
    expect(urls[1]).not.toContain("localId");
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
