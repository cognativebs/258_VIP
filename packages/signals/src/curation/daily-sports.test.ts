import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPORTS_HEADLINE_RULES_V0_2_0 } from "../classifier/sports-headline-seed.js";
import { ClassifierRuleSetSchema, compileRuleSet, decideByRules } from "../classifier/sports-headline.js";
import { DAILY_SPORTS_PROFILE_SEED } from "./daily-sports-seed.js";
import {
  DailySportsProfileSchema,
  allocateSlots,
  curateDailySports,
  sportFromFeedUrl,
  type CurationCandidate,
} from "./daily-sports.js";

const MIGRATION = readFileSync(
  new URL("../../../../infra/db/migrations/20261001_02_signals_daily_sports_curation.sql", import.meta.url),
  "utf8",
);
const embedded = (tag: string) => JSON.parse(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(MIGRATION)![1]!);

describe("daily-sports profile", () => {
  it("is the operator's 80/10/5/5 with basketball and baseball as exit sports, and the migration embeds it", () => {
    const p = DailySportsProfileSchema.parse(DAILY_SPORTS_PROFILE_SEED);
    expect(p.groups.map((g) => [g.key, g.share, g.stance])).toEqual([
      ["football", 0.8, "collect"],
      ["soccer", 0.1, "collect"],
      ["basketball", 0.05, "exit"],
      ["baseball", 0.05, "exit"],
    ]);
    expect(p.groups.flatMap((g) => g.lanes)).not.toContain("nhl");
    expect(p.groups.flatMap((g) => g.lanes)).not.toContain("ncb");
    expect(embedded("profile")).toEqual(DAILY_SPORTS_PROFILE_SEED);
  });

  it("rejects shares that do not sum to 1, a sport in two groups, and an unknown backfill group", () => {
    const bad = structuredClone(DAILY_SPORTS_PROFILE_SEED) as any;
    bad.groups[0].share = 0.7;
    bad.groups[1].lanes.push("nfl");
    bad.backfillOrder.push("hockey");
    const r = DailySportsProfileSchema.safeParse(bad);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringMatching(/^shares sum to/), "nfl is in two groups", "unknown group hockey"]),
    );
  });

  it("allocates 20 slots as 16 / 2 / 1 / 1, and rounds by largest remainder", () => {
    expect(Object.fromEntries(allocateSlots(DAILY_SPORTS_PROFILE_SEED))).toEqual({
      football: 16,
      soccer: 2,
      basketball: 1,
      baseball: 1,
    });
    const ten = { ...DAILY_SPORTS_PROFILE_SEED, slots: 10 };
    expect(Object.fromEntries(allocateSlots(ten))).toEqual({ football: 8, soccer: 1, basketball: 1, baseball: 0 });
  });

  it("reads the sport from an ESPN feed URL", () => {
    expect(sportFromFeedUrl("https://www.espn.com/espn/rss/ncf/news")).toBe("ncf");
    expect(sportFromFeedUrl("https://www.espn.com/espn/rss/soccer/news")).toBe("soccer");
    expect(sportFromFeedUrl(null)).toBeNull();
  });
});

describe("curateDailySports", () => {
  const c = (id: string, lane: string, influence: number, direction = "down"): CurationCandidate => ({
    signalId: id,
    lane,
    influence,
    direction,
  });
  const small = { ...DAILY_SPORTS_PROFILE_SEED, slots: 10 }; // 8 / 1 / 1 / 0

  it("fills each sport's quota with its best signals, regardless of other sports' scores", () => {
    const out = curateDailySports(
      [
        ...Array.from({ length: 12 }, (_, i) => c(`nfl-${i}`, i % 2 ? "nfl" : "ncf", 0.01 + i * 0.001)),
        c("soc-1", "soccer", 0.002),
        c("nba-hi", "nba", 0.5, "up"),
        c("nba-lo", "nba", 0.4, "up"),
        c("mlb-1", "mlb", 0.9, "up"),
        c("nhl-1", "nhl", 0.99),
      ],
      small,
    );
    // Baseball has 0 slots at 10; a strong MLB signal does not take a football slot. Hockey is outside.
    expect(out.items.map((i) => i.signalId)).not.toContain("mlb-1");
    expect(out.outsideProfile).toBe(1);
    expect(out.items.filter((i) => i.group === "football")).toHaveLength(8);
    expect(out.items.filter((i) => i.group === "soccer").map((i) => i.signalId)).toEqual(["soc-1"]);
    expect(out.items.filter((i) => i.group === "basketball").map((i) => i.signalId)).toEqual(["nba-hi"]);
    expect(out.items.map((i) => i.rank)).toEqual(out.items.map((_, i) => i + 1));
    expect(out.items[0]!.signalId).toBe("nba-hi");
  });

  it("frames exit sports: up = sell window, otherwise exit watch; collect sports carry no framing", () => {
    const out = curateDailySports(
      [c("nba-up", "nba", 0.2, "up"), c("mlb-down", "mlb", 0.2, "down"), c("nfl-up", "nfl", 0.2, "up")],
      DAILY_SPORTS_PROFILE_SEED,
    );
    const framing = Object.fromEntries(out.items.map((i) => [i.signalId, i.framing]));
    expect(framing).toEqual({ "nba-up": "sell_window", "mlb-down": "exit_watch", "nfl-up": null });
  });

  it("gives unfilled slots to football, then soccer, never to exit sports", () => {
    const out = curateDailySports(
      [
        ...Array.from({ length: 3 }, (_, i) => c(`nfl-${i}`, "nfl", 0.1 - i * 0.01)),
        c("soc-1", "soccer", 0.05),
        c("soc-2", "soccer", 0.04),
        c("soc-3", "soccer", 0.03),
        c("nba-1", "nba", 0.2),
        c("nba-2", "nba", 0.19),
      ],
      small,
    );
    // Football has 3 of 8, so 5 open; soccer's two leftovers backfill; exit sports never do.
    expect(out.items.filter((i) => i.backfilled).map((i) => i.signalId)).toEqual(["soc-2", "soc-3"]);
    expect(out.items.map((i) => i.signalId)).not.toContain("nba-2");
    expect(out.unfilled).toBe(3);
    expect(out.groups.find((g) => g.key === "soccer")).toMatchObject({ allocated: 1, filled: 1, backfilled: 2 });
  });
});

describe("sports-headline@0.2.0 (soccer)", () => {
  const rules = compileRuleSet(SPORTS_HEADLINE_RULES_V0_2_0);
  const kind = (title: string) => {
    const d = decideByRules({ title, description: null }, rules);
    return d.outcome === "signal" ? d.signalType : d.outcome;
  };

  it("is current in the migration and embedded exactly", () => {
    expect(ClassifierRuleSetSchema.parse(SPORTS_HEADLINE_RULES_V0_2_0).version).toBe("0.2.0");
    expect(embedded("rules")).toEqual(SPORTS_HEADLINE_RULES_V0_2_0);
  });

  it("reads soccer transfers, red cards and rumours; a club move is not a milestone", () => {
    expect(kind("Striker joins rival club on permanent transfer")).toBe("TRANSACTION");
    expect(kind("Winger completes €40m move")).toBe("TRANSACTION");
    expect(kind("Defender sent off as champions slip")).toBe("DISCIPLINE");
    expect(kind("Transfer rumours: club linked with midfielders")).toBe("noise");
    expect(kind("Midfielder ruled out with hamstring problem")).toBe("PLAYER_INJURY");
    expect(kind("Outfielder becomes 8th to join 40 HR-40 SB club")).toBe("MILESTONE");
  });
});
