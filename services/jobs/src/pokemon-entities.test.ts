import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { upsertArticle } from "./pokebeach.js";
import { extractSourceItemEntities } from "./pokemon-entities.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-03T12:00:00.000Z");

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Leave real items out of the count; only this test's items are pending.
    await db.query(`UPDATE vault_signals.source_item SET content_hash = NULL WHERE source_id = 'pokebeach_official'`);
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

const article = (postId: string, slug: string, title: string) => ({
  postId,
  canonicalUrl: `https://www.pokebeach.com/2026/10/${slug}`,
  title,
  author: "Fixture Writer",
  authorSlug: "fixture-writer",
  publishedAt: "2026-10-02T18:00:00.000Z",
  modifiedAt: null,
  description: null,
});
const put = (db: PoolClient, a: ReturnType<typeof article>) =>
  upsertArticle(db, a, { via: "homepage", rawDocumentId: null, now: NOW, status: "discovered", timeSource: "test" });

describe.skipIf(!DSN)("source item entity extraction (IQVAULT_TEST_DSN, rolled back)", () => {
  it("extracts once per item version, learns quoted set names across the batch, and links Binder catalogs", async () => {
    await inTransaction(async (db) => {
      const binder = await db.query(`SELECT id FROM vault_tcg.binder_page LIMIT 1`);
      if (binder.rows[0]) {
        await db.query(
          `INSERT INTO vault_tcg.binder_slot (page_id, slot_index, card_name, set_name, source)
           VALUES ($1, 9999, 'Fixtureon ex', 'Fixture Sparks', 'test')`,
          [binder.rows[0].id],
        ).catch(() => undefined);
      }
      await put(db, article("990001", "fixture-rise-preorders", "“Fixture Rise” Preorders Now Live on Pokemon Center!"));
      await put(db, article("990002", "charizard-ex-revealed", "Charizard ex and More Cards Revealed from Fixture Rise"));
      await put(db, article("990003", "nothing-here", "Weekly Tournament Recap"));

      const first = await extractSourceItemEntities(db);
      expect(first).toMatchObject({ items: 3, learnedSets: ["Fixture Rise"] });
      const rows = await db.query(
        `SELECT i.external_id, e.entity_kind, e.normalized_key, e.entity_ref, e.match_method
           FROM vault_signals.source_item_entity e JOIN vault_signals.source_item i ON i.id = e.source_item_id
          WHERE i.external_id IN ('990001', '990002') ORDER BY 1, 2, 3`,
      );
      expect(rows.rows.map((r) => [r.external_id, r.entity_kind, r.normalized_key, r.entity_ref, r.match_method])).toEqual([
        ["990001", "set", "fixture-rise", null, "quoted_set_name"],
        ["990002", "card", "charizard-ex", null, "card_pattern"],
        ["990002", "pokemon", "charizard", "pokemon:dex:6", "species_catalog"],
        ["990002", "set", "fixture-rise", null, "learned_set_name"],
      ]);
      const empty = await db.query(
        `SELECT x.entity_count FROM vault_signals.source_item_extraction x
           JOIN vault_signals.source_item i ON i.id = x.source_item_id WHERE i.external_id = '990003'`,
      );
      expect(empty.rows).toEqual([{ entity_count: 0 }]);

      expect((await extractSourceItemEntities(db)).items).toBe(0);
      await put(db, article("990003", "nothing-here", "Pikachu Wins the Weekly Tournament"));
      const revised = await extractSourceItemEntities(db);
      expect(revised).toMatchObject({ items: 1, byKind: { pokemon: 1 } });
    });
  });
});
