import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { normalizeDsn } from "../db/client.js";
import { asksFromBrowse, checkHuntOnEbay, loadHuntMarket, setHuntAlertStatus, type HuntBrowseFetch } from "./huntMarket.js";
import { listDefinedHunts, loadHuntDefinition } from "./huntStore.js";

const MIDNIGHT = JSON.parse(
  readFileSync(new URL("../../../../data/hunts/marvel-midnight-universe.json", import.meta.url), "utf8"),
);
const DSN = process.env.IQVAULT_TEST_DSN;

const GAMBIT_J = {
  series: "Midnight X-Men",
  issue: "1",
  coverLetter: "J",
  variantName: "Ito Gambit Virgin",
  artist: "Ito",
  ratio: "1:100",
};

/** A Browse reply: one exact ask inside HIGH_PRIORITY, one graded, one lot, one other cover, one EUR. */
function browseReply(): string {
  return JSON.stringify({
    itemSummaries: [
      { itemId: "v1|1|0", title: "Midnight X-Men #1 Ito Gambit 1:100 Virgin Variant NM", price: { value: "75.00", currency: "USD" }, itemWebUrl: "https://www.ebay.com/itm/1" },
      { itemId: "v1|2|0", title: "Midnight X-Men #1 Ito 1:100 Virgin CGC 9.8", price: { value: "60.00", currency: "USD" } },
      { itemId: "v1|3|0", title: "Midnight X-Men #1 Ito Virgin lot of 2", price: { value: "50.00", currency: "USD" } },
      { itemId: "v1|4|0", title: "Midnight X-Men #1 Cover A", price: { value: "5.00", currency: "USD" } },
      { itemId: "v1|5|0", title: "Midnight X-Men #1 Ito 1:100 Virgin", price: { value: "70.00", currency: "EUR" } },
    ],
  });
}

describe("hunt eBay asks", () => {
  it("reads asks from a Browse reply, marking graded, lots and other covers, and dropping non-USD", () => {
    const asks = asksFromBrowse(browseReply(), GAMBIT_J);
    expect(asks.map((a) => [a.listingId, a.titleMatch, a.conditionKey, a.isLot])).toEqual([
      ["v1|1|0", "strong", "any", false],
      ["v1|2|0", "strong", "graded", false],
      ["v1|3|0", "strong", "any", true],
      ["v1|4|0", "weak", "any", false],
    ]);
    expect(asksFromBrowse("not json", GAMBIT_J)).toEqual([]);
  });
});

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: normalizeDsn(DSN!) });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!DSN)("Check eBay now (IQVAULT_TEST_DSN, rolled back, no network)", () => {
  it("stores asks as observations, alerts once per listing, and never re-alerts on a re-check", async () => {
    await inTransaction(async (db) => {
      const def = structuredClone(MIDNIGHT);
      def.slug = "test-midnight-market";
      await loadHuntDefinition(db, def, { file: "data/hunts/marvel-midnight-universe.json" });
      const queries: string[] = [];
      const fakeBrowse: HuntBrowseFetch = async (q) => {
        queries.push(q);
        return { ok: true, rawJson: q.includes("cover J") ? browseReply() : JSON.stringify({ itemSummaries: [] }) };
      };
      let t = Date.parse("2026-10-10T12:00:00Z");
      const now = () => new Date((t += 1000));

      const first = await checkHuntOnEbay(db, "test-midnight-market", { fetch: fakeBrowse, now, delayMs: 0 });
      expect(first).toMatchObject({ checked: 20, newAlerts: 1, stoppedReason: null });
      expect(queries).toContain("Midnight X-Men #1 cover J");

      const second = await checkHuntOnEbay(db, "test-midnight-market", { fetch: fakeBrowse, now, delayMs: 0 });
      expect(second!.newAlerts).toBe(0);

      // Similar alerts are minimized: a pricier listing in the same band does not alert; a cheaper one does.
      const another = (price: string, id: string): HuntBrowseFetch => async (q) => ({
        ok: true,
        rawJson: q.includes("cover J")
          ? JSON.stringify({ itemSummaries: [{ itemId: id, title: "Midnight X-Men #1 Cover J Ito 1:100 Virgin", price: { value: price, currency: "USD" } }] })
          : JSON.stringify({ itemSummaries: [] }),
      });
      expect((await checkHuntOnEbay(db, "test-midnight-market", { fetch: another("78.00", "v1|9|0"), now, delayMs: 0 }))!.newAlerts).toBe(0);
      expect((await checkHuntOnEbay(db, "test-midnight-market", { fetch: another("72.00", "v1|8|0"), now, delayMs: 0 }))!.newAlerts).toBe(1);

      const [hunt] = await listDefinedHunts(db, "test-midnight-market");
      const items = hunt!.sections.flatMap((s) => s.items);
      const gambit = items.find((i) => i.key === "mxm-1-j")!;
      const market = await loadHuntMarket(db, items.map((i) => i.id));
      expect(market.get(gambit.id)).toMatchObject({
        strongCount: 1,
        listingCount: 1,
        lowStrongAsk: 72,
        alerts: [{ band: "HIGH_PRIORITY", askPrice: 72, status: "new", similarCount: 1 }],
      });
      // An item with no listings still records that the check ran.
      const coverA = items.find((i) => i.key === "msm-1-a")!;
      expect(market.get(coverA.id)).toMatchObject({ listingCount: 0, lowStrongAsk: null });
      expect(market.get(coverA.id)!.checkedAt).not.toBeNull();

      const alertId = market.get(gambit.id)!.alerts[0]!.id;
      expect(await setHuntAlertStatus(db, "test-midnight-market", alertId, "dismissed")).toBe(true);
      expect((await loadHuntMarket(db, [gambit.id])).get(gambit.id)!.alerts).toEqual([]);
    });
  });

  it("stops at a fatal eBay answer instead of hammering the API", async () => {
    await inTransaction(async (db) => {
      const def = structuredClone(MIDNIGHT);
      def.slug = "test-midnight-market-stop";
      await loadHuntDefinition(db, def, { file: "data/hunts/marvel-midnight-universe.json" });
      let calls = 0;
      const denied: HuntBrowseFetch = async () => {
        calls += 1;
        return { ok: false, error: "eBay HTTP 429", fatal: true };
      };
      const result = await checkHuntOnEbay(db, "test-midnight-market-stop", { fetch: denied, delayMs: 0 });
      expect(result).toMatchObject({ checked: 0, stoppedReason: "eBay HTTP 429" });
      expect(calls).toBe(1);
    });
  });
});
