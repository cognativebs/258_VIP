/**
 * US, world and business headlines → SIGNALS raw evidence, via GDELT DOC 2.0.
 * One query per lane (us, world, business); each response is one immutable
 * snapshot under snapshots/gdelt_doc_v2/<lane>/, which is how the daily lists
 * know an article's lane. Titles, outlet links and dates only; article pages
 * are never fetched.
 *
 * Fixtures by default (dry run, nothing written). --live runs only when the
 * gdelt_doc_v2 row passes newsAdapterMayRun; this job never enables it (HS-5).
 * Override the lane queries with VIP_GDELT_LANES (JSON [{lane, query}]).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { z } from "zod";
import { GdeltDocAdapter, GdeltLaneQuerySchema, gdeltRequestUrl, newsAdapterMayRun, type GdeltLaneQuery, type RawRssSnapshot } from "@vip/signals";
import { STATE_DIR, persistFeedSnapshots } from "./espn-sports.js";
import { dsnFromEnv } from "./price-history.js";

export const MACRO_NEWS_JOB_VERSION = "macro-news@0.1.0";
export const GDELT_SOURCE_KEY = "gdelt_doc_v2";

const COST_AND_DEMAND_TERMS =
  '(tariff OR tariffs OR "de minimis" OR USPS OR postage OR "shipping rates" OR inflation OR recession OR "interest rates" OR "consumer spending" OR "sales tax" OR "1099-K")';

/** Starting queries · unverified. The sourcecountry filters are checked on the first live dry run. */
export const DEFAULT_GDELT_LANES: GdeltLaneQuery[] = [
  { lane: "us", query: `${COST_AND_DEMAND_TERMS} sourcecountry:US sourcelang:english` },
  { lane: "world", query: `${COST_AND_DEMAND_TERMS} -sourcecountry:US sourcelang:english` },
  {
    lane: "business",
    query:
      '(eBay OR Hasbro OR Mattel OR Funko OR GameStop OR Fanatics OR Topps OR Panini OR Nintendo OR "Heritage Auctions" OR Goldin OR Whatnot OR "stock market" OR "S&P 500" OR Nasdaq OR "gold price" OR "silver price") sourcelang:english',
  },
];

export function lanesFromEnv(env: NodeJS.ProcessEnv = process.env): GdeltLaneQuery[] {
  const raw = env.VIP_GDELT_LANES?.trim();
  return raw ? z.array(GdeltLaneQuerySchema).min(1).parse(JSON.parse(raw)) : DEFAULT_GDELT_LANES;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "packages", "signals", "src", "adapters", "fixtures");

type LaneSnapshot = { lane: string; url: string; snapshot: RawRssSnapshot; live: boolean };

export type MacroNewsReport = {
  job: "macro-news";
  version: typeof MACRO_NEWS_JOB_VERSION;
  mode: "fixture" | "live";
  status: "dry_run" | "succeeded" | "partial" | "blocked" | "failed";
  ranAt: string;
  blockedReason: string | null;
  lanes: { lane: string; state: "fixture" | "fetched" | "no_fixture" | "error"; articles: number; documentsNew: number | null; error: string | null }[];
};

function adapterFor(lane: string): GdeltDocAdapter {
  return new GdeltDocAdapter({
    sourceId: GDELT_SOURCE_KEY,
    snapshotDir: join(STATE_DIR, "snapshots", GDELT_SOURCE_KEY, lane),
    // GDELT asks for at most one request every 5 seconds; keep a margin.
    rateLimitMs: Number(process.env.VIP_GDELT_RATE_LIMIT_MS ?? 10000),
  });
}

const articleCount = (s: LaneSnapshot) => adapterFor(s.lane).parseSnapshot(s.snapshot).length;

export function macroFixtureSnapshots(now = new Date(), lanes = DEFAULT_GDELT_LANES): LaneSnapshot[] {
  const out: LaneSnapshot[] = [];
  for (const { lane } of lanes) {
    const path = join(FIXTURE_DIR, `gdelt_doc_v2-${lane}-sample.json`);
    if (!existsSync(path)) continue;
    const url = `fixture://gdelt_doc_v2/${lane}`;
    out.push({ lane, url, snapshot: adapterFor(lane).writeSnapshot(url, readFileSync(path, "utf8"), now), live: false });
  }
  return out;
}

