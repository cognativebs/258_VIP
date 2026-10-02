import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { SPORTS_HEADLINE_RULES_SEED } from "@vip/signals";
import { fixtureSnapshots, persistEspnSnapshots } from "./espn-sports.js";
import {
  classifyPendingEspnDocuments,
  openAiClassifier,
  snapshotPathFor,
  type LlmClassifier,
} from "./sports-classifier.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("snapshot paths and the OpenAI adapter (offline)", () => {
  it("resolves a storage key under the state dir", () => {
    expect(snapshotPathFor("jobs/.state/snapshots/espn/nfl/a.xml", "/state").replace(/\\/g, "/")).toBe(
      "/state/snapshots/espn/nfl/a.xml",
    );
  });

  it("returns null, never throws, on a bad response or a schema violation", async () => {
    const headline = { title: "Guard out 6-8 weeks", description: null };
    const bad = openAiClassifier({ apiKey: "k", fetchImpl: vi.fn(async () => new Response("no", { status: 500 })) });
    expect(await bad.classify(headline, SPORTS_HEADLINE_RULES_SEED)).toBeNull();
    const junk = openAiClassifier({
      apiKey: "k",
      fetchImpl: vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '{"signalType":"RUMOR"}' } }] }), { status: 200 }),
      ),
    });
    expect(await junk.classify(headline, SPORTS_HEADLINE_RULES_SEED)).toBeNull();
  });
});

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Hold back any real pending documents so only the fixtures are classified.
    await db.query(
      `UPDATE vault_signals.raw_document SET extraction_status = 'test_hold'
        WHERE source_id = 'espn_rss' AND extraction_status = 'pending'`,
    );
    await persistEspnSnapshots(db, fixtureSnapshots(NOW), { status: "succeeded" });
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!DSN)("sports classifier writes (IQVAULT_TEST_DSN, rolled back)", () => {
  it("rules: one event, PRIMARY evidence with item_ref, and one scored signal per headline; re-run adds nothing", async () => {
    await inTransaction(async (db) => {
      const marketBefore = await db.query(`SELECT count(*)::int AS n FROM vault_market.sale`);
      const report = await classifyPendingEspnDocuments(db);
      expect(report).toMatchObject({
        method: "rules",
        ruleSet: "sports-headline@0.2.0",
        documents: { processed: 3, missingSnapshot: [] },
        // The story shared by both feeds is classified once; the rumours item is noise.
        items: { signals: 4, noSignal: 1, noise: 1, alreadyClassified: 1 },
        byType: { PLAYER_INJURY: 2, TRANSACTION: 2 },
      });

      const rows = await db.query(
        `SELECT t.code, s.title, s.direction, s.base_confidence::float AS conf, s.base_impact::float AS impact,
                s.noise_probability::float AS noise, s.prov_verification, s.prov_rule_version,
                e.event_key, ee.role, ee.independence_group, ee.item_ref,
                vault_signals.signal_priority(s.id)::float AS priority
           FROM vault_signals.signal s
           JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
           JOIN vault_signals.event e ON e.id = s.event_id
           JOIN vault_signals.event_evidence ee ON ee.event_id = e.id
          WHERE e.event_key LIKE 'espn_rss:9000%'
          ORDER BY ee.item_ref`,
      );
      expect(rows.rows.map((r) => [r.item_ref, r.code])).toEqual([
        ["90000001", "PLAYER_INJURY"],
        ["90000002", "TRANSACTION"],
        ["90000011", "PLAYER_INJURY"],
        ["90000021", "TRANSACTION"],
      ]);
      const gamma = rows.rows.find((r) => r.item_ref === "90000011")!;
      // "out 6-8 weeks": weeks impact. The summary's "expected to return" hedges it: 0.55 × 0.8 × 0.6.
      expect(gamma).toMatchObject({
        direction: "down",
        conf: 0.264,
        impact: 0.3,
        noise: 0.3,
        prov_verification: "unverified",
        prov_rule_version: "sports-headline@0.2.0+rules",
        event_key: "espn_rss:90000011",
        role: "PRIMARY",
        independence_group: "espn",
      });
      expect(gamma.priority).toBeCloseTo(0.264 * 0.3 * 0.7, 6);
      const link = await db.query(
        `SELECT source_item_url FROM vault_signals.event_evidence WHERE item_ref = '90000001'`,
      );
      // Exactly as the feed gave it, tracking parameters included (ESPN terms).
      expect(link.rows[0].source_item_url).toBe(
        "https://www.espn.com/nfl/story/_/id/90000001/fixture-qb-alpha-ruled-out?utm_source=rss&utm_medium=feed",
      );

      const again = await classifyPendingEspnDocuments(db);
      expect(again.documents.processed).toBe(0);
      await db.query(
        `UPDATE vault_signals.raw_document SET extraction_status = 'pending'
          WHERE source_id = 'espn_rss' AND extraction_status = 'extracted'`,
      );
      const reprocess = await classifyPendingEspnDocuments(db);
      expect(reprocess.items).toMatchObject({ signals: 0, noSignal: 1, alreadyClassified: 5 });

      const marketAfter = await db.query(`SELECT count(*)::int AS n FROM vault_market.sale`);
      expect(marketAfter.rows[0].n).toBe(marketBefore.rows[0].n);
    });
  });

  it("LLM: only players become signals, names land as text placeholders, failures fall back to rules", async () => {
    await inTransaction(async (db) => {
      const llm: LlmClassifier = {
        model: "stub",
        classify: async (h) => {
          if (h.title.includes("Alpha")) return null; // provider failure → rules decide
          if (h.title.includes("Beta")) {
            return { signalType: "TRANSACTION", subjectKind: "player", subjectName: "Fixture WR Beta", severity: null, hedged: false, confidence: 0.9, rationale: "extension" };
          }
          if (h.title.includes("Gamma")) {
            return { signalType: "PLAYER_INJURY", subjectKind: "coach", subjectName: null, severity: "weeks", hedged: false, confidence: 0.9, rationale: "coach" };
          }
          return { signalType: "NONE", subjectKind: "other", subjectName: null, severity: null, hedged: false, confidence: 0.8, rationale: "not an event" };
        },
      };
      const report = await classifyPendingEspnDocuments(db, { llm });
      expect(report).toMatchObject({
        method: "llm",
        model: "stub",
        llm: { calls: 5, failures: 1 },
        items: { signals: 2, noSignal: 3, noise: 1 },
      });
      const rows = await db.query(
        `SELECT ee.item_ref, s.prov_rule_version, s.base_confidence::float AS conf, se.entity_ref, se.entity_kind
           FROM vault_signals.signal s
           JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id
           LEFT JOIN vault_signals.signal_entity se ON se.signal_id = s.id
          WHERE ee.item_ref LIKE '9000%'
          ORDER BY ee.item_ref`,
      );
      expect(rows.rows).toEqual([
        { item_ref: "90000001", prov_rule_version: "sports-headline@0.2.0+rules", conf: 0.33, entity_ref: null, entity_kind: null },
        { item_ref: "90000002", prov_rule_version: "sports-headline@0.2.0+llm:stub", conf: 0.495, entity_ref: "Fixture WR Beta", entity_kind: "player_name_text" },
      ]);
    });
  });

  it("leaves a document pending when its snapshot file is missing", async () => {
    await inTransaction(async (db) => {
      const report = await classifyPendingEspnDocuments(db, { stateDir: "/nonexistent-state-dir" });
      expect(report.documents).toMatchObject({ processed: 0 });
      expect(report.documents.missingSnapshot).toHaveLength(3);
      const pending = await db.query(
        `SELECT count(*)::int AS n FROM vault_signals.raw_document WHERE source_id = 'espn_rss' AND extraction_status = 'pending'`,
      );
      expect(pending.rows[0].n).toBe(3);
    });
  });
});
