import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  conditionFromTcgplayer,
  createTcgplayerPriceAdapter,
  extractProductId,
  observationsFromPayload,
  priceIdCandidates,
} from "./tcgplayer.js";
import { PriceObservationSchema } from "./types.js";

/**
 * Parsed against a captured real response (Charizard base1-4, product 42382),
 * so a provider shape change fails here rather than silently writing junk
 * into price history.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = JSON.parse(
  readFileSync(join(here, "fixtures", "tcgplayer-base1-4-quarter.json"), "utf8"),
) as { result?: Array<Record<string, unknown>> };

function parse(condition?: "NM" | "LP" | "MP" | "HP" | "DMG" | "UNKNOWN") {
  return observationsFromPayload(PAYLOAD, {
    externalId: "base1-4",
    productId: "42382",
    condition,
  });
}

describe("condition mapping", () => {
  it("maps the TCGplayer ladder onto VIP codes", () => {
    expect(conditionFromTcgplayer("Near Mint")).toBe("NM");
    expect(conditionFromTcgplayer("lightly played")).toBe("LP");
    expect(conditionFromTcgplayer("Damaged")).toBe("DMG");
    expect(conditionFromTcgplayer("Graded 10")).toBe("UNKNOWN");
    expect(conditionFromTcgplayer(null)).toBe("UNKNOWN");
  });
});

describe("observationsFromPayload", () => {
  it("selects Near Mint rather than assuming it — the payload reports 5 conditions", () => {
    const conditions = (PAYLOAD.result ?? []).map((r) => r.condition);
    expect(conditions).toContain("Near Mint");
    expect(conditions.length).toBeGreaterThan(1);

    const { observations } = parse("NM");
    expect(observations.length).toBeGreaterThan(0);
    // Every row must be real NM, not a fallback.
    expect(observations.every((o) => o.condition === "NM")).toBe(true);
    expect(observations.every((o) => o.conditionAssumed === false)).toBe(true);
  });

  it("emits one observation per calendar bucket with a valid schema", () => {
    const { observations } = parse("NM");
    for (const o of observations) {
      expect(() => PriceObservationSchema.parse(o)).not.toThrow();
      expect(o.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.variant).toBe("Holofoil");
      expect(o.currency).toBe("USD");
      expect(o.productId).toBe("42382");
    }
    const days = new Set(observations.map((o) => o.observedOn));
    expect(days.size).toBe(observations.length);
  });

  it("labels a zero-sale day as normalized, not observed", () => {
    const { observations } = parse("NM");
    const quiet = observations.find((o) => o.transactionCount === 0);
    expect(quiet).toBeTruthy();
    // TCGplayer publishes a market price even with no trades — that is a model
    // output, and calling it observed would overstate the evidence.
    expect(quiet!.provenance.method).toBe("normalized");
    expect(quiet!.provenance.verificationStatus).toBe("unverified");
    expect(quiet!.marketPrice).toBeGreaterThan(0);
    expect(quiet!.lowSalePrice).toBeNull();
  });

  it("labels a day with real transactions as observed evidence", () => {
    const { observations } = parse("NM");
    const traded = observations.find((o) => o.transactionCount > 0);
    expect(traded).toBeTruthy();
    expect(traded!.provenance.method).toBe("observed");
    expect(traded!.lowSalePrice).not.toBeNull();
    expect(traded!.highSalePrice).not.toBeNull();
    expect(traded!.highSalePrice!).toBeGreaterThanOrEqual(traded!.lowSalePrice!);
  });

  it("never turns TCGplayer's 0 placeholder into a $0 sale", () => {
    const { observations } = parse("NM");
    for (const o of observations) {
      expect(o.lowSalePrice === null || o.lowSalePrice > 0).toBe(true);
      expect(o.highSalePrice === null || o.highSalePrice > 0).toBe(true);
      expect(o.marketPrice === null || o.marketPrice > 0).toBe(true);
    }
  });

  it("falls back to another condition only when the wanted one is absent, and says so", () => {
    const onlyDamaged = {
      result: (PAYLOAD.result ?? []).filter((r) => r.condition === "Damaged"),
    };
    const { observations } = observationsFromPayload(onlyDamaged, {
      externalId: "base1-4",
      productId: "42382",
      condition: "NM",
    });
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.conditionAssumed === true)).toBe(true);
    expect(observations.every((o) => o.condition === "NM")).toBe(true);
    expect(observations[0]!.provenance.verificationStatus).toBe("unverified");
    expect(observations[0]!.provenance.notes).toMatch(/assumed/i);
  });

  it("reports a reason instead of returning silently empty", () => {
    expect(observationsFromPayload({ result: [] }, {
      externalId: "x",
      productId: null,
    }).emptyReason).toBeTruthy();
    expect(observationsFromPayload({ result: [{ condition: "Near Mint", buckets: [] }] }, {
      externalId: "x",
      productId: null,
    }).emptyReason).toBeTruthy();
  });
});

describe("product id resolution helpers", () => {
  it("pulls the product id out of an affiliate redirect", () => {
    expect(
      extractProductId("https://tcgplayer.pxf.io/scrydex?u=https://tcgplayer.com/product/42382"),
    ).toBe("42382");
    expect(extractProductId(encodeURIComponent("https://tcgplayer.com/product/693516"))).toBe(
      "693516",
    );
    expect(extractProductId("https://tcgplayer.com/nope")).toBeNull();
  });

  it("offers a suffix-stripped fallback id", () => {
    expect(priceIdCandidates("sm12-143a")).toEqual(["sm12-143a", "sm12-143"]);
    expect(priceIdCandidates("base1-4")).toEqual(["base1-4"]);
  });
});

describe("adapter", () => {
  it("goes idle with a reason when the product cannot be resolved", async () => {
    const adapter = createTcgplayerPriceAdapter({
      retries: 0,
      fetchImpl: (async () =>
        new Response("nope", { status: 404 })) as unknown as typeof fetch,
    });
    const result = await adapter.fetchHistory({ externalId: "base1-4" });
    expect(result.observations).toEqual([]);
    expect(result.emptyReason).toMatch(/product id/i);
  });

  it("resolves via redirect header then parses history", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("prices.pokemontcg.io")) {
        return new Response("", {
          status: 302,
          headers: { location: "https://tcgplayer.com/product/42382" },
        });
      }
      return new Response(JSON.stringify(PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = createTcgplayerPriceAdapter({ fetchImpl, retries: 0 });
    const result = await adapter.fetchHistory({ externalId: "base1-4", range: "daily" });
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.emptyReason).toBeUndefined();
    // daily must request the month range — that is the one with 1-day buckets.
    expect(calls.some((c) => c.includes("range=month"))).toBe(true);
  });

  it("only claims pokemontcg-sourced cards", () => {
    const adapter = createTcgplayerPriceAdapter();
    expect(adapter.matches("base1-4", "pokemontcg")).toBe(true);
    expect(adapter.matches("x", "manual")).toBe(false);
  });
});