export async function runMacroNewsJob(opts: { live?: boolean; now?: Date; pool?: Pool; lanes?: GdeltLaneQuery[] } = {}): Promise<MacroNewsReport> {
  const now = opts.now ?? new Date();
  const lanes = opts.lanes ?? lanesFromEnv();
  const report: MacroNewsReport = {
    job: "macro-news",
    version: MACRO_NEWS_JOB_VERSION,
    mode: opts.live ? "live" : "fixture",
    status: "dry_run",
    ranAt: now.toISOString(),
    blockedReason: null,
    lanes: [],
  };

  if (!opts.live) {
    const snaps = macroFixtureSnapshots(now, lanes);
    for (const { lane } of lanes) {
      const s = snaps.find((x) => x.lane === lane);
      report.lanes.push({ lane, state: s ? "fixture" : "no_fixture", articles: s ? articleCount(s) : 0, documentsNew: null, error: null });
    }
    return report;
  }

  const pool = opts.pool ?? new Pool({ connectionString: dsnFromEnv() });
  const ownsPool = !opts.pool;
  try {
    const { rows } = await pool.query(
      `SELECT endpoint, adapter_enabled, is_active, verify_before_first_run, blocked_reason
         FROM vault_core.signals_news_source WHERE source_key = $1`,
      [GDELT_SOURCE_KEY],
    );
    const row = rows[0];
    const mayRun =
      row?.endpoint &&
      newsAdapterMayRun({
        adapterEnabled: row.adapter_enabled,
        isActive: row.is_active,
        verifyBeforeFirstRun: row.verify_before_first_run,
        blockedReason: row.blocked_reason,
      });
    if (!mayRun) {
      report.status = "blocked";
      report.blockedReason = !row
        ? "gdelt_doc_v2 row missing (apply 20260920_06)"
        : (row.blocked_reason ?? "gdelt_doc_v2 is not enabled. An operator runs `news-source enable gdelt_doc_v2 --confirm-operator`.");
      return report;
    }
    let fetched = 0;
    let throttled = false;
    for (const q of lanes) {
      if (throttled) {
        report.lanes.push({ lane: q.lane, state: "error", articles: 0, documentsNew: null, error: "skipped: GDELT asked to slow down (429); the next run retries" });
        continue;
      }
      const url = gdeltRequestUrl(row.endpoint, q);
      try {
        const snapshot = await adapterFor(q.lane).fetchAndSnapshot(url, now);
        const s: LaneSnapshot = { lane: q.lane, url, snapshot, live: true };
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const spine = await persistFeedSnapshots(client, GDELT_SOURCE_KEY, [s], { status: "succeeded" });
          await client.query("COMMIT");
          report.lanes.push({ lane: q.lane, state: "fetched", articles: articleCount(s), documentsNew: spine.documentsNew, error: null });
          fetched += 1;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A 429 means stop for this run rather than keep asking.
        if (/\b429\b/.test(message)) throttled = true;
        report.lanes.push({ lane: q.lane, state: "error", articles: 0, documentsNew: null, error: message });
      }
    }
    report.status = fetched === 0 ? "failed" : fetched < lanes.length ? "partial" : "succeeded";
    return report;
  } finally {
    if (ownsPool) await pool.end();
  }
}

export function formatMacroNewsReport(r: MacroNewsReport): string {
  return [
    `VIP Job — macro-news (${r.mode}) · status: ${r.status}${r.blockedReason ? ` — ${r.blockedReason}` : ""} · ${r.ranAt}`,
    ...r.lanes.map(
      (l) =>
        `  ${l.lane.padEnd(9)} ${l.state.padEnd(10)} articles ${l.articles}` +
        (l.documentsNew != null ? ` · ${l.documentsNew} new` : "") +
        (l.error ? ` — ${l.error}` : ""),
    ),
  ].join("\n");
}
