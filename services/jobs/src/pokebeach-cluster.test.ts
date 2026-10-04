import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { clusterPokebeachItems } from "./pokebeach-cluster.js";
import { upsertArticle } from "./pokebeach.js";
import { extractSourceItemEntities } from "./pokemon-entities.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-06T12:00:00.000Z");
const HASH = (n: number) => n.toString(16).padStart(64, "0");

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Real items drop out of the pending set; only this test's items are clustered.
    await db.query(`UPDATE vault_signals.source_item SET content_hash = NULL WHERE source_id = 'pokebeach_official'`);
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

async function rawDocument(db: PoolClient, sourceId: string, n: number, storageKey: string | null = null): Promise<string> {
  const run = await db.query(`INSERT INTO vault_signals.ingest_run (source_id, status) VALUES ($1, 'succeeded') RETURNING id`, [sourceId]);
  const doc = await db.query(
    `INSERT INTO vault_signals.raw_document (source_id, fetched_at, source_url, content_hash, raw_payload_ref, extraction_status, ingest_run_id)
     VALUES ($1, $2, 'https://www.pokebeach.com/', $3, 'local_fs:test', 'indexed', $4) RETURNING id`,
    [sourceId, NOW, HASH(n), run.rows[0].id],
  );
  if (storageKey) {
    await db.query(
      `INSERT INTO vault_signals.document_snapshot (raw_document_id, storage_backend, storage_key, byte_size, media_type)
       VALUES ($1, 'local_fs', $2, 1, 'application/rss+xml')`,
      [doc.rows[0].id, storageKey],
    );
  }
  return doc.rows[0].id;
}

const put = (db: PoolClient, rawDocumentId: string, postId: string, title: string, publishedAt: string) =>
  upsertArticle(
    db,
    {
      postId,
      canonicalUrl: `https://www.pokebeach.com/2026/10/fixture-${postId}`,
      title,
      author: `Writer ${postId}`,
      authorSlug: `writer-${postId}`,
      publishedAt,
      modifiedAt: null,
      description: null,
    },
    { via: "homepage", rawDocumentId, now: NOW, status: "discovered", timeSource: "test" },
  );

