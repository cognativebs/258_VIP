import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { normalizeDsn } from "../db/client.js";
import {
  huntMetrics,
  listDefinedHunts,
  loadHuntDefinition,
  updateHuntItem,
  updateHuntSet,
} from "./huntStore.js";

const MIDNIGHT = JSON.parse(
  readFileSync(new URL("../../../../data/hunts/marvel-midnight-universe.json", import.meta.url), "utf8"),
);
const FILE = "data/hunts/marvel-midnight-universe.json";
const DSN = process.env.IQVAULT_TEST_DSN;

describe("huntMetrics", () => {
  it("leaves PASS out of the total and counts the lifecycle as wanted", () => {
    const m = huntMetrics([
      { status: "owned" },
      { status: "ordered" },
      { status: "target" },
      { status: "watching" },
      { status: "pass" },
      { status: "missing" },
    ]);
    expect(m).toMatchObject({ owned: 1, wanted: 3, missing: 1, passed: 1, total: 5, completionPct: 20 });
  });
});

/** Rolled back: nothing reaches the database. Uses a fresh slug so a loaded real hunt is untouched. */
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

function testDefinition() {
  const def = structuredClone(MIDNIGHT);
  def.slug = "test-midnight-hunt";
  return def;
}

describe.skipIf(!DSN)("vault_hunt definitions (IQVAULT_TEST_DSN, rolled back)", () => {
  it("loads 20 targets and 4 sets, and a reload creates nothing new", async () => {
    await inTransaction(async (db) => {
      const first = await loadHuntDefinition(db, testDefinition(), { file: FILE });
      expect(first).toMatchObject({ huntCreated: true, itemsInserted: 20, itemsUpdated: 0, setsUpserted: 4, setMembers: 12 });
      const second = await loadHuntDefinition(db, testDefinition(), { file: FILE });
      expect(second).toMatchObject({ huntCreated: false, itemsInserted: 0, itemsUpdated: 20, notInDefinition: [] });
      const [hunt] = await listDefinedHunts(db, "test-midnight-hunt");
      expect(hunt!.sections.map((s) => [s.name, s.items.length])).toEqual([
        ["Core", 12],
        ["Art Picks", 3],
        ["Incentive Hunts", 5],
      ]);
      expect(hunt!.metrics).toMatchObject({ owned: 0, wanted: 20, total: 20 });
      expect(hunt!.rules).toMatchObject({ rankingFactors: expect.arrayContaining(["Price opportunity"]) });
    });
  });

  it("never overwrites collector state or a revised target on reload", async () => {
    await inTransaction(async (db) => {
      await loadHuntDefinition(db, testDefinition(), { file: FILE });
      let [hunt] = await listDefinedHunts(db, "test-midnight-hunt");
      const items = hunt!.sections.flatMap((s) => s.items);
      const crainSpidey = items.find((i) => i.key === "msm-1-f")!;
      const gambitJ = items.find((i) => i.key === "mxm-1-j")!;

      expect(await updateHuntItem(db, "test-midnight-hunt", crainSpidey.id, { status: "owned", paid: 7.5 })).toBe(true);
      // Simulate a later sold-comps revision of the J target.
      await db.query(
        `UPDATE vault_hunt.hunt_item
            SET buy_under = 90,
                metadata = metadata || '{"target": {"price": 90, "source": "sold_comps_revision"}}'::jsonb
          WHERE id = $1`,
        [gambitJ.id],
      );
      const crain = hunt!.sets.find((s) => s.slug === "crain-connecting")!;
      expect(await updateHuntSet(db, "test-midnight-hunt", crain.id, { status: "buy" })).toBe(true);

      await loadHuntDefinition(db, testDefinition(), { file: FILE });
      [hunt] = await listDefinedHunts(db, "test-midnight-hunt");
      const after = hunt!.sections.flatMap((s) => s.items);
      expect(after.find((i) => i.key === "msm-1-f")).toMatchObject({ status: "owned", paid: 7.5, ownedQuantity: 1 });
      expect(after.find((i) => i.key === "mxm-1-j")).toMatchObject({
        buyUnder: 90,
        target: { price: 90, source: "sold_comps_revision" },
      });
      expect(after.find((i) => i.key === "mff-1-g")?.buyUnder).toBe(40);

      const crainAfter = hunt!.sets.find((s) => s.slug === "crain-connecting")!;
      expect(crainAfter.status).toBe("buy");
      expect(crainAfter.progress).toMatchObject({ owned: 1, total: 3, totalPaid: 7.5 });
      expect(crainAfter.progress.missing).toHaveLength(2);
      expect(crainAfter.members.map((m) => m.position)).toEqual([0, 1, 2]);
    });
  });

  it("enforces the widened status CHECK and scopes updates to the hunt", async () => {
    await inTransaction(async (db) => {
      await loadHuntDefinition(db, testDefinition(), { file: FILE });
      const [hunt] = await listDefinedHunts(db, "test-midnight-hunt");
      const item = hunt!.sections[0]!.items[0]!;
      expect(await updateHuntItem(db, "test-midnight-hunt", item.id, { status: "pass" })).toBe(true);
      expect(await updateHuntItem(db, "some-other-hunt", item.id, { status: "owned" })).toBe(false);
      await db.query("SAVEPOINT bogus");
      await expect(
        db.query(`UPDATE vault_hunt.hunt_item SET status = 'preorder' WHERE id = $1`, [item.id]),
      ).rejects.toThrow(/hunt_item_status_check/);
      await db.query("ROLLBACK TO SAVEPOINT bogus");
      const [after] = await listDefinedHunts(db, "test-midnight-hunt");
      expect(after!.metrics).toMatchObject({ passed: 1, total: 19 });
    });
  });
});
