import { describe, expect, it } from "vitest";
import type { CardResult } from "./contracts";
import { fetchGuidePrices, guideProvenance, withGuidePrices } from "./guidePrices";

const NM = {
  condition: "NM",
  conditionAssumed: true,
  low: 80,
  high: 110,
  latest: 95,
  latestOn: "2026-10-22",
  snapshots: 5,
  recencyDays: 0,
  confidence: 0.7,
  evidenceClass: "vendor_guide",
  note: "PriceCharting guide",
};

function vip(cards: unknown[], status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({ cards }), { status })) as typeof fetch;
}

describe("fetchGuidePrices", () => {
  it("keeps the ungraded (NM-assumed) range and skips cards without one", async () => {
    const out = await fetchGuidePrices(["base1-4", "sv3pt5-25"], {
      fetchImpl: vip([
        { externalId: "base1-4", ranges: [NM, { ...NM, condition: "PSA_10", latest: 900 }] },
        { externalId: "sv3pt5-25", ranges: [] },
      ]),
    });
    expect(out.get("base1-4")).toMatchObject({ latest: 95, low: 80, high: 110, snapshots: 5 });
    expect(out.has("sv3pt5-25")).toBe(false);
  });

  it("returns nothing (never a guess) when VIP fails", async () => {
    expect((await fetchGuidePrices(["base1-4"], { fetchImpl: vip([], 503) })).size).toBe(0);
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect((await fetchGuidePrices(["base1-4"], { fetchImpl: down })).size).toBe(0);
  });

  it("labels the price as a guide range, NM assumed and unverified", async () => {
    const g = (await fetchGuidePrices(["base1-4"], { fetchImpl: vip([{ externalId: "base1-4", ranges: [NM] }]) })).get("base1-4")!;
    const p = guideProvenance(g);
    expect(p.verificationStatus).toBe("unverified");
    expect(p.source).toContain("$80.00–$110.00");
    expect(p.source).toContain("NM assumed");
  });
});

describe("withGuidePrices", () => {
  it("fills search results from one VIP call", async () => {
    const card = { source: "pokemontcg", externalId: "base1-4", name: "Charizard", priceMarket: null } as CardResult;
    const realFetch = globalThis.fetch;
    globalThis.fetch = vip([{ externalId: "base1-4", ranges: [NM] }]);
    try {
      const [out] = await withGuidePrices([card]);
      expect(out?.priceMarket).toBe(95);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
