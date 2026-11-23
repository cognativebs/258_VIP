import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { normalizeDsn } from "../db/client.js";
import {
  latestSellQueueDecisions,
  recordSellQueueDecision,
  sellQueueDecisionHistory,
} from "./sellQueueDecisions.js";

const DSN = process.env.IQVAULT_TEST_DSN;

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

const advice = { action: "Sell" as const, confidence: 0.6, ruleOrModelVersion: "vip-sell-queue-dogfood@0.2.0+test" };

describe.skipIf(!DSN)("sell-queue decision log (Q16; IQVAULT_TEST_DSN, rolled back)", () => {
  it("appends marks, newest wins, and history keeps every mark", async () => {
    await inTransaction(async (db) => {
      const ref = "zz-sellq-test-ref";
      const a = await recordSellQueueDecision(db, { holdingId: ref, decision: "accepted", ...advice });
      expect(a.decision).toBe("accepted");
      expect(a.holdingUuid).toBeNull();
      await db.query(`UPDATE vault_collection.sell_queue_decision SET decided_at = now() - interval '1 hour' WHERE id = $1`, [a.id])
        .then(
          () => {
            throw new Error("update should be refused");
          },
          (e: Error) => expect(e.message).toMatch(/append-only/),
        );
    });
  });

  it("records a rejection with its reason and resolves a CLZ holding ref", async () => {
    await inTransaction(async (db) => {
      const asset = await db.query(
        `INSERT INTO vault_core.asset (category_id, canonical_name)
         VALUES ((SELECT id FROM vault_core.categories WHERE kind = 'comic'), 'sellq test (rolled back)') RETURNING id`,
      );
      const holding = await db.query(
        `INSERT INTO vault_collection.holding (asset_id, source, source_row_id)
         VALUES ($1, 'clz_import', 'zz-sellq-clz-1') RETURNING id::text AS id`,
        [asset.rows[0].id],
      );
      await recordSellQueueDecision(db, { holdingId: "zz-sellq-clz-1", decision: "accepted", ...advice });
      const r = await recordSellQueueDecision(db, {
        holdingId: "zz-sellq-clz-1",
        decision: "rejected",
        reason: "  keeping it  ",
        ...advice,
      });
      expect(r.holdingUuid).toBe(holding.rows[0].id);
      expect(r.reason).toBe("keeping it");
      const latest = await latestSellQueueDecisions(db, ["zz-sellq-clz-1", "zz-none"]);
      expect(latest.get("zz-sellq-clz-1")?.decision).toBe("rejected");
      expect(latest.has("zz-none")).toBe(false);
      const history = await sellQueueDecisionHistory(db, "zz-sellq-clz-1");
      expect(history.map((h) => h.decision)).toEqual(["rejected", "accepted"]);
    });
  });

  it("refuses a bad body before touching the table", async () => {
    await inTransaction(async (db) => {
      await expect(recordSellQueueDecision(db, { holdingId: "x", decision: "maybe", ...advice })).rejects.toThrow();
      await expect(
        recordSellQueueDecision(db, { holdingId: "x", decision: "accepted", ...advice, confidence: 1.5 }),
      ).rejects.toThrow();
    });
  });
});
