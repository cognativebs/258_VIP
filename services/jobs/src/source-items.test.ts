import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { collectiblesFixtureSnapshots } from "./collectibles-news.js";
import { persistFeedSnapshots } from "./espn-sports.js";
import { GDELT_SOURCE_KEY, macroFixtureSnapshots } from "./macro-news.js";
import { extractSourceItemEntities } from "./pokemon-entities.js";
import { indexFeedItems, sourceItemContentHash } from "./source-items.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("source item content hash", () => {
  it("ignores spacing and case, and changes with the summary", () => {
    const base = { title: "A Title", author: null, publishedAt: "2026-09-30T14:00:00.000Z", description: "Summary" };
    expect(sourceItemContentHash({ ...base, title: " a  title " })).toBe(sourceItemContentHash(base));
    expect(sourceItemContentHash({ ...base, description: "New summary" })).not.toBe(sourceItemContentHash(base));
  });
});

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
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

describe.skipIf(!DSN)("indexing outlets as items (IQVAULT_TEST_DSN, rolled back)", () => {
  it("indexes RSS, Atom and the GDELT business lane once each, with labeled times", async () => {
    await inTransaction(async (db) => {
      for (const s of collectiblesFixtureSnapshots(NOW)) await persistFeedSnapshots(db, s.sourceKey, [s], { status: "succeeded" });
      for (const s of macroFixtureSnapshots(NOW)) await persistFeedSnapshots(db, GDELT_SOURCE_KEY, [s], { status: "succeeded" });

      const first = await indexFeedItems(db, { now: NOW });
      // ComicsBeat 3 + PSA 1 + Alpha 2 + GDELT business 3; the us/world lanes are not indexed.
      expect(first).toMatchObject({ documents: 4, created: 9, revised: 0 });
      const again = await indexFeedItems(db, { now: NOW });
      expect(again).toMatchObject({ created: 0, revised: 0, seen: 9 });

      const rows = await db.query(
        `SELECT source_id, canonical_url, published_at, published_at_source, status, excerpt
           FROM vault_signals.source_item WHERE source_id <> 'pokebeach_official' ORDER BY source_id, canonical_url`,
      );
      const byUrl = Object.fromEntries(rows.rows.map((r) => [r.canonical_url, r]));
      expect(byUrl["https://www.comicsbeat.com/fixture-knight-tv-series-order/"]).toMatchObject({
        source_id: "comicsbeat_rss",
        published_at_source: "feed:pubDate",
        status: "confirmed",
        excerpt: expect.stringMatching(/live-action series/),
      });
      expect(new Date(byUrl["https://www.comicsbeat.com/fixture-knight-tv-series-order/"].published_at).toISOString()).toBe("2026-09-30T14:00:00.000Z");
      expect(byUrl["https://fixture-markets.example/hasbro-earnings"]).toMatchObject({
        source_id: "gdelt_doc_v2",
        published_at_source: "gdelt:seendate (first seen by GDELT)",
        status: "discovered",
        excerpt: null,
      });
      expect(byUrl["https://www.youtube.com/watch?v=FIXTURE0001"]).toMatchObject({ source_id: "alpha_investments_youtube" });
      expect(rows.rows.some((r) => r.canonical_url.includes("tariffs-trading-cards"))).toBe(false);

      const entities = await extractSourceItemEntities(db, { sourceKeys: ["alpha_investments_youtube", "gdelt_doc_v2", "comicsbeat_rss"] });
      expect(entities.items).toBe(8);
    });
  });

  it("leaves documents whose snapshot is in another checkout alone", async () => {
    await inTransaction(async (db) => {
      for (const s of collectiblesFixtureSnapshots(NOW)) await persistFeedSnapshots(db, s.sourceKey, [s], { status: "succeeded" });
      const r = await indexFeedItems(db, { now: NOW, stateDir: "/nonexistent-state-dir" });
      expect(r).toMatchObject({ documents: 0, missingSnapshot: 3, created: 0 });
    });
  });
});
