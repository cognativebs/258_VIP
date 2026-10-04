import { describe, expect, it } from "vitest";
import { COLLECTIBLES_HEADLINE_RULES_SEED } from "@vip/signals";
import { buildClusters, type Queryable } from "./clusters.js";

const AT = new Date("2026-10-04T12:00:00.000Z");
const row = (id: string, sourceId: string, url: string, title: string, hoursAgo: number, key: string, ref: string | null = null) => ({
  id,
  source_id: sourceId,
  canonical_url: url,
  title,
  excerpt: null,
  at: new Date(AT.getTime() - hoursAgo * 3600_000).toISOString(),
  entity_kind: "set",
  normalized_key: key,
  mention: key,
  entity_ref: ref,
});

function stub(rows: unknown[]): Queryable & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push(params ?? []);
      if (text.includes("signals_classifier_rule_set")) return { rows: [{ version: "0.1.0", rules_json: COLLECTIBLES_HEADLINE_RULES_SEED }] };
      return { rows };
    },
  };
}

describe("buildClusters", () => {
  it("themes items with the current rules, drops noise, and counts outlets", async () => {
    const db = stub([
      row("1", "pokebeach_official", "https://www.pokebeach.com/a", "Fixture Set Elite Trainer Box restock hits retailers this week", 5, "fixture-set"),
      row("2", "pokebeach_official", "https://www.pokebeach.com/b", "Fixture Set booster restock spotted at retailers this week", 10, "fixture-set"),
      row("3", "gdelt_doc_v2", "https://news.fixture.example/x", "Fixture Set restock sells out this week", 2, "fixture-set", "binder_set:fixture-set"),
      row("4", "pokebeach_official", "https://www.pokebeach.com/c", "Review: Fixture Set is fine", 1, "fixture-set"),
    ]);
    const out = await buildClusters(db, { at: AT });
    expect(db.calls[1]).toEqual([AT.toISOString(), 72, "pokemon-entities@0.1.0"]);
    expect(out.noiseItems).toBe(1);
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0]).toMatchObject({
      theme: "RESTOCK",
      mentionCount: 3,
      independentSourceCount: 2,
      groups: ["news.fixture.example", "pokebeach.com"],
      entity: { entityRef: "binder_set:fixture-set" },
    });
    expect(out.provenance.notes).toMatch(/never mentions/);
  });

  it("refuses without a current theme rule set", async () => {
    await expect(buildClusters({ query: async () => ({ rows: [] }) }, { at: AT })).rejects.toThrow(/no current collectibles-headline/);
  });
});
