import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DAILY_SPORTS_PROFILE_SEED } from "@vip/signals";
import { normalizeDsn } from "../db/client.js";
import { buildDailySports, type Queryable } from "./dailySports.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const AT = new Date("2026-10-01T12:00:00.000Z");

function row(id: string, sport: string, influence: number, direction: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `${id} headline`,
    summary: `${id} summary`,
    direction,
    first_seen_at: "2026-10-01T08:00:00.000Z",
    base_confidence: 0.33,
    base_impact: 0.3,
    noise_probability: 0.3,
    prov_verification: "unverified",
    code: "PLAYER_INJURY",
    display_name: "Player injury",
    influence,
    source_id: "espn_rss",
    feed_url: `https://www.espn.com/espn/rss/${sport}/news`,
    source_item_url: `https://www.espn.com/${sport}/story/_/id/${id}?utm_source=rss`,
    player: null,
    ...extra,
  };
}

function stubDb(rows: unknown[]): Queryable & { calls: { text: string; params?: unknown[] }[] } {
  const calls: { text: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      if (text.includes("signals_curation_profile")) {
        return { rows: [{ version: "0.1.0", verified: false, profile_json: DAILY_SPORTS_PROFILE_SEED }] };
      }
      return { rows };
    },
  };
}

describe("buildDailySports", () => {
  it("applies the current profile, credits and links ESPN, and frames exit sports", async () => {
    const db = stubDb([
      row("nfl-1", "nfl", 0.05, "down", { player: "Fixture QB" }),
      row("ncf-1", "ncf", 0.04, "down"),
      row("nba-1", "nba", 0.2, "up"),
      row("mlb-1", "mlb", 0.1, "down"),
      row("nhl-1", "nhl", 0.9, "down"),
    ]);
    const out = await buildDailySports(db, AT);
    expect(db.calls[1]!.params).toEqual([AT.toISOString(), 24]);
    expect(out.profile).toMatchObject({ name: "daily-sports", version: "0.1.0", slots: 20, verified: false });
    expect(out.outsideProfile).toBe(1);
    expect(out.items.map((i) => [i.signalId, i.group, i.framing])).toEqual([
      ["nba-1", "basketball", "sell_window"],
      ["mlb-1", "baseball", "exit_watch"],
      ["nfl-1", "football", null],
      ["ncf-1", "football", null],
    ]);
    const nfl = out.items.find((i) => i.signalId === "nfl-1")!;
    expect(nfl).toMatchObject({
      attribution: "Provided by ESPN",
      sourceUrl: "https://www.espn.com/nfl/story/_/id/nfl-1?utm_source=rss",
      player: "Fixture QB",
      verification: "unverified",
    });
    expect(out.provenance.notes).toMatch(/not a Sell recommendation/);
  });

  it("says so when no profile is current", async () => {
    const db: Queryable = { query: async () => ({ rows: [] }) };
    await expect(buildDailySports(db, AT)).rejects.toThrow(/no current daily-sports/);
  });
});

describe.skipIf(!DSN)("buildDailySports SQL (IQVAULT_TEST_DSN, read-only)", () => {
  it("runs against the migrated schema and allocates 16 / 2 / 1 / 1", async () => {
    const pool = new Pool({ connectionString: normalizeDsn(DSN!) });
    try {
      const out = await buildDailySports(pool, new Date("2000-01-01T00:00:00Z"));
      expect(out.items).toEqual([]);
      expect(out.groups.map((g) => [g.key, g.allocated])).toEqual([
        ["football", 16],
        ["soccer", 2],
        ["basketball", 1],
        ["baseball", 1],
      ]);
    } finally {
      await pool.end();
    }
  });
});
