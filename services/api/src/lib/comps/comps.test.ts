import { afterEach, describe, expect, it } from "vitest";
import { mapInventoryRow } from "../holdings.js";
import { ebaySoldAdapter } from "./ebaySold.js";
import { fetchCompsForHolding, fixtureCompsAdapter } from "./index.js";
import { tcgplayerMarketAdapter } from "./tcgplayerMarket.js";

afterEach(() => {
  delete process.env.EBAY_OAUTH_TOKEN;
  delete process.env.EBAY_APP_ID;
  delete process.env.EBAY_CERT_ID;
  delete process.env.VIP_COMPS_USE_FIXTURE;
  delete process.env.VIP_COMPS_FIXTURE_JSON;
});

const comic = mapInventoryRow(
  {
    Series: "Absolute Batman",
    "Issue Full": "1A",
    Publisher: "DC Comics",
    "CLZ Hash": "test-ab1",
    "Assumed Grade": "NM assumed",
    "Slab Status": "Raw",
    "Grade Rating": 0,
    Quantity: 1,
  },
  0,
);

const tcg = mapInventoryRow(
  {
    Series: "Base",
    "Issue Full": "4",
    Publisher: "The Pokémon Company",
    "CLZ Hash": "pokemon-base1-4",
    ExternalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
    Quantity: 1,
    "Current Price": 100,
  },
  1,
);

describe("comps adapters", () => {
  it("ebay adapter matches comics and stays idle without credentials", async () => {
    expect(ebaySoldAdapter.matches(comic)).toBe(true);
    expect(ebaySoldAdapter.matches(tcg)).toBe(false);
    const result = await ebaySoldAdapter.fetchComps(comic);
    expect(result.sales).toEqual([]);
    expect(result.emptyReason).toMatch(/EBAY_APP_ID|EBAY_OAUTH_TOKEN/);
  });

  it("tcgplayer adapter matches TCG holdings", () => {
    expect(tcgplayerMarketAdapter.matches(tcg)).toBe(true);
    expect(tcgplayerMarketAdapter.matches(comic)).toBe(false);
  });

  it("fixture seam supplies real comps without inventing them in production code", async () => {
    process.env.VIP_COMPS_USE_FIXTURE = "1";
    process.env.VIP_COMPS_FIXTURE_JSON = JSON.stringify([
      {
        id: "fix-1",
        price: 22,
        saleDate: "2026-08-01T00:00:00.000Z",
        source: "ebay.com/sold",
        provenance: {
          method: "api",
          ruleOrModelVersion: "fixture",
          verificationStatus: "verified",
          confidence: 0.9,
        },
      },
      {
        id: "fix-2",
        price: 28,
        saleDate: "2026-07-20T00:00:00.000Z",
        source: "ebay.com/sold",
        provenance: {
          method: "api",
          ruleOrModelVersion: "fixture",
          verificationStatus: "verified",
          confidence: 0.9,
        },
      },
    ]);

    const { sales, adapters } = await fetchCompsForHolding(comic);
    expect(sales).toHaveLength(2);
    expect(sales[0]?.source).toBe("ebay.com/sold");
    expect(adapters[0]?.adapterId).toBe("fixture");
  });

  it("keeps only Browse titles that name this comic, never as sold", async () => {
    process.env.EBAY_OAUTH_TOKEN = "test-token";
    const prev = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          itemSummaries: [
            {
              itemId: "keep",
              title: "Action Comics #900 C Cover NM",
              price: { value: "12.00" },
              itemCreationDate: "2026-09-01T00:00:00.000Z",
            },
            {
              itemId: "lot",
              title: "Action Comics lot of 10",
              price: { value: "40.00" },
              itemCreationDate: "2026-09-01T00:00:00.000Z",
            },
            {
              itemId: "other",
              title: "Detective Comics #900",
              price: { value: "8.00" },
              itemCreationDate: "2026-09-01T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const book = mapInventoryRow(
        {
          Series: "Action Comics, Vol. 1",
          "Issue Full": "900C",
          Publisher: "DC Comics",
          "CLZ Hash": "ac-900c",
          Quantity: 1,
        },
        0,
      );
      const result = await ebaySoldAdapter.fetchComps(book);
      const requested = decodeURIComponent((seen[0] ?? "").replace(/\+/g, " "));
      expect(requested).toContain("category_ids=63");
      expect(requested).toContain("q=Action Comics #900");
      expect(requested).not.toMatch(/DC Comics/);
      expect(result.sales).toHaveLength(1);
      expect(result.sales[0]?.price).toBe(12);
      expect(result.sales[0]?.title).toMatch(/Action Comics #900/);
      expect(result.sales[0]?.provenance.verificationStatus).toBe("unverified");
      expect(result.sales[0]?.provenance.notes ?? "").toMatch(/unverified ask/);
      expect(result.sales[0]?.provenance.notes ?? "").toMatch(/not a sold ledger/);
      expect(result.sales[0]?.provenance.ruleOrModelVersion).toBe("ebay-sold@0.2.0");
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("injected adapter results flow through without fabrication", async () => {
    const adapter = fixtureCompsAdapter([
      {
        id: "a",
        price: 40,
        saleDate: new Date("2026-08-01"),
        source: "ebay.com/sold",
        provenance: {
          method: "observed",
          ruleOrModelVersion: "test",
          verificationStatus: "verified",
          confidence: 0.9,
        },
      },
    ]);
    const { sales } = await fetchCompsForHolding(comic, [adapter]);
    expect(sales).toEqual([
      expect.objectContaining({ id: "a", price: 40, source: "ebay.com/sold" }),
    ]);
  });
});
