import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { upsertArticle } from "./pokebeach.js";
import { extractSourceItemEntities } from "./pokemon-entities.js";
import { upsertSourceItem } from "./source-items.js";
import { synthesizeSignals } from "./synthesis.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const AT = new Date("2026-10-04T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(AT.getTime() - h * 3600_000).toISOString();

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Real items stay out of this test's window.
    await db.query(`UPDATE vault_signals.source_item SET published_at = '2000-01-01', first_seen_at = '2000-01-01'`);
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

async function rawDocument(db: PoolClient, sourceKey: string, hash: string): Promise<string> {
  const run = await db.query(`INSERT INTO vault_signals.ingest_run (source_id, status) VALUES ($1, 'succeeded') RETURNING id`, [sourceKey]);
  const doc = await db.query(
    `INSERT INTO vault_signals.raw_document (source_id, fetched_at, source_url, content_hash, raw_payload_ref, extraction_status, ingest_run_id)
     VALUES ($1, $2, 'fixture://', $3, 'local_fs:test', 'indexed', $4) RETURNING id`,
    [sourceKey, AT, hash, run.rows[0].id],
  );
  return doc.rows[0].id;
}

const article = (postId: string, slug: string, title: string, h: number) => ({
  postId,
  canonicalUrl: `https://www.pokebeach.com/2026/10/${slug}`,
  title,
  author: "Fixture Writer",
  authorSlug: "fixture-writer",
  publishedAt: hoursAgo(h),
  modifiedAt: null,
  description: null,
});

describe.skipIf(!DSN)("signals synthesis (IQVAULT_TEST_DSN, rolled back)", () => {
  it("writes one signal per cluster or official fact, never duplicates, and re-scores as outlets corroborate", async () => {
    await inTransaction(async (db) => {
      const home = await rawDocument(db, "pokebeach_official", "a".repeat(64));
      const opts = { via: "homepage", rawDocumentId: home, now: AT, status: "discovered" as const, timeSource: "test" };
      await upsertArticle(db, article("880001", "fixture-rise-cards-1", "20+ “Fixture Rise” Card Images Revealed!", 20), opts);
      await upsertArticle(db, article("880002", "fixture-rise-cards-2", "More English Cards Revealed from “Fixture Rise”", 10), opts);
      await upsertArticle(db, article("880003", "fixture-rise-preorders", "“Fixture Rise” Preorders Now Live on Pokemon Center!", 5), opts);
      await upsertArticle(db, article("880004", "fixture-regionals", "Fixtureon is the Best Play for Regionals", 4), opts);
      await extractSourceItemEntities(db);

      const first = await synthesizeSignals(db, { at: AT });
      expect(first).toMatchObject({ candidates: 2, created: 2, evidenceAdded: 3 });
      expect(first.signals.map((s) => [s.kind, s.theme, s.items])).toEqual([
        ["cluster", "CARD_REVEAL", 2],
        ["solo", "PREORDER", 1],
      ]);
      // Two articles from one homepage snapshot are two evidence rows on one event.
      const ev = await db.query(
        `SELECT count(*)::int AS n, count(DISTINCT raw_document_id)::int AS docs FROM vault_signals.event_evidence ee
           JOIN vault_signals.event e ON e.id = ee.event_id WHERE e.event_type = 'CARD_REVEAL' AND e.prov_source = 'signals_synthesis'`,
      );
      expect(ev.rows[0]).toEqual({ n: 2, docs: 1 });

      const again = await synthesizeSignals(db, { at: AT });
      expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, evidenceAdded: 0 });

      const gdeltDoc = await rawDocument(db, "gdelt_doc_v2", "b".repeat(64));
      await upsertSourceItem(
        db,
        "gdelt_doc_v2",
        { externalId: null, canonicalUrl: "https://news.fixture.example/fixture-rise-preorders", title: "Fixture Rise preorders go live at major retailers", author: null, authorSlug: null, publishedAt: hoursAgo(3), modifiedAt: null, description: null },
        { via: "feed:business", rawDocumentId: gdeltDoc, now: AT, timeSource: "test", status: "discovered", parserVersion: "test" },
      );
      await extractSourceItemEntities(db);
      const corroborated = await synthesizeSignals(db, { at: AT });
      expect(corroborated).toMatchObject({ created: 0, updated: 1, evidenceAdded: 1 });

      const sig = await db.query(
        `SELECT s.noise_probability::float AS noise, vault_signals.independent_source_count(s.event_id) AS independent
           FROM vault_signals.signal s JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
          WHERE s.prov_source = 'signals_synthesis' AND t.code = 'PREORDER'`,
      );
      expect(sig.rows).toEqual([{ noise: 0.09, independent: 2 }]);
      const total = await db.query(`SELECT count(*)::int AS n FROM vault_signals.signal WHERE prov_source = 'signals_synthesis'`);
      expect(total.rows[0].n).toBe(2);
    });
  });

  it("a dry run plans without writing", async () => {
    await inTransaction(async (db) => {
      const home = await rawDocument(db, "pokebeach_official", "c".repeat(64));
      await upsertArticle(db, article("880010", "fixture-pull-rates", "“Fixture Rise” Pull Rates Revealed", 2), { via: "homepage", rawDocumentId: home, now: AT, status: "discovered", timeSource: "test" });
      await extractSourceItemEntities(db);
      const r = await synthesizeSignals(db, { at: AT, dryRun: true });
      expect(r.signals.map((s) => [s.action, s.theme])).toEqual([["planned", "PULL_RATE"]]);
      const n = await db.query(`SELECT count(*)::int AS n FROM vault_signals.signal WHERE prov_source = 'signals_synthesis'`);
      expect(n.rows[0].n).toBe(0);
    });
  });
});
