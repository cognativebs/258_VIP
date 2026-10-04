import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPORTS_HEADLINE_RULES_SEED } from "./sports-headline-seed.js";
import {
  ClassifierRuleSetSchema,
  LlmClassificationSchema,
  compileRuleSet,
  decideByLlm,
  decideByRules,
  scoreDecision,
  type HeadlineDecision,
  type LlmClassification,
} from "./sports-headline.js";

const c = compileRuleSet(SPORTS_HEADLINE_RULES_SEED);
const decide = (title: string, description: string | null = null) => decideByRules({ title, description }, c);
const kind = (d: HeadlineDecision) => (d.outcome === "signal" ? d.signalType : d.outcome);

describe("seed rule set", () => {
  it("parses, is unverified, and the migration embeds exactly this object", () => {
    expect(ClassifierRuleSetSchema.parse(SPORTS_HEADLINE_RULES_SEED).version).toBe("0.1.0");
    expect(SPORTS_HEADLINE_RULES_SEED.notes).toMatch(/unverified/);
    const sql = readFileSync(
      new URL("../../../../infra/db/migrations/20261001_01_signals_sports_classification.sql", import.meta.url),
      "utf8",
    );
    const embedded = /\$rules\$([\s\S]*?)\$rules\$/.exec(sql)?.[1];
    expect(JSON.parse(embedded!)).toEqual(SPORTS_HEADLINE_RULES_SEED);
  });

  it("rejects a bad regex and a rule type with no scoring entry", () => {
    const bad = structuredClone(SPORTS_HEADLINE_RULES_SEED) as any;
    bad.noisePatterns.push("(unclosed");
    delete bad.types.MILESTONE;
    const r = ClassifierRuleSetSchema.safeParse(bad);
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(["invalid regular expression", "no scoring entry for MILESTONE"]));
  });
});

describe("keyword pre-filter and rules", () => {
  it("drops rankings, betting, fantasy and previews before any classification", () => {
    for (const t of [
      "Power Rankings: where every contender stands",
      "Best bets for Week 5",
      "Fantasy football sleepers for Week 5",
      "Stanley Cup odds: favorites ahead of opening night",
      "Team-by-team season previews",
      "Follow live: Falcons take the lead",
    ]) {
      expect(kind(decide(t))).toBe("noise");
    }
  });

  it("maps concrete events to types, in rule order", () => {
    expect(kind(decide("Former star guard dies at 81"))).toBe("PLAYER_DEATH");
    // Death outranks the award words in the same title.
    expect(kind(decide("League's first MVP dies at 93"))).toBe("PLAYER_DEATH");
    // Injury outranks the award race it interrupts.
    expect(kind(decide("Shortstop, chasing batting title, leaves game with sprained ankle"))).toBe("PLAYER_INJURY");
    expect(kind(decide("Tight end fined for taunting"))).toBe("DISCIPLINE");
    expect(kind(decide("Veteran pitcher to retire after this season"))).toBe("RETIREMENT");
    expect(kind(decide("Outfielder becomes 8th to join 40 HR-40 SB club"))).toBe("MILESTONE");
    expect(kind(decide("Center gets $60.5M deal, becomes highest-paid player"))).toBe("TRANSACTION");
    expect(kind(decide("Heisman watch: quarterback makes his case"))).toBe("AWARD_RACE");
    expect(kind(decide("Coach praises defense after shutout"))).toBe("no_signal");
  });

  it("a recovery is not an injury signal", () => {
    expect(kind(decide("Defensive end clears concussion protocol"))).toBe("no_signal");
  });

  it("reads injury severity from the title before the summary, and marks hedged claims", () => {
    const d = decide(
      "Injured receiver to miss extended time, coach says",
      'The injury is "not season-ending," according to the coach.',
    );
    expect(d).toMatchObject({ signalType: "PLAYER_INJURY", severity: "weeks" });
    expect(decide("Linebacker lost for season with torn ACL")).toMatchObject({ severity: "season", hedged: false });
    expect(decide("Pitcher heading to injured list, likely out until playoffs")).toMatchObject({
      severity: "weeks",
      hedged: true,
    });
    expect(decide("Forward leaves game with ankle sprain")).toMatchObject({ severity: "day" });
  });
});

describe("LLM decisions", () => {
  const llm = (o: Partial<LlmClassification>): LlmClassification =>
    LlmClassificationSchema.parse({
      signalType: "PLAYER_INJURY",
      subjectKind: "player",
      subjectName: "Fixture Player",
      severity: "weeks",
      hedged: false,
      confidence: 0.9,
      rationale: "test",
      ...o,
    });

  it("only players become signals; noise never reaches the LLM verdict", () => {
    const h = { title: "Assistant coach hospitalized", description: null };
    expect(decideByLlm(h, c, llm({ subjectKind: "coach" }))).toMatchObject({ outcome: "no_signal" });
    expect(decideByLlm(h, c, llm({ signalType: "NONE" }))).toMatchObject({ outcome: "no_signal" });
    expect(decideByLlm({ title: "Fantasy rankings: Week 5", description: null }, c, llm({}))).toMatchObject({
      outcome: "noise",
    });
    expect(decideByLlm({ title: "Guard out 6-8 weeks", description: null }, c, llm({}))).toMatchObject({
      outcome: "signal",
      method: "llm",
      subjectName: "Fixture Player",
      severity: "weeks",
    });
  });

  it("rejects malformed LLM output", () => {
    expect(LlmClassificationSchema.safeParse({ signalType: "TRADE_RUMOR" }).success).toBe(false);
    expect(LlmClassificationSchema.safeParse({ ...llm({}), confidence: 1.4 }).success).toBe(false);
  });
});

describe("scores", () => {
  it("confidence = source ceiling × hedge factor × classifier confidence; impact by severity", () => {
    const hedged = decide("Pitcher heading to injured list, likely out until playoffs");
    if (hedged.outcome !== "signal") throw new Error("expected a signal");
    expect(scoreDecision(hedged, c.ruleSet, 0.55)).toEqual({
      baseConfidence: 0.264,
      baseImpact: 0.3,
      noiseProbability: 0.3,
      direction: "down",
    });
    const death = decide("Former star guard dies at 81");
    if (death.outcome !== "signal") throw new Error("expected a signal");
    expect(scoreDecision(death, c.ruleSet, 0.55)).toMatchObject({ baseConfidence: 0.33, baseImpact: 0.6, direction: "up" });
  });

  it("an injury of unknown severity takes the smallest injury impact", () => {
    const d = decide("Catcher injured in collision");
    if (d.outcome !== "signal") throw new Error("expected a signal");
    expect(d.severity).toBe("unknown");
    expect(scoreDecision(d, c.ruleSet, 0.55).baseImpact).toBe(0.15);
  });
});
