import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { joinOutletItems } from "./cross-source-join.js";
import { clusterPokebeachItems } from "./pokebeach-cluster.js";
import { upsertArticle } from "./pokebeach.js";
import { extractSourceItemEntities } from "./pokemon-entities.js";
import { upsertSourceItem } from "./source-items.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-06T12:00:00.000Z");
const HASH = (n: number) => n.toString(16).padStart(64, "0");

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Only this test's items are pending.
    await db.query(`UPDATE vault_signals.source_item SET content_hash = NULL`);
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

async function rawDocument(db: PoolClient, sourceId: string, n: number): Promise<string> {
  const run = await db.query(`INSERT INTO vault_signals.ingest_run (source_id, status) VALUES ($1, 'succeeded') RETURNING id`, [sourceId]);
  const doc = await db.query(
    `INSERT INTO vault_signals.raw_document (source_id, fetched_at, source_url, content_hash, raw_payload_ref, extraction_status, ingest_run_id)
     VALUES ($1, $2, 'https://example.test/', $3, 'local_fs:test', 'indexed', $4) RETURNING id`,
    [sourceId, NOW, HASH(n), run.rows[0].id],
  );
  return doc.rows[0].id;
}

describe.skipIf(!DSN)("cross-source join (IQVAULT_TEST_DSN, rolled back)", () => {
  it("an outlet headline on the same set joins the PokéBeach event as a second source, and never starts one", async () => {
    await inTransaction(async (db) => {
      const pb = await rawDocument(db, "pokebeach_official", 0xd100);
      await upsertArticle(
        db,
        {
          postId: "990001",
          canonicalUrl: "https://www.pokebeach.com/2026/10/fixture-990001",
          title: "“Fixture Reign” Preorders Now Live",
          author: "Writer",
          authorSlug: "writer",
          publishedAt: "2026-10-05T18:00:00.000Z",
          modifiedAt: null,
          description: null,
        },
        { via: "homepage", rawDocumentId: pb, now: NOW, status: "discovered", timeSource: "test" },
      );
      await extractSourceItemEntities(db);
      expect((await clusterPokebeachItems(db, { now: NOW })).items.eventsCreated).toBe(1);

      const cb = await rawDocument(db, "comicsbeat_rss", 0xd101);
      const item = (n: string, title: string, at: string) =>
        upsertSourceItem(
          db,
          "comicsbeat_rss",
          { externalId: n, canonicalUrl: `https://comicsbeat.example/${n}`, title, author: null, authorSlug: null, publishedAt: at, modifiedAt: null, description: null },
          { via: "rss", rawDocumentId: cb, now: NOW, timeSource: "test", status: "confirmed", parserVersion: "test" },
        );
      await item("cb-1", "Fixture Reign preorders now live at retailers", "2026-10-06T09:00:00.000Z");
      // Same set, but a set no one has reported before: no event to join, so nothing is created.
      await item("cb-2", "“Fixture Storm” preorders now live", "2026-10-06T10:00:00.000Z");
      await extractSourceItemEntities(db);

      const report = await joinOutletItems(db, { now: NOW, sourceKeys: ["comicsbeat_rss"] });
      expect(report).toMatchObject({ joined: 1, noMatch: 1, bySource: { comicsbeat_rss: 1 } });

      const ev = await db.query(
        `SELECT e.event_key, vault_signals.independent_source_count(e.id) AS sources, count(ee.*)::int AS primaries
           FROM vault_signals.event e JOIN vault_signals.event_evidence ee ON ee.event_id = e.id AND ee.role = 'PRIMARY'
          WHERE e.event_key = 'pokebeach_official:990001' GROUP BY e.id`,
      );
      expect(ev.rows[0]).toMatchObject({ sources: 2, primaries: 2 });
      const events = await db.query(`SELECT count(*)::int AS n FROM vault_signals.event WHERE event_key LIKE 'comicsbeat%'`);
      expect(events.rows[0].n).toBe(0);
      // Re-running joins nothing twice.
      expect((await joinOutletItems(db, { now: NOW, sourceKeys: ["comicsbeat_rss"] })).joined).toBe(0);
    });
  });
});
