import { describe, expect, it } from "vitest";
import {
  createScryfallCatalogAdapter,
  parseScryfallCards,
  scryfallSearchQuery,
} from "./scryfallAdapter.js";

const BOLT = {
  id: "e3285e6b-3e79-4d4d-9025-9a4c73772a36",
  oracle_id: "oracle-bolt",
  name: "Lightning Bolt",
  set: "lea",
  set_name: "Limited Edition Alpha",
  collector_number: "161",
  released_at: "1993-08-05",
};

describe("ScryfallCatalogAdapter", () => {
  it("quotes the first two tokens as a name so set/number stay filters", () => {
    expect(scryfallSearchQuery("Lightning Bolt Alpha 161")).toBe(
      'name:"Lightning Bolt"',
    );
    expect(scryfallSearchQuery("Black Lotus")).toBe('name:"Black Lotus"');
  });

  it("parses a list payload into catalog cards with scryfall ids", () => {
    const cards = parseScryfallCards(
      {
        payload: JSON.stringify({ object: "list", data: [BOLT] }),
        contentType: "application/json",
      },
      { text: "Lightning Bolt", category: "mtg", limit: 5 },
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.externalIds).toEqual([
      { source: "scryfall", value: BOLT.id },
      { source: "scryfall_oracle", value: "oracle-bolt" },
    ]);
    expect(cards[0]?.collectorNumber).toBe("161");
    expect(cards[0]?.year).toBe(1993);
  });

  it("prefers an exact card name over a double-faced card that contains it", () => {
    const cards = parseScryfallCards(
      {
        payload: JSON.stringify({
          data: [
            { id: "dfc", name: "Emeritus of Conflict // Lightning Bolt", set_name: "Strixhaven", collector_number: "113" },
            { id: "bolt", name: "Lightning Bolt", set_name: "Limited Edition Alpha", collector_number: "161", released_at: "1993-08-05" },
          ],
        }),
        contentType: "application/json",
      },
      { text: "Lightning Bolt Alpha 161", category: "mtg", limit: 5 },
    );
    expect(cards[0]?.displayName).toBe("Lightning Bolt");
    expect(cards[0]?.externalIds[0]?.value).toBe("bolt");
  });

  it("skips non-mtg queries and snapshots via fetchRaw", async () => {
    let called = 0;
    const adapter = createScryfallCatalogAdapter({
      minIntervalMs: 0,
      fetch: async () => {
        called += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({ data: [BOLT] }),
        };
      },
    });
    expect(adapter.categories).toEqual(["mtg"]);
    expect(await adapter.search({ text: "Charizard", category: "pokemon" })).toEqual(
      [],
    );
    expect(called).toBe(0);

    const raw = await adapter.fetchRaw!({ text: "Lightning Bolt", category: "mtg" });
    expect(raw?.payload).toContain(BOLT.id);
    const cards = adapter.parseRaw!(raw!, { text: "Lightning Bolt", category: "mtg" });
    expect(cards[0]?.externalIds[0]?.source).toBe("scryfall");
  });

  it("treats 404 as no cards and 429 as an isolated adapter error", async () => {
    const notFound = createScryfallCatalogAdapter({
      minIntervalMs: 0,
      fetch: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => "",
      }),
    });
    expect(await notFound.search({ text: "No Such Card", category: "mtg" })).toEqual(
      [],
    );

    const limited = createScryfallCatalogAdapter({
      minIntervalMs: 0,
      fetch: async () => ({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        text: async () => "",
      }),
    });
    await expect(limited.search({ text: "Bolt", category: "mtg" })).rejects.toThrow(
      /rate-limited/,
    );
  });
});
