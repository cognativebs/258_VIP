import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { buildWatchTerms, runGdeltRadar, type FetchLike } from "./gdelt-radar.js";
import { classifyPendingDocuments } from "./sports-classifier.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-17T20:00:00.000Z");
const BASE = "https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams/";

const toc = (rows: { ID: number; title: string; url: string }[]) =>
  gzipSync(rows.map((r) => JSON.stringify({ ...r, date: "2026-10-17T19:20:00.000Z", img: "", lang: "en" })).join("\n"));
const ngrams = (lines: string[]) => gzipSync(lines.join("\n"));

/** Serves published minutes; anything else is 404, like GDELT between bursts. */
function fakeGdelt(minutes: Record<string, { toc: Buffer; ngrams: Buffer }>) {
  const asked: string[] = [];
  const impl: FetchLike = async (url) => {
    asked.push(url);
    const m = /(\d{14})\.(toc\.json|ngrams\.txt)\.gz$/.exec(url);
    const file = m ? minutes[m[1]!]?.[m[2] === "toc.json" ? "toc" : "ngrams"] : undefined;
    if (!file) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer };
  };
  return { impl, asked };
}

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

const enable = (db: PoolClient) =>
  db.query(
    `UPDATE vault_core.signals_news_source SET adapter_enabled = true, is_active = true, verify_before_first_run = false, blocked_reason = NULL
      WHERE source_key = 'gdelt_v5_ngrams'`,
  );

