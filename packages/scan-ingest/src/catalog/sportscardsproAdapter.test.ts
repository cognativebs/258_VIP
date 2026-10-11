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

  it("retries once on player + number when the full search finds nothing", async () => {
    const queries: string[] = [];
    const adapter = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      minIntervalMs: 0,
      fetch: async (url) => {
        const q = new URL(url).searchParams.get("q") ?? "";
        queries.push(q);
        const body = q === "patrick mahomes ii 269" ? PAYLOAD : JSON.stringify({ status: "success", products: [] });
        return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => body };
      },
    });
    const cards = await adapter.search({ text: "2017 Panini Prizm Patrick Mahomes II Kansas City", category: "sports", nameHint: "Patrick Mahomes II", collectorNumber: "269" });
    expect(cards.length).toBe(2);
    expect(queries).toEqual(["2017 panini prizm patrick mahomes ii kansas city 269", "patrick mahomes ii 269"]);
  });

  it("backs off and retries once when the catalog throttles with a 404", async () => {
    let calls = 0;
    const adapter = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      minIntervalMs: 0,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, status: 404, headers: { get: () => null }, text: async () => "" }
          : { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => PAYLOAD };
      },
    });
    expect((await adapter.search({ text: "Patrick Mahomes 269", category: "sports", nameHint: "Patrick Mahomes" })).length).toBe(2);
    expect(calls).toBe(2);
  });

  it("only answers sports, needs two search words, and never leaks the token in an error", async () => {
    const urls: string[] = [];
    const ok = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      minIntervalMs: 0,
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => PAYLOAD };
      },
    });
    expect(await ok.search({ text: "Charizard 4", category: "pokemon" })).toEqual([]);
    expect(await ok.search({ text: "Mahomes", category: "sports", nameHint: "Mahomes" })).toEqual([]);
    expect(await ok.search({ text: "2021 Panini Mosaic #135", category: "sports" })).toEqual([]);
    expect(urls).toHaveLength(0);
    expect((await ok.search({ text: "Patrick Mahomes 269", category: "sports", nameHint: "Patrick Mahomes" })).length).toBe(2);

    const failing = createSportsCardsProCatalogAdapter({
      token: "SECRET-TOKEN",
      minIntervalMs: 0,
      fetch: async () => ({ ok: false, status: 403, headers: { get: () => null }, text: async () => "" }),
    });
    const err = await failing.search({ text: "Patrick Mahomes 269", category: "sports", nameHint: "Patrick Mahomes" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/SportsCardsPro HTTP 403/);
    expect(String(err)).not.toMatch(/SECRET-TOKEN/);
  });
});