describe.skipIf(!DSN)("PokéBeach clustering onto spine events (IQVAULT_TEST_DSN, rolled back)", () => {
  it("first event wins, outlet is one source, category refs never cluster, threads are discussion", async () => {
    await inTransaction(async (db) => {
      await db.query(`INSERT INTO vault_pokemon.set (name, language) VALUES ('Fixture Sparks', 'english') ON CONFLICT DO NOTHING`);
      const home = await rawDocument(db, "pokebeach_official", 0xc1a0);
      const later = await rawDocument(db, "pokebeach_official", 0xc1a1);
      await put(db, home, "980001", "Fixture Sparks Release Date Revealed", "2026-10-01T18:00:00.000Z");
      // Same homepage fetch, same set and type, another staff writer: joins, still one source.
      await put(db, home, "980002", "Fixture Sparks Release Date Announced for Europe", "2026-10-02T18:00:00.000Z");
      // Outside 72 hours of the first item.
      await put(db, later, "980003", "Fixture Sparks Release Date Set for Japan", "2026-10-05T19:00:00.000Z");
      // Same set, different type.
      await put(db, later, "980004", "Fixture Sparks Preorders Now Live", "2026-10-02T19:00:00.000Z");
      // Only a species (a category): never clusters.
      await put(db, later, "980005", "Pikachu Release Date Revealed", "2026-10-02T20:00:00.000Z");
      await put(db, later, "980006", "Pikachu Promo Release Date Revealed", "2026-10-02T21:00:00.000Z");
      await put(db, later, "980007", "Fixture Sparks Booster Box Review", "2026-10-02T22:00:00.000Z");
      await extractSourceItemEntities(db);

      const forumKey = "jobs/.state/snapshots/pokebeach_rss/feed/pokebeach_rss-fixture.xml";
      const stateDir = mkdtempSync(join(tmpdir(), "pokebeach-cluster-"));
      mkdirSync(join(stateDir, "snapshots", "pokebeach_rss", "feed"), { recursive: true });
      writeFileSync(
        join(stateDir, "snapshots", "pokebeach_rss", "feed", "pokebeach_rss-fixture.xml"),
        `<rss><channel><item><title>Fixture Sparks Release Date Revealed</title><link>https://www.pokebeach.com/forums/threads/fixture-sparks.990001/</link></item></channel></rss>`,
      );
      const forumDoc = await rawDocument(db, "pokebeach_rss", 0xf0a0, forumKey);
      await db.query(
        `UPDATE vault_signals.source_item SET discussion_url = 'https://www.pokebeach.com/forums/threads/fixture-sparks.990001/'
          WHERE source_id = 'pokebeach_official' AND external_id = '980001'`,
      );

      const first = await clusterPokebeachItems(db, { stateDir, now: NOW });
      expect(first.items).toEqual({ read: 7, noise: 1, noSignal: 0, noRawDocument: 0, eventsCreated: 5, joined: 1 });
      expect(first.discussionLinked).toBe(1);

      const events = await db.query(
        `SELECT e.event_key, e.event_type, vault_signals.independent_source_count(e.id) AS sources,
                (SELECT count(*)::int FROM vault_signals.signal s WHERE s.event_id = e.id) AS signals,
                (SELECT array_agg(i.external_id || ':' || ee.role ORDER BY i.external_id, ee.role)
                   FROM vault_signals.event_evidence ee JOIN vault_signals.source_item i ON i.id = ee.source_item_id
                  WHERE ee.event_id = e.id) AS members
           FROM vault_signals.event e
          WHERE e.event_key LIKE 'pokebeach_official:98000%'
          ORDER BY e.event_key`,
      );
      expect(events.rows).toEqual([
        { event_key: "pokebeach_official:980001", event_type: "SET_RELEASE", sources: 1, signals: 1, members: ["980001:DISCUSSION", "980001:PRIMARY", "980002:PRIMARY"] },
        { event_key: "pokebeach_official:980003", event_type: "SET_RELEASE", sources: 1, signals: 1, members: ["980003:PRIMARY"] },
        { event_key: "pokebeach_official:980004", event_type: "RESTOCK", sources: 1, signals: 1, members: ["980004:PRIMARY"] },
        { event_key: "pokebeach_official:980005", event_type: "SET_RELEASE", sources: 1, signals: 1, members: ["980005:PRIMARY"] },
        { event_key: "pokebeach_official:980006", event_type: "SET_RELEASE", sources: 1, signals: 1, members: ["980006:PRIMARY"] },
      ]);
      const shared = await db.query(
        `SELECT DISTINCT ee.raw_document_id FROM vault_signals.event_evidence ee
           JOIN vault_signals.event e ON e.id = ee.event_id
          WHERE e.event_key = 'pokebeach_official:980001' AND ee.role = 'PRIMARY'`,
      );
      expect(shared.rows).toEqual([{ raw_document_id: home }]);
      const discussion = await db.query(`SELECT independence_group, raw_document_id FROM vault_signals.event_evidence WHERE role = 'DISCUSSION' AND raw_document_id = $1`, [forumDoc]);
      expect(discussion.rows).toEqual([{ independence_group: null, raw_document_id: forumDoc }]);
      const signal = await db.query(
        `SELECT s.domain, s.prov_source, s.prov_method, s.prov_verification, s.prov_rule_version, s.base_confidence::float AS conf
           FROM vault_signals.signal s JOIN vault_signals.event e ON e.id = s.event_id WHERE e.event_key = 'pokebeach_official:980001'`,
      );
      expect(signal.rows[0]).toMatchObject({
        domain: "collectibles",
        prov_source: "pokebeach_official",
        prov_method: "inferred",
        prov_verification: "unverified",
        prov_rule_version: "collectibles-headline@0.1.0+rules+item-clusters@0.1.0",
      });

      // Nothing is re-clustered or moved; only the noise item is read again.
      const again = await clusterPokebeachItems(db, { stateDir, now: NOW });
      expect(again.items).toMatchObject({ read: 1, noise: 1, eventsCreated: 0, joined: 0 });
      expect(again.discussionLinked).toBe(0);

      // An item can be PRIMARY evidence for one event only.
      await expect(
        db.query(
          `INSERT INTO vault_signals.event_evidence (event_id, raw_document_id, role, independence_group, source_item_id)
           SELECT (SELECT id FROM vault_signals.event WHERE event_key = 'pokebeach_official:980003'), $1, 'PRIMARY', 'pokebeach_official', i.id
             FROM vault_signals.source_item i WHERE i.source_id = 'pokebeach_official' AND i.external_id = '980002'`,
          [home],
        ),
      ).rejects.toThrow(/event_evidence_item_primary_once/);
    });
  });
});
