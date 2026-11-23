import { syncBinderGuidePrices, type GuidePrice, type SqlRunner } from "@vip/pricing";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  binderPriceRefreshEnabled,
  formatBinderPriceRefreshReport,
  memoGuideFetcher,
  parseBinderPriceRefreshArgs,
  runBinderPriceRefresh,
} from "./binder-price-refresh.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = Date.parse("2026-11-22T12:00:00Z");

const guide = (latest: number, latestOn = "2026-11-21"): GuidePrice => ({
  latest,
  low: latest - 5,
  high: latest + 5,
  latestOn,
  snapshots: 4,
  confidence: 0.6,
  note: "fixture guide",
});

/** A fake VIP guide: never a network call. Records every id it was asked for. */
function fakeGuide(prices: Record<string, GuidePrice>) {
  const calls: string[][] = [];
  const fn = async (ids: string[]) => {
    calls.push([...ids]);
    return new Map(ids.filter((id) => prices[id]).map((id) => [id, prices[id]!] as const));
  };
  return Object.assign(fn, { calls });
}

describe("binder-price-refresh args and flag", () => {
  it("parses --dry-run and --binder in both spellings, rejects the rest", () => {
    expect(parseBinderPriceRefreshArgs([])).toEqual({ dryRun: false, binderId: null });
    expect(parseBinderPriceRefreshArgs(["--dry-run", "--binder", "b1"])).toEqual({ dryRun: true, binderId: "b1" });
    expect(parseBinderPriceRefreshArgs(["--binder=b2"])).toEqual({ dryRun: false, binderId: "b2" });
    expect(() => parseBinderPriceRefreshArgs(["--binder"])).toThrow(/binder id/);
    expect(() => parseBinderPriceRefreshArgs(["--force"])).toThrow(/unknown argument/);
  });

  it("is on by default and off only when VIP_BINDER_PRICE_REFRESH says so", () => {
    expect(binderPriceRefreshEnabled({})).toBe(true);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "" })).toBe(true);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "off" })).toBe(false);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "0" })).toBe(false);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "false" })).toBe(false);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "on" })).toBe(true);
    expect(binderPriceRefreshEnabled({ VIP_BINDER_PRICE_REFRESH: "1" })).toBe(true);
  });

  it("asks the guide for each card once per run", async () => {
    const g = fakeGuide({ a: guide(10) });
    const memo = memoGuideFetcher(g);
    await memo(["a", "b"]);
    await memo(["a", "b", "c"]);
    expect(g.calls).toEqual([["a", "b"], ["c"]]);
    expect([...memo.priced]).toEqual(["a"]);
    expect(memo.requested.size).toBe(3);
  });
});

