import { describe, expect, it } from "vitest";
import { createSportsCardsProCatalogAdapter, parseSportsCardsProProducts, sportsSearchText } from "./sportscardsproAdapter.js";

const PAYLOAD = JSON.stringify({
  status: "success",
  products: [
    { id: "341246", "console-name": "Football Cards 2017 Panini Prizm", "product-name": "Patrick Mahomes II #269", "loose-price": 79410 },
    { id: "341546", "console-name": "Football Cards 2017 Panini Prizm", "product-name": "Patrick Mahomes II [Silver Prizm] #269" },
  ],
});

describe("SportsCardsPro catalog adapter", () => {
  it("builds a short search from the fused identity, dropping card-back words", () => {
    expect(sportsSearchText({ text: "2017 Panini Prizm Patrick Mahomes II Rookie", nameHint: "Patrick Mahomes II", collectorNumber: "#269" })).toBe(
      "2017 panini prizm patrick mahomes ii 269",
    );
  });

  it("reads player, parallel, number, year and set from product titles — never a price", () => {
    const cards = parseSportsCardsProProducts({ payload: PAYLOAD, contentType: "application/json" }, { text: "x", category: "sports" });
    expect(cards.map((c) => [c.displayName, c.setName, c.collectorNumber, c.year, c.externalIds[0]?.value])).toEqual([
      ["Patrick Mahomes II", "Panini Prizm", "269", 2017, "341246"],
      ["Patrick Mahomes II [Silver Prizm]", "Panini Prizm", "269", 2017, "341546"],
    ]);
    expect(JSON.stringify(cards)).not.toMatch(/price/i);
  });

  it("only answers sports, needs two search words, and never leaks the token in an error", async () => {
    const urls: string[] = [];
    const ok = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => PAYLOAD };
      },
    });
    expect(await ok.search({ text: "Charizard 4", category: "pokemon" })).toEqual([]);
    expect(await ok.search({ text: "Mahomes", category: "sports" })).toEqual([]);
    expect(urls).toHaveLength(0);
    expect((await ok.search({ text: "Patrick Mahomes 269", category: "sports" })).length).toBe(2);

    const failing = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      fetch: async () => ({ ok: false, status: 403, headers: { get: () => null }, text: async () => "" }),
    });
    const err = await failing.search({ text: "Patrick Mahomes 269", category: "sports" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/SportsCardsPro HTTP 403/);
    expect(String(err)).not.toMatch(/SECRET-TOKEN/);
  });
});
