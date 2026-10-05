import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { REGISTRY_MISSING, confirmMatch, hasPriceChartingRegistry, listReview, runPokemonPrices, type Lookup } from "./pokemon-prices.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-05T12:00:00.000Z");

const product = (id: string, productName: string, consoleName: string, loose: number, psa10: number) => ({
  id,
  productName,
  consoleName,
  releaseDate: null,
  salesVolume: null,
  prices: { ungraded: loose, grade7: null, grade8: null, grade9: null, grade95: null, psa10, bgs10: null, cgc10: null, sgc10: null },
  host: "https://www.pricecharting.com" as const,
  rawKeysPresent: ["loose-price"],
  provenance: { source: "pricecharting", ruleOrModelVersion: "t", confidence: 0.7, verificationStatus: "unverified" } as never,
});

function fakePriceCharting(): Lookup & { calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = (async (q: { q?: string; id?: string }) => {
    calls.push(q);
    if (q.id === "900001") return { ok: true, product: product("900001", "Fixtureon ex #12", "Pokemon Fixture Rise", 18, 110), rawJson: '{"id":"900001"}' };
    if (q.q?.startsWith("Fixtureon ex")) {
      const p = product("900001", "Fixtureon ex #12", "Pokemon Fixture Rise", 17, 107);
      return { ok: true, product: p, products: [p], rawJson: '{"products":[1]}' };
    }
    if (q.q?.startsWith("Testmon")) {
      const p = product("900002", "Testmon [Reverse Holo] #7", "Pokemon Fixture Rise", 3, 40);
      return { ok: true, product: p, products: [p], rawJson: '{"products":[2]}' };
    }
    return { ok: false, emptyReason: "PriceCharting search matched zero parseable products" };
  }) as Lookup & { calls: unknown[] };
  fn.calls = calls;
  return fn;
}

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Only this test's fixture slots count as owned/wishlisted inside the rolled-back transaction.
    await db.query(`UPDATE vault_tcg.binder_slot SET owned = false, on_wishlist = false`);
    await db.query(`INSERT INTO vault_tcg.binder (id, name, created_at, updated_at) VALUES ('px-test', 'PriceCharting test', 0, 0)`);
    await db.query(`INSERT INTO vault_tcg.binder_page (id, binder_id, page_index, created_at) VALUES ('px-test-p1', 'px-test', 0, 0)`);
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

let slotIndex = 0;
async function slot(db: PoolClient, externalId: string, name: string, set: string, number: string) {
  slotIndex += 1;
  await db.query(
    `INSERT INTO vault_tcg.binder_slot (id, page_id, slot_index, source, external_id, card_name, set_name, number, owned)
     VALUES ($1, 'px-test-p1', $2, 'pokemontcg', $3, $4, $5, $6, true)`,
    [`px-test-s${slotIndex}`, slotIndex, externalId, name, set, number],
  );
}

describe("pokemon-prices without a token", () => {
  it("is blocked and invents nothing", async () => {
    const r = await runPokemonPrices({ query: async () => ({ rows: [] }) }, { token: null });
    expect(r).toMatchObject({ status: "blocked", requests: 0, rowsWritten: 0 });
  });
});

describe.skipIf(!DSN)("pokemon-prices (IQVAULT_TEST_DSN, rolled back)", () => {
  it("maps exact matches, prices them per condition, re-runs idempotently, and holds doubtful matches for review", async () => {
    await inTransaction(async (db) => {
      if (!(await hasPriceChartingRegistry(db))) {
        expect(await runPokemonPrices(db, { lookup: fakePriceCharting() })).toMatchObject({ status: "blocked", reason: REGISTRY_MISSING });
        return;
      }
      await slot(db, "fx1-12", "Fixtureon ex", "Fixture Rise", "12");
      await slot(db, "fx1-7", "Testmon", "Fixture Rise", "7");
      await slot(db, "fx1-99", "Nothingmon", "Fixture Rise", "99");
      const pc = fakePriceCharting();

      const first = await runPokemonPrices(db, { now: NOW, lookup: pc, minGapMs: 0 });
      expect(first).toMatchObject({ cards: 3, matchedNow: 1, needsReview: 1, unmatched: 1, priced: 1, rowsWritten: 2 });
      const rows = await db.query(
        `SELECT condition, condition_assumed, market_price::float AS price, prov_confidence::float AS conf
           FROM vault_market.card_price_history WHERE external_id = 'fx1-12' ORDER BY condition`,
      );
      expect(rows.rows).toEqual([
        { condition: "NM", condition_assumed: true, price: 17, conf: 0.7 },
        { condition: "PSA_10", condition_assumed: false, price: 107, conf: 0.7 },
      ]);

      const again = await runPokemonPrices(db, { now: NOW, lookup: pc, minGapMs: 0 });
      expect(again).toMatchObject({ matchedNow: 0, priced: 1, rowsWritten: 2 });
      const count = await db.query(`SELECT count(*)::int AS n, max(market_price)::float AS nm FROM vault_market.card_price_history WHERE external_id = 'fx1-12' AND condition = 'NM'`);
      expect(count.rows[0]).toEqual({ n: 1, nm: 18 });

      expect((await listReview(db)).map((r) => [r.externalId, r.productId])).toEqual([["fx1-7", "900002"]]);
      expect(await confirmMatch(db, "fx1-7")).toBe(true);
      const snaps = await db.query(`SELECT count(*)::int AS n FROM vault_evidence.raw_snapshots WHERE source = 'pricecharting' AND payload IN ('{"products":[1]}', '{"products":[2]}', '{"id":"900001"}')`);
      expect(snaps.rows[0].n).toBe(3);
    });
  });
});
