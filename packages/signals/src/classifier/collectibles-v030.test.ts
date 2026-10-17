import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLLECTIBLES_HEADLINE_RULES_V0_2_0, COLLECTIBLES_HEADLINE_RULES_V0_3_0 } from "./collectibles-headline-seed.js";
import { ClassifierRuleSetSchema, compileRuleSet, decideByRules } from "./sports-headline.js";

const MIGRATION = readFileSync(new URL("../../../../infra/db/migrations/20261017_03_signals_collectibles_v030.sql", import.meta.url), "utf8");
const v3 = compileRuleSet(COLLECTIBLES_HEADLINE_RULES_V0_3_0);
const v2 = compileRuleSet(COLLECTIBLES_HEADLINE_RULES_V0_2_0);
const theme = (title: string, c = v3) => {
  const d = decideByRules({ title, description: null }, c);
  return d.outcome === "signal" ? d.signalType : d.outcome;
};

describe("collectibles-headline@0.3.0 (LEAK_RUMOR, MERCH, Japanese titles)", () => {
  it("parses, and the migration embeds exactly this object and promotes it only from 0.2.0", () => {
    expect(ClassifierRuleSetSchema.parse(COLLECTIBLES_HEADLINE_RULES_V0_3_0).version).toBe("0.3.0");
    expect(JSON.parse(/\$rules\$([\s\S]*?)\$rules\$/.exec(MIGRATION)![1]!)).toEqual(COLLECTIBLES_HEADLINE_RULES_V0_3_0);
    expect(MIGRATION).toMatch(/version = '0\.2\.0' AND is_current/);
  });

  it("reads leaks and rumours as LEAK_RUMOR, still hedged", () => {
    expect(theme("“Fixture Rise” Card List Leaked Ahead of Reveal")).toBe("LEAK_RUMOR");
    expect(theme("Rumor: Fixture Box Gets a Reprint")).toBe("LEAK_RUMOR");
    const d = decideByRules({ title: "Fixture Rise card list leaked", description: null }, v3);
    expect(d.outcome === "signal" && d.hedged).toBe(true);
    expect(theme("“Fixture Rise” Card List Leaked Ahead of Reveal", v2)).not.toBe("LEAK_RUMOR");
  });

  it("reads accessories and merch as MERCH, before card and product reveals", () => {
    expect(theme("Santa Cruz x Pokemon TCG Skateboards Revealed, Featuring 30 Pokemon Card Designs")).toBe("MERCH");
    expect(theme("New Fixture Playmats and Sleeves Announced")).toBe("MERCH");
    expect(theme("Fixture Plush Collection to Release at Pokemon Center")).toBe("MERCH");
    // Unchanged themes still read as before.
    expect(theme("New Premium Binders to Release Next Month")).toBe("PRODUCT_REVEAL");
    expect(theme("20+ “Fixture Rise” Card Images Revealed!")).toBe("CARD_REVEAL");
    expect(theme("“Fixture Rise” Preorders Now Live on Pokemon Center!")).toBe("PREORDER");
    expect(theme("Figuring Out the Fixture Metagame")).not.toBe("MERCH");
  });

  it("reads the official Pokémon Card channel's Japanese titles", () => {
    expect(theme("【ポケカ新商品】スペシャルデッキセットだって～～～～！？【ポケモンカード】")).toBe("PRODUCT_REVEAL");
    expect(theme("拡張パック「フィクスチャ」予約受付開始")).toBe("PREORDER");
    expect(theme("新カード公開！")).toBe("CARD_REVEAL");
  });
});
