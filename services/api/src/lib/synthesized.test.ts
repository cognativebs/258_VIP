import { describe, expect, it } from "vitest";
import { POKEMON_SYNTHESIS_PROFILE_SEED } from "@vip/signals";
import { buildSynthesized, type Queryable } from "./synthesized.js";

const AT = new Date("2026-10-04T12:00:00.000Z");
const sig = (id: string, priority: number, independent: number, influence = priority, code = "PREORDER", primaryItems = 1) => ({
  id,
  event_id: `e-${id}`,
  title: `${id} title`,
  direction: "mixed",
  first_seen_at: "2026-10-04T08:00:00.000Z",
  last_updated_at: "2026-10-04T09:00:00.000Z",
  method: "inferred",
  conf: 0.54,
  impact: 0.3,
  noise: 0.3,
  code,
  display_name: code,
  primary_items: primaryItems,
  source_keys: ["pokebeach_official"],
  priority,
  influence,
  independent,
  entity: "set:fixture-rise",
});

function stub(signals: unknown[]): Queryable {
  return {
    query: async (text) => {
      if (text.includes("signals_synthesis_profile")) return { rows: [{ version: "0.1.0", profile_json: POKEMON_SYNTHESIS_PROFILE_SEED }] };
      if (text.includes("FROM vault_signals.signal s")) return { rows: signals };
      if (text.includes("vault_tcg.binder_slot")) return { rows: [] };
      return {
        rows: [
          { event_id: "e-a", role: "PRIMARY", independence_group: "pokebeach.com", source_item_url: "https://www.pokebeach.com/x", title: "Article", author_name: "Writer", source_id: "pokebeach_official", at: "2026-10-04T08:00:00.000Z", published_at_source: "homepage_display_time:America/Los_Angeles (inferred)" },
        ],
      };
    },
  };
}

describe("buildSynthesized", () => {
  it("bands at read time, strongest first, hides noise by default, and lists evidence", async () => {
    const out = await buildSynthesized(stub([sig("a", 0.15, 1), sig("b", 0.4, 2), sig("c", 0.4, 1), sig("d", 0.01, 1)]), { at: AT });
    expect(out.signals.map((s) => [s.signalId, s.band])).toEqual([
      ["b", "high_conviction"],
      ["c", "strong"],
      ["a", "emerging"],
    ]);
    expect(out.signals.find((s) => s.signalId === "a")!.evidence).toEqual([
      expect.objectContaining({ outlet: "pokebeach.com", url: "https://www.pokebeach.com/x", timeSource: expect.stringMatching(/inferred/) }),
    ]);
    // No exposure: an Emerging signal is Watch, a Strong one too; Buy is withheld without market data.
    expect(out.signals.map((s) => s.proposal.action)).toEqual(["Watch", "Watch", "Watch"]);
    expect(out.signals[0]!.proposal.withheld.map((w) => w.action)).toContain("Buy");
    expect(out.signals[0]!.orchestr8Question).toMatch(/Decide Buy \/ Hold/);
    const all = await buildSynthesized(stub([sig("d", 0.01, 1)]), { at: AT, includeNoise: true });
    expect(all.signals.map((s) => s.band)).toEqual(["noise"]);
  });

  it("a stored event surfaces only under the profile: a lone card reveal waits for a cluster", async () => {
    const out = await buildSynthesized(stub([sig("solo", 0.25, 1, 0.25, "CARD_REVEAL", 1), sig("pair", 0.25, 1, 0.25, "CARD_REVEAL", 2)]), {
      at: AT,
      includeNoise: true,
    });
    expect(out.signals.map((s) => [s.signalId, s.band, s.surface.kind])).toEqual([
      ["pair", "strong", "cluster"],
      ["solo", "noise", "solo"],
    ]);
    expect(out.signals[1]!.surface.reason).toBe("CARD_REVEAL needs a cluster (1 of 2 articles)");
  });

  it("attaches the PriceCharting guide for matched cards as evidence; nothing is unlocked", async () => {
    const db: Queryable = {
      query: async (text) => {
        if (text.includes("signals_synthesis_profile")) return { rows: [{ version: "0.1.0", profile_json: POKEMON_SYNTHESIS_PROFILE_SEED }] };
        if (text.includes("FROM vault_signals.signal s")) return { rows: [sig("own", 0.25, 1, 0.25, "CARD_REVEAL", 2)] };
        if (text.includes("SELECT set_name, card_name, owned, on_wishlist, external_id")) {
          return { rows: [{ set_name: "Fixture Rise", card_name: "Fixtureon ex", owned: true, on_wishlist: false, external_id: "fx1-12" }] };
        }
        if (text.includes("FROM vault_tcg.binder_slot b")) {
          return { rows: [{ external_id: "fx1-12", card_name: "Fixtureon ex", set_name: "Fixture Rise", number: "12", owned: true, wishlist: false }] };
        }
        if (text.includes("card_price_history")) {
          return { rows: [{ external_id: "fx1-12", condition: "NM", condition_assumed: true, observed_on: "2026-10-04", price: 17 }] };
        }
        if (text.includes("to_regclass")) return { rows: [{ ok: true }] };
        if (text.includes("vendor_product_map")) {
          return { rows: [{ external_id: "fx1-12", vendor_product_id: "900001", vendor_product_name: "Fixtureon ex #12", needs_review: false }] };
        }
        return { rows: [] };
      },
    };
    const out = await buildSynthesized(db, { at: AT });
    const p = out.signals[0]!.proposal;
    expect(p.action).toBe("Hold");
    expect(p.guide).toEqual([
      expect.objectContaining({ externalId: "fx1-12", condition: "NM", conditionAssumed: true, low: 17, high: 17, snapshots: 1 }),
    ]);
    expect(p.withheld.every((w) => /not sold comps/.test(w.reason))).toBe(true);
    expect(out.signals[0]!.orchestr8Question).toMatch(/PriceCharting guide for the matched cards/);
  });
});