describe.skipIf(!DSN)("GDELT radar (IQVAULT_TEST_DSN, rolled back)", () => {
  it("stays blocked, with no download, until an operator enables gdelt_v5_ngrams", async () => {
    await inTransaction(async (db) => {
      const site = fakeGdelt({});
      const r = await runGdeltRadar(db, { now: NOW, fetchImpl: site.impl, stateDir: mkdtempSync(join(tmpdir(), "radar-")) });
      expect(r.status).toBe("blocked");
      expect(site.asked).toEqual([]);
    });
  });

  it("downloads published minutes, keeps only matches, skips old gaps, waits on a recent one, and dedupes", async () => {
    await inTransaction(async (db) => {
      await enable(db);
      const stateDir = mkdtempSync(join(tmpdir(), "radar-"));
      // Checkpoint 19:15; minutes 19:16–19:55 are due. 19:20 is published; from 19:30 on a missing minute may still come.
      writeFileSync(join(stateDir, "gdelt-v5-checkpoint.json"), JSON.stringify({ lastStamp: "20261017191500" }));
      const site = fakeGdelt({
        "20261017192000": {
          toc: toc([
            { ID: 1, title: "Topps loses NFL license to Fanatics", url: "https://cards.example/topps?utm_source=feed" },
            { ID: 2, title: "Best panini recipes", url: "https://food.example/panini" },
            { ID: 3, title: "Pokemon TCG reprint announced", url: "http://insecure.example/reprint" },
          ]),
          ngrams: ngrams(["1\tTopps and Panini trading\t1", "1\tPanini trading cards for\t1", "1\tcards for the NFL\t1", "2\ta grilled Panini sandwich\t1", "3\tthe Pokemon TCG reprint\t1"]),
        },
      });
      const terms = [
        { term: "Topps", tier: "D" as const, domain: "collectibles" as const, priority: 70, context: [], source: "test" },
        { term: "Panini", tier: "D" as const, domain: "collectibles" as const, priority: 70, context: [], source: "test" },
        { term: "Pokemon TCG", tier: "D" as const, domain: "collectibles" as const, priority: 85, context: [], source: "test" },
      ];
      const r = await runGdeltRadar(db, { now: NOW, fetchImpl: site.impl, stateDir, terms });
      expect(r).toMatchObject({
        status: "succeeded",
        batches: { downloaded: 1, pendingAt: "20261017193000" },
        // The sandwich has no card context; the http URL is not stored.
        articles: { scanned: 3, matched: 1, new: 1, byDomain: { collectibles: 1 } },
        checkpoint: "20261017192900",
      });
      // 19:16–19:19 and 19:21–19:29 are more than 30 minutes old: gaps GDELT never filled.
      expect(r.batches.gaps).toBe(13);
      const items = await db.query(`SELECT canonical_url, title, status, published_at_source, excerpt FROM vault_signals.source_item WHERE source_id = 'gdelt_v5_ngrams'`);
      expect(items.rows).toEqual([
        {
          canonical_url: "https://cards.example/topps",
          title: "Topps loses NFL license to Fanatics",
          status: "discovered",
          published_at_source: expect.stringMatching(/^gdelt_v5_toc/),
          excerpt: "GDELT radar matched: Panini (D), Topps (D)",
        },
      ]);
      // The matched snapshot is kept under its domain lane and is what the classifier reads.
      const snap = await db.query(
        `SELECT s.storage_key FROM vault_signals.raw_document d JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id WHERE d.source_id = 'gdelt_v5_ngrams'`,
      );
      expect(snap.rows.map((x) => x.storage_key)).toEqual([expect.stringMatching(/^jobs\/\.state\/snapshots\/gdelt_v5_ngrams\/collectibles\//)]);
      expect(readdirSync(join(stateDir, "raw", "gdelt_v5")).sort()).toEqual(["20261017192000.ngrams.txt.gz", "20261017192000.toc.json.gz"]);

      // Same minute served again later (checkpoint rewound): the URL is already known.
      writeFileSync(join(stateDir, "gdelt-v5-checkpoint.json"), JSON.stringify({ lastStamp: "20261017191900" }));
      const again = await runGdeltRadar(db, { now: NOW, fetchImpl: site.impl, stateDir, terms });
      expect(again.articles).toMatchObject({ matched: 1, new: 0 });

      const classified = await classifyPendingDocuments(db as never, {
        sourceKeys: ["gdelt_v5_ngrams"],
        ruleSetName: "collectibles-headline",
        job: "radar-collectibles-classifier",
        lanes: ["collectibles"],
        stateDir,
      });
      expect(classified.documents.processed).toBe(1);
      expect(classified.items.seen).toBe(1);
    });
  });

  it("deletes raw minute files older than 7 days and keeps the checkpoint on a failure", async () => {
    await inTransaction(async (db) => {
      await enable(db);
      const stateDir = mkdtempSync(join(tmpdir(), "radar-"));
      const raw = join(stateDir, "raw", "gdelt_v5");
      const site0 = fakeGdelt({});
      await runGdeltRadar(db, { now: NOW, fetchImpl: site0.impl, stateDir, terms: [], maxBatches: 1 });
      const old = join(raw, "20261001000000.toc.json.gz");
      writeFileSync(old, "x");
      utimesSync(old, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
      writeFileSync(join(stateDir, "gdelt-v5-checkpoint.json"), JSON.stringify({ lastStamp: "20261017194000" }));
      const down: FetchLike = async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) });
      const r = await runGdeltRadar(db, { now: NOW, fetchImpl: down, stateDir, terms: [] });
      expect(r).toMatchObject({ status: "failed", reason: expect.stringMatching(/HTTP 503/), checkpoint: "20261017194000", rawDeleted: 1 });
      expect(existsSync(old)).toBe(false);
      expect(JSON.parse(readFileSync(join(stateDir, "gdelt-v5-checkpoint.json"), "utf8")).circuit).toMatchObject({ state: "degraded" });
    });
  });

  it("builds Tier D from stored terms and Tier C from open thesis subjects", async () => {
    await inTransaction(async (db) => {
      await db.query(
        `INSERT INTO vault_signals.thesis (created_by, claim, claim_key, domain, subject_refs, horizon_days, action, confidence, reasons, prov_source, prov_rule_version, prov_confidence)
         VALUES ('test', 'Fixture claim', 'fixture claim radar', 'sports_cards', ARRAY['Fixture Player Alpha'], 30, 'Watch', 0.5, ARRAY['r'], 'test', 'test', 0.5)`,
      );
      const terms = await buildWatchTerms(db);
      expect(terms.find((t) => t.term === "Pokemon TCG")).toMatchObject({ tier: "D", domain: "collectibles" });
      expect(terms.find((t) => t.term === "Fixture Player Alpha")).toMatchObject({ tier: "C", domain: "sports_cards", priority: 90 });
    });
  });
});
