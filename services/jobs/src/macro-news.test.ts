import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("stops the run at the first 429 instead of asking again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Please limit requests to one every 5 seconds", { status: 429, statusText: "Too Many Requests" }),
    );
    const report = await runMacroNewsJob({ live: true, now: NOW, pool: enabledPool(), lanesPerRun: 3, cursorPath: freshCursor() });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("failed");
    expect(report.lanes.map((l) => l.error)).toEqual([
      expect.stringMatching(/429/),
      expect.stringMatching(/^skipped: GDELT asked to slow down/),
      expect.stringMatching(/^skipped: GDELT asked to slow down/),
    ]);
  });

  it("one lane per run behind a circuit breaker: degraded after a 429, open after two, one probe every 6 h", async () => {
    const cursorPath = freshCursor();
    const gap = process.env.VIP_GDELT_RATE_LIMIT_MS;
    process.env.VIP_GDELT_RATE_LIMIT_MS = "0";
    const asked: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      asked.push(String(url));
      return new Response("slow down", { status: 429, statusText: "Too Many Requests" });
    });
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const first = await runMacroNewsJob({ live: true, now: NOW, pool: enabledPool(), cursorPath });
    expect(first.lanes.map((l) => l.lane)).toEqual(["us"]);
    expect(JSON.parse(readFileSync(cursorPath, "utf8")).circuit).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
    // Degraded still asks on the next run; the second 429 opens the circuit.
    await runMacroNewsJob({ live: true, now: at(60), pool: enabledPool(), cursorPath });
    expect(asked).toHaveLength(2);
    expect(JSON.parse(readFileSync(cursorPath, "utf8")).circuit).toMatchObject({ state: "open", nextProbeAt: at(60 + 360).toISOString() });
    const waiting = await runMacroNewsJob({ live: true, now: at(120), pool: enabledPool(), cursorPath });
    expect(waiting).toMatchObject({ status: "waiting", blockedReason: expect.stringMatching(/radar is unaffected/) });
    expect(asked).toHaveLength(2);
    // The probe is one request even with more lanes per run.
    await runMacroNewsJob({ live: true, now: at(60 + 361), pool: enabledPool(), cursorPath, lanesPerRun: 3 });
    expect(asked).toHaveLength(3);
    expect(JSON.parse(readFileSync(cursorPath, "utf8"))).toMatchObject({ next: 0, circuit: { state: "open", consecutiveFailures: 3 } });
    fetchSpy.mockRestore();
    if (gap === undefined) delete process.env.VIP_GDELT_RATE_LIMIT_MS;
    else process.env.VIP_GDELT_RATE_LIMIT_MS = gap;
  });

  it("reads a cursor written before the circuit breaker as an open circuit", async () => {
    const cursorPath = freshCursor();
    writeFileSync(cursorPath, JSON.stringify({ next: 1, backoffUntil: "2026-10-01T20:00:00.000Z", consecutive429: 4 }));
    const fetchSpy = noNetwork();
    const r = await runMacroNewsJob({ live: true, now: NOW, pool: enabledPool(), cursorPath });
    expect(r.status).toBe("waiting");
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

function enabledPool(): Pool {
  return {
    query: async () => ({
      rows: [{ endpoint: "https://api.gdeltproject.org/api/v2/doc/doc", adapter_enabled: true, is_active: true, verify_before_first_run: false, blocked_reason: null }],
    }),
  } as unknown as Pool;
}

function freshCursor(): string {
  return join(mkdtempSync(join(tmpdir(), "gdelt-cursor-")), "cursor.json");
}
