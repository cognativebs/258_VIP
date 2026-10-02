import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GdeltDocAdapter, gdeltRequestUrl } from "../adapters/gdelt-doc-adapter.js";
import { DAILY_HEADLINES_PROFILE_SEED, DAILY_MARKETS_PROFILE_SEED } from "../curation/daily-macro-seed.js";
import { DailySportsProfileSchema, allocateSlots } from "../curation/daily-sports.js";
import { MACRO_HEADLINE_RULES_SEED } from "./macro-headline-seed.js";
import { ClassifierRuleSetSchema, compileRuleSet, decideByRules } from "./sports-headline.js";

const MIGRATION = readFileSync(
  new URL("../../../../infra/db/migrations/20261001_04_signals_macro_news.sql", import.meta.url),
  "utf8",
);
const embedded = (tag: string) => JSON.parse(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(MIGRATION)![1]!);
const c = compileRuleSet(MACRO_HEADLINE_RULES_SEED);
const decide = (title: string) => {
  const d = decideByRules({ title, description: null }, c);
  return d.outcome === "signal" ? d.signalType : d.outcome;
};

describe("macro-headline@0.1.0 and the headline/markets profiles", () => {
  it("parse, are unverified, and the migration embeds them exactly without touching a source row", () => {
    expect(ClassifierRuleSetSchema.parse(MACRO_HEADLINE_RULES_SEED).domain).toBe("macro");
    expect(embedded("rules")).toEqual(MACRO_HEADLINE_RULES_SEED);
    expect(embedded("headlines")).toEqual(DAILY_HEADLINES_PROFILE_SEED);
    expect(embedded("markets")).toEqual(DAILY_MARKETS_PROFILE_SEED);
    expect(MIGRATION).not.toMatch(/signals_news_source/);
    expect(MIGRATION).not.toMatch(/INSERT INTO vault_market/i);
  });

  it("allocates headlines 12 US / 8 world, and markets 20 business", () => {
    expect(Object.fromEntries(allocateSlots(DailySportsProfileSchema.parse(DAILY_HEADLINES_PROFILE_SEED)))).toEqual({ us: 12, world: 8 });
    expect(Object.fromEntries(allocateSlots(DailySportsProfileSchema.parse(DAILY_MARKETS_PROFILE_SEED)))).toEqual({ business: 20 });
  });

  it("keeps only headlines that change a collector's costs, demand or channels", () => {
    expect(decide("New tariffs on imported printed goods take effect next month")).toBe("TRADE_POLICY");
    expect(decide("EU moves to end de minimis duty exemption on small parcels")).toBe("TRADE_POLICY");
    expect(decide("USPS proposes January postage rate increase")).toBe("SHIPPING_CHANGE");
    expect(decide("IRS delays 1099-K reporting threshold again")).toBe("REGULATION");
    expect(decide("Hasbro earnings beat as trading card revenue jumps")).toBe("COMPANY_EVENT");
    expect(decide("eBay to acquire a card-grading startup")).toBe("COMPANY_EVENT");
    expect(decide("Gold hits record as investors seek safety")).toBe("MARKET_MOVE");
    expect(decide("Fed holds interest rates steady")).toBe("MACRO_TREND");
    expect(decide("City council approves new park budget")).toBe("no_signal");
    expect(decide("Ten recipes for the autumn harvest")).toBe("noise");
    expect(decide("5 best stocks to buy this week")).toBe("noise");
  });

  it("does not read the month May as a hedge", () => {
    const d = decideByRules({ title: "Tariffs on paper goods start in May", description: null }, c);
    expect(d).toMatchObject({ outcome: "signal", hedged: false });
  });
});

describe("GDELT DOC adapter", () => {
  const adapter = new GdeltDocAdapter({ sourceId: "gdelt_doc_v2", snapshotDir: ".", rateLimitMs: 0 });
  const parse = (raw: string) => adapter.parseSnapshot({ rawXml: raw, fetchedAt: "2026-10-01T00:00:00.000Z" });

  it("builds an ArtList JSON request for the lane query", () => {
    const u = new URL(gdeltRequestUrl("https://api.gdeltproject.org/api/v2/doc/doc", { lane: "us", query: "(tariff) sourcecountry:US" }));
    expect(Object.fromEntries(u.searchParams)).toEqual({
      query: "(tariff) sourcecountry:US",
      mode: "ArtList",
      format: "json",
      maxrecords: "75",
      timespan: "24h",
      sort: "DateDesc",
    });
  });

  it("parses articles once each, quarantines malformed ones, and keeps the outlet", () => {
    const raw = readFileSync(new URL("../adapters/fixtures/gdelt_doc_v2-us-sample.json", import.meta.url), "utf8");
    const items = parse(raw);
    expect(items.map((i) => [i.quarantineStatus, i.signalDate, i.outlet])).toEqual([
      ["active", "2026-09-30", "fixture-daily.example"],
      ["active", "2026-09-30", "fixture-post.example"],
      ["active", "2026-09-30", "fixture-times.example"],
      ["quarantined", "2026-09-30", "broken.example"],
    ]);
    expect(items[0]!.guid).toBe("https://fixture-daily.example/2026/09/30/tariffs-trading-cards");
  });

  it("handles an empty answer, and hashes a URL too long for item_ref", () => {
    expect(parse("{}")).toEqual([]);
    const long = `https://fixture.example/${"a".repeat(1100)}`;
    const [item] = parse(JSON.stringify({ articles: [{ url: long, title: "Tariffs rise", seendate: "20261001T000000Z" }] }));
    expect(item!.guid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(item!.sourceUrl).toBe(long);
  });
});
