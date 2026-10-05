import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POKEMON_SYNTHESIS_PROFILE_SEED as PROFILE } from "./synthesis-seed.js";
import { SynthesisProfileSchema, bandFor, surfaceFor } from "./synthesis.js";

describe("synthesis profile", () => {
  it("is the operator's starting profile, embedded exactly by the migration", () => {
    const sql = readFileSync(new URL("../../../../infra/db/migrations/20261004_03_signals_synthesis.sql", import.meta.url), "utf8");
    expect(JSON.parse(/\$profile\$([\s\S]*?)\$profile\$/.exec(sql)![1]!)).toEqual(PROFILE);
    // Clusters are stored by the PokéBeach cluster job (20261004_01); synthesis adds no evidence constraint.
    expect(sql).not.toMatch(/ALTER TABLE vault_signals\.event_evidence/);
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

describe("surfaceFor (stored cluster events)", () => {
  const official = ["pokebeach_official"];

  it("an official factual article stands alone; a card reveal alone waits for a cluster", () => {
    expect(surfaceFor({ theme: "PREORDER", primaryItems: 1, sourceKeys: official }, PROFILE)).toMatchObject({ surfaced: true, kind: "solo" });
    expect(surfaceFor({ theme: "CARD_REVEAL", primaryItems: 1, sourceKeys: official }, PROFILE)).toMatchObject({
      surfaced: false,
      reason: "CARD_REVEAL needs a cluster (1 of 2 articles)",
    });
  });

  it("a cluster surfaces whatever its theme; competitive never does", () => {
    expect(surfaceFor({ theme: "CARD_REVEAL", primaryItems: 3, sourceKeys: official }, PROFILE)).toMatchObject({ surfaced: true, kind: "cluster" });
    expect(surfaceFor({ theme: "COMPETITIVE", primaryItems: 4, sourceKeys: official }, PROFILE)).toMatchObject({ surfaced: false, kind: "cluster" });
  });

  it("only official sources stand alone", () => {
    expect(surfaceFor({ theme: "PREORDER", primaryItems: 1, sourceKeys: ["alpha_investments_youtube"] }, PROFILE).surfaced).toBe(false);
  });
});
