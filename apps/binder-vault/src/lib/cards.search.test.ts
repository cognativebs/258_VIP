import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPokemonPage, searchCards } from "./cards";

const CHARIZARD = {
  id: "base1-4",
  name: "Charizard",
  number: "4",
  rarity: "Rare Holo",
  set: { id: "base1", name: "Base" },
  images: { small: "s.png", large: "l.png" },
  tcgplayer: { prices: { holofoil: { market: 100 } } },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchPokemonPage", () => {
  it("retries a 500 and then succeeds", async () => {
    let hits = 0;
    vi.stubGlobal(
      "fetch",
      async () => {
        hits += 1;
        if (hits === 1) return jsonResponse(500, { error: "busy" });
        return jsonResponse(200, { data: [CHARIZARD], totalCount: 1 });
      },
    );
    const page = await fetchPokemonPage("name:Charizard*", 1, 40, null);
    expect(page.data[0]?.id).toBe("base1-4");
    expect(hits).toBe(2);
  });

  it("drops orderBy after sorted requests 500", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("orderBy=")) return jsonResponse(500, {});
        return jsonResponse(200, { data: [CHARIZARD], totalCount: 1 });
      },
    );
    const page = await fetchPokemonPage("name:Charizard*", 1, 40, "-set.releaseDate");
    expect(page.data).toHaveLength(1);
    expect(urls.some((u) => u.includes("orderBy="))).toBe(true);
    expect(urls.some((u) => !u.includes("orderBy="))).toBe(true);
  });
});

describe("searchCards", () => {
  it("returns TCGdex hits when pokemontcg.io is down", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("pokemontcg.io")) return jsonResponse(500, {});
        if (url.includes("api.tcgdex.net") && url.includes("name=like:")) {
          return jsonResponse(200, [
            {
              id: "base1-4",
              localId: "4",
              name: "Charizard",
              image: "https://assets.tcgdex.net/en/base1/4",
            },
          ]);
        }
        return jsonResponse(500, {});
      },
    );

    const out = await searchCards("Charizard-fallback-case", {
      source: "all",
      limit: 10,
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.source).toBe("tcgdex");
    expect(out.errors.some((e) => /TCG\.io/.test(e))).toBe(true);
  });

  it("uses like before exact on TCGdex so partial names work", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("pokemontcg.io")) return jsonResponse(500, {});
        if (url.includes("name=like:")) {
          return jsonResponse(200, [{ id: "sv01-1", localId: "1", name: "Sprigatito" }]);
        }
        return jsonResponse(200, []);
      },
    );
    const out = await searchCards("sprig", { source: "tcgdex", limit: 8 });
    expect(out.results[0]?.name).toBe("Sprigatito");
    expect(urls.some((u) => u.includes("name=like:"))).toBe(true);
  });
});