async function inTransaction(fn: (db: PoolClient, runner: SqlRunner) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  const runner: SqlRunner = async (text, params) => {
    const res = await db.query(text, params as unknown[]);
    return { rows: res.rows, rowCount: res.rowCount };
  };
  try {
    await db.query("BEGIN");
    for (const b of ["bpr-1", "bpr-2"]) {
      await db.query(`INSERT INTO vault_tcg.binder (id, name, created_at, updated_at) VALUES ($1, $1, 0, 0)`, [b]);
    }
    await db.query(`INSERT INTO vault_tcg.binder_page (id, binder_id, page_index, created_at) VALUES ('bpr-1-p0','bpr-1',0,0), ('bpr-1-p1','bpr-1',1,0), ('bpr-2-p0','bpr-2',0,0)`);
    const slots: Array<[string, string, number, string | null, string | null]> = [
      ["bpr-s1", "bpr-1-p0", 0, "pokemontcg", "fix-1"],
      ["bpr-s2", "bpr-1-p0", 1, "pokemontcg", "fix-unpriced"],
      ["bpr-s3", "bpr-1-p0", 2, null, null],
      ["bpr-s4", "bpr-1-p1", 0, "pokemontcg", "fix-2"],
      ["bpr-s5", "bpr-2-p0", 0, "pokemontcg", "fix-1"],
      ["bpr-s6", "bpr-2-p0", 1, "tcgdex", "td-1"],
    ];
    for (const [id, page, idx, source, ext] of slots) {
      await db.query(
        `INSERT INTO vault_tcg.binder_slot (id, page_id, slot_index, source, external_id, card_name) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, page, idx, source, ext, ext],
      );
    }
    await fn(db, runner);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!DSN)("binder-price-refresh against Postgres", () => {
  const prices = { "fix-1": guide(95), "fix-2": guide(12.5, "2026-11-20") };

  it("refreshes every page of every binder and records one price_snapshot per pocket per guide day", async () => {
    await inTransaction(async (db, runner) => {
      const g = fakeGuide(prices);
      const r = await runBinderPriceRefresh({ runner, fetchGuide: g, triggeredBy: "test", now: () => NOW });
      const mine = r.binders.filter((b) => b.binderId.startsWith("bpr-"));
      expect(mine.map((b) => b.binderId)).toEqual(["bpr-1", "bpr-2"]);
      const b1 = mine[0]!;
      // All pages, not just the button's first five / active page.
      expect(b1).toMatchObject({ pagesScanned: 2, slotsChecked: 3, updated: 2, unchanged: 1, skipped: 1, historyRowsNew: 2, newestObservedOn: "2026-11-21" });
      expect(mine[1]).toMatchObject({ slotsChecked: 1, updated: 1, skipped: 1, historyRowsNew: 1 });
      // fix-1 sits in both binders and is asked for once.
      expect(g.calls.flat().filter((id) => id === "fix-1")).toHaveLength(1);

      const slot = (await db.query(`SELECT * FROM vault_tcg.binder_slot WHERE id = 'bpr-s1'`)).rows[0];
      expect(slot.price_market).toBe(95);
      expect(Number(slot.price_updated_at)).toBe(Date.parse("2026-11-21T00:00:00Z"));
      expect(slot).toMatchObject({ provenance_method: "api", verification_status: "unverified", confidence: 0.6, provenance_model_version: "pricecharting-pokemon-cards@0.1.0" });
      expect(slot.provenance_source).toContain("NM assumed · unverified");
      const unpriced = (await db.query(`SELECT price_market FROM vault_tcg.binder_slot WHERE id = 'bpr-s2'`)).rows[0];
      expect(unpriced.price_market).toBeNull();

      const snaps = (await db.query(`SELECT slot_id, price_market, observed_at, source FROM vault_tcg.price_snapshot WHERE slot_id LIKE 'bpr-%' ORDER BY slot_id`)).rows;
      expect(snaps.map((s) => [s.slot_id, s.price_market, s.source])).toEqual([
        ["bpr-s1", 95, "pricecharting"],
        ["bpr-s4", 12.5, "pricecharting"],
        ["bpr-s5", 95, "pricecharting"],
      ]);
      const stamp = (await db.query(`SELECT updated_at FROM vault_tcg.binder WHERE id = 'bpr-1'`)).rows[0];
      expect(Number(stamp.updated_at)).toBe(NOW);

      // Same guide day again: no duplicate history.
      const again = await runBinderPriceRefresh({ runner, fetchGuide: fakeGuide(prices), binderId: "bpr-1", now: () => NOW });
      expect(again.totals).toMatchObject({ updated: 2, historyRowsNew: 0, historyRowsUpdated: 2 });
      // A new guide day: one new row per priced pocket.
      const next = await runBinderPriceRefresh({ runner, fetchGuide: fakeGuide({ "fix-1": guide(99, "2026-11-22") }), binderId: "bpr-1", now: () => NOW });
      expect(next.totals).toMatchObject({ updated: 1, historyRowsNew: 1 });
      const count = (await db.query(`SELECT count(*)::int AS n FROM vault_tcg.price_snapshot WHERE slot_id = 'bpr-s1'`)).rows[0];
      expect(count.n).toBe(2);
    });
  });

  it("dry run writes nothing; a missing binder is reported; an empty guide says so", async () => {
    await inTransaction(async (db, runner) => {
      const dry = await runBinderPriceRefresh({ runner, fetchGuide: fakeGuide(prices), binderId: "bpr-1", dryRun: true, now: () => NOW });
      expect(dry.totals).toMatchObject({ updated: 2, historyRowsNew: 2 });
      expect(dry.notes.join(" ")).toMatch(/dry run/);
      const slot = (await db.query(`SELECT price_market FROM vault_tcg.binder_slot WHERE id = 'bpr-s1'`)).rows[0];
      expect(slot.price_market).toBeNull();
      const snaps = (await db.query(`SELECT count(*)::int AS n FROM vault_tcg.price_snapshot WHERE slot_id LIKE 'bpr-%'`)).rows[0];
      expect(snaps.n).toBe(0);
      const stamp = (await db.query(`SELECT updated_at FROM vault_tcg.binder WHERE id = 'bpr-1'`)).rows[0];
      expect(Number(stamp.updated_at)).toBe(0);

      const missing = await runBinderPriceRefresh({ runner, fetchGuide: fakeGuide(prices), binderId: "no-such-binder" });
      expect(missing.bindersMissing).toEqual(["no-such-binder"]);

      const down = await runBinderPriceRefresh({ runner, fetchGuide: fakeGuide({}), binderId: "bpr-1" });
      expect(down.totals).toMatchObject({ updated: 0, unchanged: 3 });
      expect(formatBinderPriceRefreshReport(down)).toMatch(/guide returned no prices/);
    });
  });

  it("the button's page scope (Sync Prices route): one page, first N pages, unknown page, rarity top-up", async () => {
    await inTransaction(async (db, runner) => {
      const one = await syncBinderGuidePrices({ runner, binderId: "bpr-1", pageId: "bpr-1-p1", fetchGuide: fakeGuide(prices) });
      expect(one).toMatchObject({ pagesScanned: 1, slotsChecked: 1, updated: 1 });
      const first = await syncBinderGuidePrices({
        runner,
        binderId: "bpr-1",
        firstPages: 1,
        fetchGuide: fakeGuide(prices),
        loadRarity: async () => (id) => (id === "fix-unpriced" ? "Rare Holo" : null),
      });
      expect(first).toMatchObject({ pagesScanned: 1, slotsChecked: 2, updated: 1, unchanged: 1, skipped: 1 });
      const rarity = (await db.query(`SELECT rarity FROM vault_tcg.binder_slot WHERE id = 'bpr-s2'`)).rows[0];
      expect(rarity.rarity).toBe("Rare Holo");
      expect(await syncBinderGuidePrices({ runner, binderId: "bpr-1", pageId: "bpr-2-p0", fetchGuide: fakeGuide(prices) })).toBeNull();
      expect(await syncBinderGuidePrices({ runner, binderId: "nope", fetchGuide: fakeGuide(prices) })).toBeNull();
    });
  });
});
