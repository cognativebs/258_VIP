import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RssAdapter } from "../adapters/rss-adapter.js";
import { DAILY_COLLECTIBLES_PROFILE_SEED } from "../curation/daily-collectibles-seed.js";
import { DailySportsProfileSchema, allocateSlots } from "../curation/daily-sports.js";
import { COLLECTIBLES_HEADLINE_RULES_SEED } from "./collectibles-headline-seed.js";
import { SPORTS_HEADLINE_RULES_SEED } from "./sports-headline-seed.js";
import {
  ClassifierRuleSetSchema,
  LlmClassificationSchema,
  compileRuleSet,
  decideByLlm,
  decideByRules,
  llmMessages,
  type HeadlineDecision,
} from "./sports-headline.js";

const MIGRATION = readFileSync(
  new URL("../../../../infra/db/migrations/20261001_03_signals_collectibles_news.sql", import.meta.url),
  "utf8",
);
const embedded = (tag: string) => JSON.parse(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(MIGRATION)![1]!);
const c = compileRuleSet(COLLECTIBLES_HEADLINE_RULES_SEED);
const kind = (d: HeadlineDecision) => (d.outcome === "signal" ? d.signalType : d.outcome);
const decide = (title: string) => kind(decideByRules({ title, description: null }, c));

describe("collectibles-headline@0.1.0", () => {
  it("parses, is unverified, and the migration embeds exactly this object and the daily profile", () => {
    expect(ClassifierRuleSetSchema.parse(COLLECTIBLES_HEADLINE_RULES_SEED).domain).toBe("collectibles");
    expect(COLLECTIBLES_HEADLINE_RULES_SEED.notes).toMatch(/unverified/);
    expect(embedded("rules")).toEqual(COLLECTIBLES_HEADLINE_RULES_SEED);
    expect(embedded("profile")).toEqual(DAILY_COLLECTIBLES_PROFILE_SEED);
  });

  it("adds four disabled news sources with no endpoint, and no market-data source", () => {
    for (const key of ["pokebeach_rss", "psa_news", "tag_news", "alpha_investments_youtube"]) {
      expect(MIGRATION).toContain(`('${key}'`);
    }
    expect(MIGRATION).not.toMatch(/adapter_enabled\s*=\s*true|is_active\s*=\s*true/i);
    expect(MIGRATION).not.toMatch(/INSERT INTO vault_market/i);
    expect(MIGRATION).toContain("'creator_opinion'");
  });

  it("maps collectibles events to types, and drops reviews and listicles", () => {
    expect(decide("Fixture Knight gets live-action TV series order")).toBe("MEDIA_ADAPTATION");
    expect(decide("Publisher announces second printing of Fixture Night #1")).toBe("REPRINT");
    expect(decide("PSA raises prices on Value service level")).toBe("GRADING_SERVICE_CHANGE");
    expect(decide("TAG pauses submissions for two weeks")).toBe("GRADING_SERVICE_CHANGE");
    expect(decide("Elite Trainer Box restock hits retailers this week")).toBe("RESTOCK");
    expect(decide("Fixture Storm expansion revealed, release date set for February")).toBe("SET_RELEASE");
    expect(decide("Fixture Comics delays issue #3 by a month")).toBe("SUPPLY_CHANGE");
    expect(decide("Fixture #1 CGC 9.8 sells for $1.2 million")).toBe("AUCTION_RESULT");
    expect(decide("Review: Fixture Knight #12 is a quiet triumph")).toBe("noise");
    expect(decide("My top 10 sealed products to hold")).toBe("no_signal");
  });

  it("allocates 20 slots as 8 / 7 / 3 / 2 and puts each source in one lane", () => {
    const p = DailySportsProfileSchema.parse(DAILY_COLLECTIBLES_PROFILE_SEED);
    expect(Object.fromEntries(allocateSlots(p))).toEqual({ comics: 8, pokemon: 7, grading: 3, creator: 2 });
    expect(p.groups.flatMap((g) => g.lanes)).toEqual([
      "comicsbeat_rss",
      "pokebeach_rss",
      "psa_news",
      "tag_news",
      "alpha_investments_youtube",
    ]);
  });
});

describe("LLM subject kinds per rule set", () => {
  const llm = (subjectKind: string) =>
    LlmClassificationSchema.parse({
      signalType: "REPRINT",
      subjectKind,
      subjectName: "Fixture Storm",
      severity: null,
      hedged: false,
      confidence: 0.8,
      rationale: "test",
    });
  const h = { title: "Fixture Storm gets a reprint wave", description: null };

  it("collectibles accept products, characters, creators and companies; sports accepts players only", () => {
    expect(decideByLlm(h, c, llm("product"))).toMatchObject({ outcome: "signal", subjectKind: "product" });
    expect(decideByLlm(h, c, llm("team"))).toMatchObject({ outcome: "no_signal" });
    const sports = compileRuleSet(SPORTS_HEADLINE_RULES_SEED);
    const injury = LlmClassificationSchema.parse({ ...llm("product"), signalType: "PLAYER_INJURY" });
    expect(decideByLlm({ title: "Guard out 6-8 weeks", description: null }, sports, injury)).toMatchObject({
      outcome: "no_signal",
    });
  });

  it("briefs the LLM for the rule set's domain", () => {
    expect(llmMessages(h, COLLECTIBLES_HEADLINE_RULES_SEED).system).toMatch(/collectibles news headline/);
    expect(llmMessages(h, SPORTS_HEADLINE_RULES_SEED).system).toMatch(/sports news headline/);
  });
});

describe("Atom feeds (YouTube)", () => {
  it("parses entries: id as guid, the alternate link, and media:description", () => {
    const xml = readFileSync(new URL("../adapters/fixtures/alpha_investments_youtube-sample.xml", import.meta.url), "utf8");
    const items = new RssAdapter({ feedUrl: "", sourceId: "alpha_investments_youtube", rateLimitMs: 0, snapshotDir: "." }).parseSnapshot({
      url: "fixture://alpha",
      fetchedAt: "2026-10-01T00:00:00.000Z",
      rawXml: xml,
      snapshotPath: "fixture.xml",
      byteLength: xml.length,
    });
    expect(items.map((i) => [i.guid, i.sourceUrl, i.signalDate])).toEqual([
      ["yt:video:FIXTURE0001", "https://www.youtube.com/watch?v=FIXTURE0001", "2026-09-30"],
      ["yt:video:FIXTURE0002", "https://www.youtube.com/watch?v=FIXTURE0002", "2026-09-29"],
    ]);
    expect(items[0]!.body).toMatch(/reprint wave/);
  });
});
