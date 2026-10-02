import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectiblesFixtureSnapshots, runCollectiblesNewsJob } from "./collectibles-news.js";
import { persistFeedSnapshots } from "./espn-sports.js";
import { classifyPendingDocuments } from "./sports-classifier.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-01T12:00:00.000Z");

function noNetwork() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network is not allowed in this test");
  });
}
afterEach(() => vi.restoreAllMocks());

describe("collectibles-news job", () => {
  it("fixture mode parses every fixture and writes nothing", async () => {
    const fetchSpy = noNetwork();
    const report = await runCollectiblesNewsJob({ now: NOW });
    expect(report.status).toBe("dry_run");
    expect(report.sources.map((s) => [s.sourceKey, s.state, s.items])).toEqual([
      ["comicsbeat_rss", "fixture", 3],
      ["pokebeach_rss", "fixture", 2],
      ["psa_news", "fixture", 1],
      ["tag_news", "no_fixture", 0],
      ["alpha_investments_youtube", "fixture", 2],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode stays blocked, with no fetch, while rows are disabled or have no endpoint", async () => {
    const fetchSpy = noNetwork();
    const pool = {
      query: async () => ({
        rows: [
          { source_key: "comicsbeat_rss", endpoint: "https://www.comicsbeat.com/feed/", adapter_enabled: false, is_active: false, verify_before_first_run: false, blocked_reason: null },
          { source_key: "pokebeach_rss", endpoint: null, adapter_enabled: false, is_active: false, verify_before_first_run: true, blocked_reason: "endpoint and terms unverified" },
        ],
      }),
    } as unknown as Pool;
    const report = await runCollectiblesNewsJob({ live: true, now: NOW, pool });
    expect(report.status).toBe("blocked");
    expect(report.sources.every((s) => s.state === "blocked")).toBe(true);
    expect(report.sources.find((s) => s.sourceKey === "pokebeach_rss")?.reason).toBe("endpoint and terms unverified");
    expect(report.sources.find((s) => s.sourceKey === "psa_news")?.reason).toMatch(/source row missing/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const s of collectiblesFixtureSnapshots(NOW)) {
      await persistFeedSnapshots(db, s.sourceKey, [s], { status: "succeeded" });
    }
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!DSN)("collectibles classification (IQVAULT_TEST_DSN, rolled back)", () => {
  it("classifies each source with its own ceiling, group and provenance method", async () => {
    await inTransaction(async (db) => {
      const report = await classifyPendingDocuments(db, {
        sourceKeys: ["comicsbeat_rss", "pokebeach_rss", "psa_news", "tag_news", "alpha_investments_youtube"],
        ruleSetName: "collectibles-headline",
      });
      expect(report).toMatchObject({
        ruleSet: "collectibles-headline@0.1.0",
        documents: { processed: 4, missingSnapshot: [] },
        items: { seen: 8, signals: 6, noise: 1, noSignal: 1 },
        byType: { MEDIA_ADAPTATION: 1, REPRINT: 2, SET_RELEASE: 1, RESTOCK: 1, GRADING_SERVICE_CHANGE: 1 },
      });
      const rows = await db.query(
        `SELECT d.source_id, t.code, s.domain, s.prov_method::text AS method, s.base_confidence::float AS conf,
                ee.independence_group, ee.item_ref, ds.media_type
           FROM vault_signals.signal s
           JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
           JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id
           JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
           JOIN vault_signals.document_snapshot ds ON ds.raw_document_id = d.id
          WHERE s.domain = 'collectibles' AND ee.item_ref IN ('cb-90000101', 'pb-90000202', 'psa-90000301', 'yt:video:FIXTURE0001')
          ORDER BY ee.item_ref`,
      );
      expect(rows.rows).toEqual([
        // Ceiling 0.65 × rules 0.6.
        { source_id: "comicsbeat_rss", code: "MEDIA_ADAPTATION", domain: "collectibles", method: "inferred", conf: 0.39, independence_group: "comicsbeat_rss", item_ref: "cb-90000101", media_type: "application/rss+xml" },
        // "Reports say ... expected to": hedged, 0.55 × 0.8 × 0.6.
        { source_id: "pokebeach_rss", code: "RESTOCK", domain: "collectibles", method: "inferred", conf: 0.264, independence_group: "pokebeach_rss", item_ref: "pb-90000202", media_type: "application/rss+xml" },
        { source_id: "psa_news", code: "GRADING_SERVICE_CHANGE", domain: "collectibles", method: "inferred", conf: 0.51, independence_group: "psa_news", item_ref: "psa-90000301", media_type: "application/rss+xml" },
        // Creator opinion: method opinion, ceiling 0.30 × 0.6.
        { source_id: "alpha_investments_youtube", code: "REPRINT", domain: "collectibles", method: "opinion", conf: 0.18, independence_group: "alpha_investments_youtube", item_ref: "yt:video:FIXTURE0001", media_type: "application/atom+xml" },
      ]);
      const market = await db.query(`SELECT count(*)::int AS n FROM vault_market.sale`);
      expect(market.rows[0].n).toBe(0);
    });
  });
});
