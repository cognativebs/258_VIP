import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLLECTIBLES_HEADLINE_RULES_V0_2_0 } from "../classifier/collectibles-headline-seed.js";
import { independenceGroup } from "../clustering/item-clusters.js";
import { POKEMON_SYNTHESIS_PROFILE_SEED as PROFILE } from "./synthesis-seed.js";
import { SynthesisProfileSchema, bandFor, planSynthesis, type SynthesisItem } from "./synthesis.js";

const AT = new Date("2026-10-04T12:00:00.000Z");
const CEILINGS = { pokebeach_official: 0.9, gdelt_doc_v2: 0.6, alpha_investments_youtube: 0.3 };
const set = (key: string) => ({ kind: "set" as const, normalizedKey: key, mention: key, entityRef: null });
const item = (id: string, theme: string | null, hoursAgo: number, entities = [set("fixture-rise")], sourceKey = "pokebeach_official", url = `https://www.pokebeach.com/2026/10/${id}`, hedged = false): SynthesisItem => ({
  id,
  sourceKey,
  group: independenceGroup(sourceKey, url),
  title: `${id} title`,
  url,
  at: new Date(AT.getTime() - hoursAgo * 3600_000).toISOString(),
  theme,
  hedged,
  entities,
  rawDocumentId: "00000000-0000-0000-0000-000000000001",
  provMethod: sourceKey === "alpha_investments_youtube" ? "opinion" : "inferred",
});
const plan = (items: SynthesisItem[]) => planSynthesis(items, { at: AT, profile: PROFILE, rules: COLLECTIBLES_HEADLINE_RULES_V0_2_0, ceilings: CEILINGS });

describe("synthesis profile", () => {
  it("is the operator's starting profile, embedded exactly by the migration", () => {
    const sql = readFileSync(new URL("../../../../infra/db/migrations/20261004_02_signals_synthesis.sql", import.meta.url), "utf8");
    expect(JSON.parse(/\$profile\$([\s\S]*?)\$profile\$/.exec(sql)![1]!)).toEqual(PROFILE);
    expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT \(event_id, raw_document_id, item_ref\)/);
    const bad = structuredClone(PROFILE) as any;
    bad.bands[1].minPriority = 0.01;
    bad.neverThemes.push("PREORDER");
    expect(SynthesisProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("bands read-time priority; High Conviction needs two independent sources", () => {
    expect(bandFor(0.04, 1, PROFILE)).toBe("noise");
    expect(bandFor(0.1, 1, PROFILE)).toBe("watch");
    expect(bandFor(0.15, 1, PROFILE)).toBe("emerging");
    expect(bandFor(0.25, 1, PROFILE)).toBe("strong");
    expect(bandFor(0.4, 1, PROFILE)).toBe("strong");
    expect(bandFor(0.4, 2, PROFILE)).toBe("high_conviction");
  });
});

describe("planSynthesis", () => {
  it("an official factual article stands alone; a card reveal alone does not; competitive never surfaces", () => {
    const out = plan([item("pre", "PREORDER", 5), item("rev", "CARD_REVEAL", 6, [set("other")]), item("comp", "COMPETITIVE", 7, [set("third")])]);
    expect(out.map((c) => [c.kind, c.theme, c.items.map((i) => i.id)])).toEqual([["solo", "PREORDER", ["pre"]]]);
    expect(out[0]!.scores).toEqual({ baseConfidence: 0.54, baseImpact: 0.3, noiseProbability: 0.3, direction: "mixed" });
    expect(out[0]!.eventKey).toBe(`synth:PREORDER:set:fixture-rise:pre`);
  });

  it("clusters card reveals, anchored on the earliest article so later articles join the same event", () => {
    const [c] = plan([item("r2", "CARD_REVEAL", 10), item("r1", "CARD_REVEAL", 30), item("r3", "CARD_REVEAL", 2)]);
    expect(c).toMatchObject({ kind: "cluster", theme: "CARD_REVEAL", independentSourceCount: 1, eventKey: "synth:CARD_REVEAL:set:fixture-rise:r1" });
    expect(c!.items.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("corroboration lowers noise per independent outlet; confidence is the best article's, hedging counts", () => {
    const [c] = plan([
      item("pb", "PREORDER", 5, [set("fixture-rise")], "pokebeach_official", "https://www.pokebeach.com/2026/10/pb", true),
      item("gd", "PREORDER", 4, [set("fixture-rise")], "gdelt_doc_v2", "https://news.fixture.example/x"),
    ]);
    expect(c).toMatchObject({ kind: "cluster", independentSourceCount: 2, groups: ["news.fixture.example", "pokebeach.com"] });
    // pb: 0.9 × 0.8 (hedged) × 0.6 = 0.432; gd: 0.6 × 0.6 = 0.36 → best 0.432. Noise 0.3² = 0.09.
    expect(c!.scores).toMatchObject({ baseConfidence: 0.432, noiseProbability: 0.09 });
  });

  it("an article joins only its strongest cluster, and opinion-only signals say so", () => {
    const both = [set("fixture-rise"), { kind: "pokemon" as const, normalizedKey: "fixtureon", mention: "Fixtureon", entityRef: "pokemon:dex:1" }];
    const out = plan([
      item("a", "CARD_REVEAL", 3, both),
      item("b", "CARD_REVEAL", 4, both),
      item("yt1", "REPRINT", 2, [set("x")], "alpha_investments_youtube", "https://www.youtube.com/watch?v=1"),
      item("yt2", "REPRINT", 1, [set("x")], "alpha_investments_youtube", "https://www.youtube.com/watch?v=2"),
    ]);
    const ids = out.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.find((c) => c.theme === "CARD_REVEAL")!.entity!.kind).toBe("set");
    expect(out.find((c) => c.theme === "REPRINT")).toMatchObject({ provMethod: "opinion", independentSourceCount: 1 });
  });

  it("only official sources stand alone, and only inside the window", () => {
    expect(plan([item("old", "PREORDER", 100)])).toEqual([]);
    expect(plan([item("gd", "PREORDER", 1, [set("y")], "gdelt_doc_v2", "https://news.fixture.example/y")])).toEqual([]);
  });
});
