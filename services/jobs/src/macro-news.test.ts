import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistFeedSnapshots } from "./espn-sports.js";
import { GDELT_SOURCE_KEY, lanesFromEnv, macroFixtureSnapshots, runMacroNewsJob } from "./macro-news.js";
import { disableNewsSource, enableNewsSource, listNewsSources } from "./news-source-admin.js";
import { classifyPendingDocuments } from "./sports-classifier.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-01T12:00:00.000Z");

function noNetwork() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network is not allowed in this test");
  });
}
afterEach(() => vi.restoreAllMocks());

describe("macro-news job", () => {
  it("fixture mode parses each lane and writes nothing", async () => {
    const fetchSpy = noNetwork();
    const report = await runMacroNewsJob({ now: NOW });
    expect(report.status).toBe("dry_run");
    expect(report.lanes.map((l) => [l.lane, l.state, l.articles])).toEqual([
      ["us", "fixture", 4],
      ["world", "fixture", 2],
      ["business", "fixture", 3],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode stays blocked, with no fetch, until an operator enables gdelt_doc_v2", async () => {
    const fetchSpy = noNetwork();
    const pool = {
      query: async () => ({
        rows: [{ endpoint: "https://api.gdeltproject.org/api/v2/doc/doc", adapter_enabled: false, is_active: false, verify_before_first_run: false, blocked_reason: null }],
      }),
    } as unknown as Pool;
    const report = await runMacroNewsJob({ live: true, now: NOW, pool });
    expect(report.status).toBe("blocked");
    expect(report.blockedReason).toMatch(/news-source enable gdelt_doc_v2/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts lane overrides from VIP_GDELT_LANES and rejects bad ones", () => {
    expect(lanesFromEnv({ VIP_GDELT_LANES: '[{"lane":"us","query":"(tariff) sourcecountry:US"}]' })).toHaveLength(1);
    expect(() => lanesFromEnv({ VIP_GDELT_LANES: '[{"lane":"US!","query":"x"}]' })).toThrow();
    expect(lanesFromEnv({}).map((l) => l.lane)).toEqual(["us", "world", "business"]);
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

describe.skipIf(!DSN)("macro classification (IQVAULT_TEST_DSN, rolled back)", () => {
  it("classifies GDELT lanes, crediting and grouping by outlet", async () => {
    await inTransaction(async (db) => {
      for (const s of macroFixtureSnapshots(NOW)) {
        await persistFeedSnapshots(db, GDELT_SOURCE_KEY, [s], { status: "succeeded" });
      }
      const report = await classifyPendingDocuments(db, { sourceKeys: [GDELT_SOURCE_KEY], ruleSetName: "macro-headline" });
      expect(report).toMatchObject({
        ruleSet: "macro-headline@0.1.0",
        documents: { processed: 3, missingSnapshot: [] },
        items: { seen: 9, quarantined: 1, noise: 2, noSignal: 1, signals: 5 },
        byType: { TRADE_POLICY: 2, SHIPPING_CHANGE: 1, COMPANY_EVENT: 1, MARKET_MOVE: 1 },
      });
      const rows = await db.query(
        `SELECT t.code, s.domain, s.base_confidence::float AS conf, ee.independence_group, ds.media_type, ds.storage_key, s.prov_notes
           FROM vault_signals.signal s
           JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
           JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id
           JOIN vault_signals.document_snapshot ds ON ds.raw_document_id = ee.raw_document_id
          WHERE ee.item_ref = 'https://fixture-world.example/eu-de-minimis'`,
      );
      expect(rows.rows[0]).toMatchObject({
        code: "TRADE_POLICY",
        domain: "macro",
        conf: 0.36, // GDELT ceiling 0.60 × rules 0.6
        independence_group: "fixture-world.example",
        media_type: "application/json",
      });
      expect(rows.rows[0].storage_key).toMatch(/snapshots\/gdelt_doc_v2\/world\//);
      expect(rows.rows[0].prov_notes).toMatch(/^fixture-world\.example via /);
    });
  });

  it("news-source: enable needs an endpoint, records it, and disable reverses it", async () => {
    await inTransaction(async (db) => {
      await expect(enableNewsSource(db, { sourceKey: "pokebeach_rss" })).rejects.toThrow(/no endpoint/);
      await expect(enableNewsSource(db, { sourceKey: "pokebeach_rss", endpoint: "http://insecure.example/feed" })).rejects.toThrow();
      await expect(enableNewsSource(db, { sourceKey: "nope_rss", endpoint: "https://x.example/feed" })).rejects.toThrow(/no news source/);
      const on = await enableNewsSource(db, { sourceKey: "pokebeach_rss", endpoint: "https://feeds.example/pokebeach" });
      expect(on).toMatchObject({ enabled: true, endpoint: "https://feeds.example/pokebeach" });
      const gdelt = await enableNewsSource(db, { sourceKey: "gdelt_doc_v2" });
      expect(gdelt.endpoint).toBe("https://api.gdeltproject.org/api/v2/doc/doc");
      await disableNewsSource(db, "pokebeach_rss");
      const list = await listNewsSources(db);
      expect(list.find((s) => s.sourceKey === "pokebeach_rss")).toMatchObject({ enabled: false, endpoint: "https://feeds.example/pokebeach" });
      expect(list.find((s) => s.sourceKey === "gdelt_doc_v2")?.enabled).toBe(true);
    });
  });
});
