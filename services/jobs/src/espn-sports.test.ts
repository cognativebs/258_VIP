import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ESPN_FEEDS,
  ESPN_ATTRIBUTION,
  EspnSignalsFeedSchema,
  buildEspnFeedSignals,
  espnSignalsFeed,
  feedsFromEnv,
  fixtureSnapshots,
  loadEspnSourceGate,
  persistEspnSnapshots,
  runEspnSportsJob,
} from "./espn-sports.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const DSN = process.env.IQVAULT_TEST_DSN;

function noNetwork() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("network call in an offline test");
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("espn-sports feeds", () => {
  it("defaults to the six ESPN FAQ feeds and accepts an override", () => {
    expect(feedsFromEnv({}).map((f) => f.sport)).toEqual(["nfl", "ncf", "soccer", "nba", "mlb"]);
    expect(
      feedsFromEnv({ VIP_ESPN_RSS_FEEDS: "nfl=https://www.espn.com/espn/rss/nfl/news" }),
    ).toEqual([{ sport: "nfl", url: "https://www.espn.com/espn/rss/nfl/news" }]);
    expect(() => feedsFromEnv({ VIP_ESPN_RSS_FEEDS: "NFL!=not-a-url" })).toThrow();
  });
});

describe("espn-sports signals (fixtures)", () => {
  it("passes headlines, summaries and links through unmodified, credited to ESPN", () => {
    const signals = buildEspnFeedSignals(fixtureSnapshots(NOW));
    const qb = signals.find((s) => s.title.startsWith("Fixture QB Alpha"));
    expect(qb).toBeDefined();
    expect(qb!.title).toBe("Fixture QB Alpha ruled out Sunday with knee injury");
    expect(qb!.body).toBe(
      "The Fixture City quarterback will miss Week 4 after an MRI on Monday, the team said.",
    );
    // Terms: link with the URL the feed provides — tracking params included.
    expect(qb!.sourceUrl).toBe(
      "https://www.espn.com/nfl/story/_/id/90000001/fixture-qb-alpha-ruled-out?utm_source=rss&utm_medium=feed",
    );
    expect(signals.every((s) => s.attribution === ESPN_ATTRIBUTION)).toBe(true);
    expect(signals.every((s) => s.sourceId === "espn_rss")).toBe(true);
  });

  it("keeps one copy of a story that appears in two feeds and quarantines malformed items", () => {
    const signals = buildEspnFeedSignals(fixtureSnapshots(NOW));
    expect(signals.filter((s) => s.title === "Top story shared across feeds")).toHaveLength(1);
    expect(signals.filter((s) => s.quarantineStatus === "active")).toHaveLength(6);
    const quarantined = signals.filter((s) => s.quarantineStatus === "quarantined");
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.sport).toBe("nfl");
  });

  it("writes an immutable raw snapshot per feed in its own directory", () => {
    const snaps = fixtureSnapshots(NOW);
    expect(snaps.map((s) => s.feed.sport)).toEqual(["nfl", "soccer", "nba"]);
    const [nfl, , nba] = snaps;
    expect(nfl!.snapshot.snapshotPath).not.toBe(nba!.snapshot.snapshotPath);
    expect(readFileSync(nfl!.snapshot.snapshotPath, "utf8")).toBe(nfl!.snapshot.rawXml);
  });

  it("builds a feed file that the vip_signals_feed_v1 contract accepts", () => {
    const feed = espnSignalsFeed(buildEspnFeedSignals(fixtureSnapshots(NOW)), "run-1", NOW.toISOString());
    expect(EspnSignalsFeedSchema.parse(feed).job).toBe("espn-sports");
    expect(feed.provenance.verificationStatus).toBe("unverified");
  });
});

describe("espn-sports job", () => {
  it("fixture mode is a dry run: no network, no feed file, no spine rows", async () => {
    const fetchSpy = noNetwork();
    const report = await runEspnSportsJob({ now: NOW, feeds: DEFAULT_ESPN_FEEDS });
    expect(report.status).toBe("dry_run");
    expect(report.feedFile).toBeNull();
    expect(report.spine).toBeNull();
    expect(report.signals).toEqual({ active: 6, quarantined: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode stays blocked, with no fetch, while the source row is not enabled", async () => {
    const fetchSpy = noNetwork();
    const pool = {
      query: async () => ({
        rows: [
          {
            adapter_enabled: false,
            is_active: false,
            verify_before_first_run: true,
            blocked_reason: "discover per-sport feeds; commercial-use terms unresolved",
          },
        ],
      }),
    } as unknown as Pool;
    const report = await runEspnSportsJob({ live: true, now: NOW, pool });
    expect(report.status).toBe("blocked");
    expect(report.blockedReason).toContain("terms unresolved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe.skipIf(!DSN)("espn-sports spine writes (IQVAULT_TEST_DSN, rolled back)", () => {
  it("records a run, one raw_document + snapshot per feed, and dedupes unchanged feeds", async () => {
    const pool = new Pool({ connectionString: DSN });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const snaps = fixtureSnapshots(NOW);
      const first = await persistEspnSnapshots(client, snaps, { status: "succeeded" });
      expect(first).toMatchObject({ documentsFetched: 3, documentsNew: 3 });
      const second = await persistEspnSnapshots(client, snaps, { status: "succeeded" });
      expect(second).toMatchObject({ documentsFetched: 3, documentsNew: 0 });

      const docs = await client.query(
        `SELECT d.raw_payload_ref, s.storage_backend, s.media_type
           FROM vault_signals.raw_document d
           JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id
          WHERE d.ingest_run_id = $1`,
        [first.ingestRunId],
      );
      expect(docs.rows).toHaveLength(3);
      for (const row of docs.rows) {
        expect(row.raw_payload_ref).toMatch(/^local_fs:jobs\/\.state\/snapshots\/espn\/(nfl|soccer|nba)\//);
        expect(row.raw_payload_ref).not.toContain("<rss");
        expect(row.storage_backend).toBe("local_fs");
        expect(row.media_type).toBe("application/rss+xml");
      }
      const run = await client.query(
        `SELECT status, documents_fetched, documents_new FROM vault_signals.ingest_run WHERE id = $1`,
        [first.ingestRunId],
      );
      expect(run.rows[0]).toEqual({ status: "succeeded", documents_fetched: 3, documents_new: 3 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });

  it("reads the gate from the live espn_rss row", async () => {
    const pool = new Pool({ connectionString: DSN });
    try {
      const gate = await loadEspnSourceGate(pool);
      expect(typeof gate.mayRun).toBe("boolean");
      if (!gate.mayRun) expect(gate.reason).toBeTruthy();
    } finally {
      await pool.end();
    }
  });
});
