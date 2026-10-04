import { describe, expect, it } from "vitest";
import { POKEMON_SYNTHESIS_PROFILE_SEED } from "@vip/signals";
import { buildSynthesized, type Queryable } from "./synthesized.js";

const AT = new Date("2026-10-04T12:00:00.000Z");
const sig = (id: string, priority: number, independent: number, influence = priority) => ({
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
  code: "PREORDER",
  display_name: "Preorder",
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
      return {
        rows: [
          { event_id: "e-a", independence_group: "pokebeach.com", source_item_url: "https://www.pokebeach.com/x", title: "Article", author_name: "Writer", source_id: "pokebeach_official", at: "2026-10-04T08:00:00.000Z", published_at_source: "homepage_display_time:America/Los_Angeles (inferred)" },
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
    const all = await buildSynthesized(stub([sig("d", 0.01, 1)]), { at: AT, includeNoise: true });
    expect(all.signals.map((s) => s.band)).toEqual(["noise"]);
  });
});
