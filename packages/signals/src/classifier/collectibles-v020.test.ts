import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLLECTIBLES_HEADLINE_RULES_SEED, COLLECTIBLES_HEADLINE_RULES_V0_2_0 } from "./collectibles-headline-seed.js";
import { ClassifierRuleSetSchema, compileRuleSet, decideByRules } from "./sports-headline.js";

const MIGRATION = readFileSync(
  new URL("../../../../infra/db/migrations/20261004_02_signals_pokemon_themes.sql", import.meta.url),
  "utf8",
);
const v2 = compileRuleSet(COLLECTIBLES_HEADLINE_RULES_V0_2_0);
const v1 = compileRuleSet(COLLECTIBLES_HEADLINE_RULES_SEED);
const theme = (title: string, c = v2) => {
  const d = decideByRules({ title, description: null }, c);
  return d.outcome === "signal" ? d.signalType : d.outcome;
};

describe("collectibles-headline@0.2.0 (Pokémon themes)", () => {
  it("parses, and the migration embeds exactly this object and makes it current", () => {
    expect(ClassifierRuleSetSchema.parse(COLLECTIBLES_HEADLINE_RULES_V0_2_0).version).toBe("0.2.0");
    const embedded = JSON.parse(/\$rules\$([\s\S]*?)\$rules\$/.exec(MIGRATION)![1]!);
    expect(embedded).toEqual(COLLECTIBLES_HEADLINE_RULES_V0_2_0);
    expect(MIGRATION).toMatch(/version = '0\.1\.0' AND is_current/);
  });

  it("reads Pokémon TCG news by theme", () => {
    expect(theme("20+ “Fixture Rise” Card Images Revealed!")).toBe("CARD_REVEAL");
    expect(theme("Fixtureon ex and More English Cards Revealed from “Fixture Rise”")).toBe("CARD_REVEAL");
    expect(theme("“Fixture Rise” Preorders Now Live on Pokemon Center!")).toBe("PREORDER");
    expect(theme("“Fixture Rise” Pull Rates and Most Valuable Cards")).toBe("PULL_RATE");
    expect(theme("New Premium Binders to Release Next Month")).toBe("PRODUCT_REVEAL");
    expect(theme("Fixture Restaurant Pokemon TCG Promotion to Launch in November")).toBe("PROMOTION");
    expect(theme("Fixtureon / Testmon is the Best Play for Regionals")).toBe("COMPETITIVE");
    expect(theme("Pokemon to Release a New Holiday TCG Set!")).toBe("SET_RELEASE");
    expect(theme("Exploring Fixtureon ex")).toBe("no_signal");
  });

  it("a preorder is no longer a restock; a restock still is", () => {
    expect(theme("“Fixture Rise” Preorders Now Live", v1)).toBe("RESTOCK");
    expect(theme("“Fixture Rise” Preorders Now Live")).toBe("PREORDER");
    expect(theme("Elite Trainer Box restock hits retailers this week")).toBe("RESTOCK");
  });

  it("keeps 0.1.0's other rules and scores unchanged", () => {
    expect(COLLECTIBLES_HEADLINE_RULES_V0_2_0.types.REPRINT).toEqual(COLLECTIBLES_HEADLINE_RULES_SEED.types.REPRINT);
    expect(theme("PSA raises prices on Value service level")).toBe("GRADING_SERVICE_CHANGE");
    expect(theme("Review: a quiet triumph")).toBe("noise");
  });
});
