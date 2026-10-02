/**
 * Collectibles news → SIGNALS raw evidence: comics (ComicsBeat), Pokémon/TCG
 * (PokeBeach), grading announcements (PSA, TAG) and creator commentary
 * (Alpha Investments on YouTube, an Atom feed).
 *
 * Fixtures by default (dry run, nothing written). --live fetches a source only
 * when its signals_news_source row passes newsAdapterMayRun AND has an
 * endpoint; every new row ships disabled with endpoint and terms unverified.
 * HS-5: this job never enables a source. Headlines, summaries and links only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { RssAdapter, newsAdapterMayRun, type RawRssSnapshot } from "@vip/signals";
import { STATE_DIR, persistFeedSnapshots } from "./espn-sports.js";
import { dsnFromEnv } from "./price-history.js";

export const COLLECTIBLES_NEWS_JOB_VERSION = "collectibles-news@0.1.0";
export const COLLECTIBLES_SOURCE_KEYS = [
  "comicsbeat_rss",
  "pokebeach_rss",
  "psa_news",
  "tag_news",
  "alpha_investments_youtube",
] as const;
export type CollectiblesSourceKey = (typeof COLLECTIBLES_SOURCE_KEYS)[number];

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "packages", "signals", "src", "adapters", "fixtures");
const FIXTURE_URL = (key: string) => `fixture://${key}`;

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type SourceSnapshot = { sourceKey: CollectiblesSourceKey; url: string; snapshot: RawRssSnapshot; live: boolean };

export type CollectiblesNewsReport = {
  job: "collectibles-news";
  version: typeof COLLECTIBLES_NEWS_JOB_VERSION;
  mode: "fixture" | "live";
  status: "dry_run" | "succeeded" | "partial" | "blocked" | "failed";
  ranAt: string;
  sources: {
    sourceKey: CollectiblesSourceKey;
    state: "fixture" | "fetched" | "blocked" | "no_fixture" | "error";
    reason: string | null;
    items: number;
    documentsNew: number | null;
  }[];
};

function adapterFor(sourceKey: string, feedUrl = ""): RssAdapter {
  return new RssAdapter({
    feedUrl,
    sourceId: sourceKey,
    rateLimitMs: Number(process.env.VIP_RSS_RATE_LIMIT_MS ?? 1000),
    snapshotDir: join(STATE_DIR, "snapshots", sourceKey),
  });
}

export function collectiblesFixtureSnapshots(now = new Date()): SourceSnapshot[] {
  const out: SourceSnapshot[] = [];
  for (const sourceKey of COLLECTIBLES_SOURCE_KEYS) {
    const path = join(FIXTURE_DIR, `${sourceKey}-sample.xml`);
    if (!existsSync(path)) continue;
    const url = FIXTURE_URL(sourceKey);
    out.push({ sourceKey, url, snapshot: adapterFor(sourceKey).writeSnapshot(url, readFileSync(path, "utf8"), now), live: false });
  }
  return out;
}

const countItems = (s: SourceSnapshot) => adapterFor(s.sourceKey).parseSnapshot(s.snapshot).length;

export async function runCollectiblesNewsJob(opts: { live?: boolean; now?: Date; pool?: Pool } = {}): Promise<CollectiblesNewsReport> {
  const now = opts.now ?? new Date();
  const report: CollectiblesNewsReport = {
    job: "collectibles-news",
    version: COLLECTIBLES_NEWS_JOB_VERSION,
    mode: opts.live ? "live" : "fixture",
    status: "dry_run",
    ranAt: now.toISOString(),
    sources: [],
  };

  if (!opts.live) {
    const snaps = collectiblesFixtureSnapshots(now);
    for (const sourceKey of COLLECTIBLES_SOURCE_KEYS) {
      const s = snaps.find((x) => x.sourceKey === sourceKey);
      report.sources.push({
        sourceKey,
        state: s ? "fixture" : "no_fixture",
        reason: null,
        items: s ? countItems(s) : 0,
        documentsNew: null,
      });
    }
    return report;
  }

  const pool = opts.pool ?? new Pool({ connectionString: dsnFromEnv() });
  const ownsPool = !opts.pool;
  try {
    const rows = await pool.query(
      `SELECT source_key, endpoint, adapter_enabled, is_active, verify_before_first_run, blocked_reason
         FROM vault_core.signals_news_source WHERE source_key = ANY($1::text[])`,
      [COLLECTIBLES_SOURCE_KEYS],
    );
    const byKey = new Map(rows.rows.map((r) => [r.source_key as string, r]));
    let fetched = 0;
    let failed = 0;
    for (const sourceKey of COLLECTIBLES_SOURCE_KEYS) {
      const row = byKey.get(sourceKey);
      const mayRun =
        row &&
        row.endpoint &&
        newsAdapterMayRun({
          adapterEnabled: row.adapter_enabled,
          isActive: row.is_active,
          verifyBeforeFirstRun: row.verify_before_first_run,
          blockedReason: row.blocked_reason,
        });
      if (!mayRun) {
        report.sources.push({
          sourceKey,
          state: "blocked",
          reason: !row
            ? "source row missing (apply 20261001_03)"
            : !row.endpoint
              ? (row.blocked_reason ?? "no endpoint")
              : (row.blocked_reason ?? "not enabled by an operator"),
          items: 0,
          documentsNew: null,
        });
        continue;
      }
      try {
        const snapshot = await adapterFor(sourceKey, row.endpoint).fetchAndSnapshot(now);
        const s: SourceSnapshot = { sourceKey, url: row.endpoint, snapshot, live: true };
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const spine = await persistFeedSnapshots(client, sourceKey, [s], { status: "succeeded" });
          await client.query("COMMIT");
          report.sources.push({ sourceKey, state: "fetched", reason: null, items: countItems(s), documentsNew: spine.documentsNew });
          fetched += 1;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } catch (e) {
        failed += 1;
        report.sources.push({ sourceKey, state: "error", reason: e instanceof Error ? e.message : String(e), items: 0, documentsNew: null });
      }
    }
    report.status = fetched === 0 ? (failed ? "failed" : "blocked") : failed ? "partial" : "succeeded";
    return report;
  } finally {
    if (ownsPool) await pool.end();
  }
}

export function formatCollectiblesNewsReport(r: CollectiblesNewsReport): string {
  return [
    `VIP Job — collectibles-news (${r.mode}) · status: ${r.status} · ${r.ranAt}`,
    ...r.sources.map(
      (s) =>
        `  ${s.sourceKey.padEnd(26)} ${s.state.padEnd(10)} items ${s.items}` +
        (s.documentsNew != null ? ` · ${s.documentsNew} new` : "") +
        (s.reason ? ` — ${s.reason}` : ""),
    ),
  ].join("\n");
}
