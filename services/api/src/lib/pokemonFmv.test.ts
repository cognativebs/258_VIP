import { describe, expect, it } from "vitest";
import {
  PokemonFmvQuerySchema,
  PokemonGuideQuerySchema,
  buildPokemonFmv,
  buildPokemonGuide,
  type Queryable,
} from "./pokemonFmv.js";

function stubDb(registry: boolean): Queryable & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query(text: string) {
      sql.push(text);
      if (text.includes("FROM vault_tcg.binder_slot")) {
        return {
          rows: [
            { external_id: "me1-133", card_name: "Bulbasaur", set_name: "Mega Evolution", number: "133", owned: true, wishlist: false },
            { external_id: "me1-200", card_name: "Wantmon", set_name: "Mega Evolution", number: "200", owned: false, wishlist: true },
          ],
        };
      }
      if (text.includes("card_price_history")) {
        return {
          rows: [
            { external_id: "me1-133", condition: "NM", condition_assumed: true, observed_on: "2026-10-04", price: 17 },
            { external_id: "me1-133", condition: "PSA_10", condition_assumed: false, observed_on: "2026-10-04", price: 107.3 },
          ],
        };
      }
      if (text.includes("to_regclass")) return { rows: [{ ok: registry }] };
      if (text.includes("vendor_product_map")) {
        return { rows: [{ external_id: "me1-133", vendor_product_id: "123", vendor_product_name: "Bulbasaur #133", needs_review: false }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

describe("buildPokemonFmv", () => {
  it("returns ranges per condition with capped confidence, and says when a card has no match or prices", async () => {
    const out = await buildPokemonFmv(stubDb(true), { asOf: new Date("2026-10-04T15:00:00Z") });
    const [bulba, want] = out.cards;
    expect(bulba!.match).toEqual({ productId: "123", productName: "Bulbasaur #133", needsReview: false });
    expect(bulba!.fmv.map((f) => [f.condition, f.low, f.high, f.snapshots, f.conditionAssumed])).toEqual([
      ["NM", 17, 17, 1, true],
      ["PSA_10", 107.3, 107.3, 1, false],
    ]);
    expect(Math.max(...bulba!.fmv.map((f) => f.confidence))).toBeLessThanOrEqual(0.75);
    expect(want).toMatchObject({ wishlist: true, match: null, fmv: [] });
    expect(out.provenance).toMatchObject({ evidenceClass: "vendor_guide", verificationStatus: "unverified" });
  });

  it("does not query the registry tables when they are absent", async () => {
    const db = stubDb(false);
    const out = await buildPokemonFmv(db, { asOf: new Date("2026-10-04T15:00:00Z") });
    expect(out.cards[0]!.match).toBeNull();
    expect(db.sql.some((s) => s.includes("vendor_product_map m"))).toBe(false);
  });

  it("validates the query", () => {
    expect(PokemonFmvQuerySchema.safeParse({ externalId: "me1-133", windowDays: "60" }).success).toBe(true);
    expect(PokemonFmvQuerySchema.safeParse({ externalId: "x'; drop" }).success).toBe(false);
    expect(PokemonFmvQuerySchema.safeParse({ windowDays: "0" }).success).toBe(false);
  });
});

describe("buildPokemonGuide", () => {
  it("returns guide ranges for any ids, owned or not, and an empty list for unpriced ids", async () => {
    const out = await buildPokemonGuide(stubDb(true), { ids: ["me1-133", "sv3pt5-25"], asOf: new Date("2026-10-04T15:00:00Z") });
    expect(out.cards.map((c) => [c.externalId, c.ranges.map((r) => [r.condition, r.latest, r.conditionAssumed])])).toEqual([
      ["me1-133", [["NM", 17, true], ["PSA_10", 107.3, false]]],
      ["sv3pt5-25", []],
    ]);
    expect(out.provenance.verificationStatus).toBe("unverified");
  });

  it("validates and de-duplicates ids", () => {
    expect(PokemonGuideQuerySchema.parse({ ids: "a-1, a-1,b-2" }).ids).toEqual(["a-1", "b-2"]);
    expect(PokemonGuideQuerySchema.safeParse({ ids: "" }).success).toBe(false);
    expect(PokemonGuideQuerySchema.safeParse({ ids: "x;drop" }).success).toBe(false);
  });
});

describe("buildPokemonGuide history", () => {
  it("adds the stored daily NM guide values only when asked", async () => {
    const asOf = new Date("2026-10-04T15:00:00Z");
    const plain = await buildPokemonGuide(stubDb(true), { ids: ["me1-133"], asOf });
    expect("nmHistory" in plain.cards[0]!).toBe(false);
    const withHistory = await buildPokemonGuide(stubDb(true), { ids: ["me1-133"], asOf, history: true });
    expect((withHistory.cards[0] as { nmHistory?: unknown }).nmHistory).toEqual([{ observedOn: "2026-10-04", price: 17 }]);
    expect(PokemonGuideQuerySchema.parse({ ids: "a-1", history: "1" }).history).toBe(true);
    expect(PokemonGuideQuerySchema.parse({ ids: "a-1" }).history).toBe(false);
  });
});
