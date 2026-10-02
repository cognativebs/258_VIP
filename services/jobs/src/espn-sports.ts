/**
 * ESPN sports news → IQVault job feed + SIGNALS spine raw evidence (ADR 0013 G-7).
 *
 * Terms (ESPN.com News Feeds FAQ, 2020-01-28): show feed content unmodified,
 * link to the espn.com article with the URL the feed provides, credit ESPN,
 * and put no advertising inside ESPN content. IQVault-only;
 * redistribution_allowed stays false. Headlines, summaries and links only.
 *
 * Offline fixtures by default (dry run: nothing written). --live fetches only
 * when the espn_rss row passes newsAdapterMayRun. HS-5: this job never enables
 * the source; `enable-source` is an explicit operator command.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { RssAdapter, newsAdapterMayRun, type RawRssSnapshot } from "@vip/signals";
import { dsnFromEnv } from "./price-history.js";

export const ESPN_SPORTS_JOB_VERSION = "espn-sports@0.1.0";
export const ESPN_SOURCE_KEY = "espn_rss";
export const ESPN_ATTRIBUTION = "Provided by ESPN";
const FEED_CAP = 200;

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Raw snapshots are kept forever; VIP_JOBS_STATE_DIR points them at a durable checkout. */
export const STATE_DIR = process.env.VIP_JOBS_STATE_DIR ?? join(__dirname, "..", ".state");
/** Sibling of signals-feed.json; the VIP API merges signals-feed.<job>.json files. */
export const ESPN_FEED_FILE = join(
  dirname(process.env.VIP_SIGNALS_FEED ?? join(STATE_DIR, "signals-feed.json")),
  "signals-feed.espn-sports.json",
);
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "packages", "signals", "src", "adapters", "fixtures");

export const EspnFeedSchema = z
  .object({
    sport: z.string().regex(/^[a-z]+$/),
    url: z.string().url(),
  })
  .strict();
export type EspnFeed = z.infer<typeof EspnFeedSchema>;

/**
 * The sports in the operator's daily-sports curation (2026-10-01): football (NFL,
 * college), soccer, NBA, MLB. Hockey and college basketball are not fetched.
 * Override with VIP_ESPN_RSS_FEEDS.
 */
export const DEFAULT_ESPN_FEEDS: EspnFeed[] = [
  { sport: "nfl", url: "https://www.espn.com/espn/rss/nfl/news" },
  { sport: "ncf", url: "https://www.espn.com/espn/rss/ncf/news" },
  { sport: "soccer", url: "https://www.espn.com/espn/rss/soccer/news" },
  { sport: "nba", url: "https://www.espn.com/espn/rss/nba/news" },
  { sport: "mlb", url: "https://www.espn.com/espn/rss/mlb/news" },
];

/** VIP_ESPN_RSS_FEEDS="nfl=https://...,nba=https://..." */
export function feedsFromEnv(env: NodeJS.ProcessEnv = process.env): EspnFeed[] {
  const raw = env.VIP_ESPN_RSS_FEEDS?.trim();
  if (!raw) return DEFAULT_ESPN_FEEDS;
  return raw.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    return EspnFeedSchema.parse({ sport: pair.slice(0, eq).trim(), url: pair.slice(eq + 1).trim() });
  });
}

export const EspnFeedSignalSchema = z
  .object({
    id: z.string().min(1),
    signalType: z.literal("news"),
    title: z.string().min(1),
    body: z.string().min(1),
    /** The link exactly as the feed provided it (terms: do not modify URLs). */
    sourceUrl: z.string().nullable(),
    signalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    noveltyScore: z.null(),
    quarantineStatus: z.enum(["active", "quarantined"]),
    sourceId: z.literal(ESPN_SOURCE_KEY),
    attribution: z.literal(ESPN_ATTRIBUTION),
    sport: z.string().min(1),
  })
  .strict();
export type EspnFeedSignal = z.infer<typeof EspnFeedSignalSchema>;

export const EspnSignalsFeedSchema = z
  .object({
    schema: z.literal("vip_signals_feed_v1"),
    writtenAt: z.string(),
    runId: z.string(),
    job: z.literal("espn-sports"),
    provenance: z.object({
      source: z.literal(ESPN_SOURCE_KEY),
      method: z.literal("rss-parse"),
      ruleOrModelVersion: z.literal(ESPN_SPORTS_JOB_VERSION),
      verificationStatus: z.literal("unverified"),
      notes: z.string(),
    }),
    signals: z.array(EspnFeedSignalSchema),
  })
  .strict();
export type EspnSignalsFeed = z.infer<typeof EspnSignalsFeedSchema>;

export type FeedSnapshot = { feed: EspnFeed; snapshot: RawRssSnapshot; live: boolean };

export type EspnSportsReport = {
  job: "espn-sports";
  version: typeof ESPN_SPORTS_JOB_VERSION;
  mode: "fixture" | "live";
  status: "dry_run" | "succeeded" | "partial" | "blocked" | "failed";
  runId: string;
  ranAt: string;
  blockedReason: string | null;
  feedsFetched: string[];
  feedErrors: { sport: string; error: string }[];
  signals: { active: number; quarantined: number };
  feedFile: string | null;
  spine: { ingestRunId: string; documentsFetched: number; documentsNew: number } | null;
};

function adapterFor(sport: string): RssAdapter {
  return new RssAdapter({
    feedUrl: "",
    sourceId: ESPN_SOURCE_KEY,
    rateLimitMs: Number(process.env.VIP_RSS_RATE_LIMIT_MS ?? 1000),
    // One directory per sport so same-second snapshots never share a filename.
    snapshotDir: join(STATE_DIR, "snapshots", "espn", sport),
  });
}

/** Offline: the fixtures that exist (nfl, nba). Never touches the network. */
export function fixtureSnapshots(now = new Date(), feeds = DEFAULT_ESPN_FEEDS): FeedSnapshot[] {
  const out: FeedSnapshot[] = [];
  for (const feed of feeds) {
    const path = join(FIXTURE_DIR, `espn-${feed.sport}-sample.xml`);
    if (!existsSync(path)) continue;
    const snapshot = adapterFor(feed.sport).writeSnapshot(feed.url, readFileSync(path, "utf8"), now);
    out.push({ feed, snapshot, live: false });
  }
  return out;
}

async function liveSnapshots(
  feeds: EspnFeed[],
  now: Date,
): Promise<{ snapshots: FeedSnapshot[]; errors: EspnSportsReport["feedErrors"] }> {
  const snapshots: FeedSnapshot[] = [];
  const errors: EspnSportsReport["feedErrors"] = [];
  for (const feed of feeds) {
    try {
      const adapter = new RssAdapter({
        feedUrl: feed.url,
        sourceId: ESPN_SOURCE_KEY,
        rateLimitMs: Number(process.env.VIP_RSS_RATE_LIMIT_MS ?? 1000),
        snapshotDir: join(STATE_DIR, "snapshots", "espn", feed.sport),
      });
      snapshots.push({ feed, snapshot: await adapter.fetchAndSnapshot(now), live: true });
    } catch (e) {
      errors.push({ sport: feed.sport, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { snapshots, errors };
}

/** Headlines, summaries and links pass through unmodified. Same guid across feeds keeps the first. */
export function buildEspnFeedSignals(snapshots: FeedSnapshot[]): EspnFeedSignal[] {
  const seen = new Set<string>();
  const out: EspnFeedSignal[] = [];
  for (const { feed, snapshot } of snapshots) {
    for (const s of adapterFor(feed.sport).parseSnapshot(snapshot)) {
      const active = s.quarantineStatus === "active";
      const id = active ? s.id : `${feed.sport}-${s.id}`;
      const key = active ? `guid:${s.guid}` : id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        EspnFeedSignalSchema.parse({
          id,
          signalType: "news",
          title: s.title,
          body: s.body,
          sourceUrl: s.sourceUrl,
          signalDate: s.signalDate,
          noveltyScore: null,
          quarantineStatus: active ? "active" : "quarantined",
          sourceId: ESPN_SOURCE_KEY,
          attribution: ESPN_ATTRIBUTION,
          sport: feed.sport,
        }),
      );
    }
  }
  return out.sort((a, b) => b.signalDate.localeCompare(a.signalDate)).slice(0, FEED_CAP);
}

export function espnSignalsFeed(signals: EspnFeedSignal[], runId: string, ranAt: string): EspnSignalsFeed {
  return EspnSignalsFeedSchema.parse({
    schema: "vip_signals_feed_v1",
    writtenAt: ranAt,
    runId,
    job: "espn-sports",
    provenance: {
      source: ESPN_SOURCE_KEY,
      method: "rss-parse",
      ruleOrModelVersion: ESPN_SPORTS_JOB_VERSION,
      verificationStatus: "unverified",
      notes: `${ESPN_ATTRIBUTION}. Headlines are news, not comps. IQVault-only; not for redistribution.`,
    },
    signals,
  });
}

type Queryable = Pick<PoolClient, "query">;

export async function loadEspnSourceGate(db: Queryable): Promise<{ mayRun: boolean; reason: string | null }> {
  const { rows } = await db.query(
    `SELECT adapter_enabled, is_active, verify_before_first_run, blocked_reason
       FROM vault_core.signals_news_source
      WHERE source_key = $1`,
    [ESPN_SOURCE_KEY],
  );
  const row = rows[0];
  if (!row) return { mayRun: false, reason: "espn_rss row missing (apply 20260920_06)" };
  const mayRun = newsAdapterMayRun({
    adapterEnabled: row.adapter_enabled,
    isActive: row.is_active,
    verifyBeforeFirstRun: row.verify_before_first_run,
    blockedReason: row.blocked_reason,
  });
  if (mayRun) return { mayRun, reason: null };
  return {
    mayRun,
    reason:
      row.blocked_reason ??
      "espn_rss is not enabled (adapter_enabled, is_active, verify_before_first_run). An operator runs `espn-sports enable-source`.",
  };
}

/**
 * One ingest_run; one raw_document + immutable document_snapshot per new feed
 * snapshot. Unchanged feeds dedupe on (source_id, content_hash). Stores a
 * storage key, never the XML. The caller owns the transaction.
 */
export async function persistEspnSnapshots(
  db: Queryable,
  snapshots: FeedSnapshot[],
  opts: { status: "succeeded" | "partial"; errorText?: string | null; stateDir?: string },
): Promise<NonNullable<EspnSportsReport["spine"]>> {
  const stateDir = opts.stateDir ?? STATE_DIR;
  const run = await db.query(
    `INSERT INTO vault_signals.ingest_run (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [ESPN_SOURCE_KEY],
  );
  const ingestRunId: string = run.rows[0].id;
  let documentsNew = 0;
  for (const { feed, snapshot, live } of snapshots) {
    const contentHash = createHash("sha256").update(snapshot.rawXml, "utf8").digest("hex");
    const storageKey = relative(stateDir, snapshot.snapshotPath).split("\\").join("/");
    const inserted = await db.query(
      `INSERT INTO vault_signals.raw_document (
         source_id, fetched_at, source_url, content_hash, http_status,
         raw_payload_ref, extraction_status, ingest_run_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (source_id, content_hash) DO NOTHING
       RETURNING id`,
      [
        ESPN_SOURCE_KEY,
        snapshot.fetchedAt,
        feed.url,
        contentHash,
        live ? 200 : null,
        `local_fs:jobs/.state/${storageKey}`,
        ingestRunId,
      ],
    );
    if (inserted.rows.length === 0) continue;
    documentsNew += 1;
    await db.query(
      `INSERT INTO vault_signals.document_snapshot (
         raw_document_id, storage_backend, storage_key, byte_size, media_type
       ) VALUES ($1, 'local_fs', $2, $3, 'application/rss+xml')`,
      [inserted.rows[0].id, `jobs/.state/${storageKey}`, snapshot.byteLength],
    );
  }
  await db.query(
    `UPDATE vault_signals.ingest_run
        SET finished_at = now(), status = $2,
            documents_fetched = $3, documents_new = $4, error_text = $5
      WHERE id = $1`,
    [ingestRunId, opts.status, snapshots.length, documentsNew, opts.errorText ?? null],
  );
  return { ingestRunId, documentsFetched: snapshots.length, documentsNew };
}

/**
 * Fixture mode (default): parse fixtures, write nothing, report.
 * Live mode: gate on the espn_rss row, fetch every feed, write the IQVault feed
 * file and the spine rows. A failing feed does not stop the others.
 */
export async function runEspnSportsJob(opts: {
  live?: boolean;
  now?: Date;
  feeds?: EspnFeed[];
  pool?: Pool;
} = {}): Promise<EspnSportsReport> {
  const now = opts.now ?? new Date();
  const feeds = opts.feeds ?? feedsFromEnv();
  const runId = createHash("sha256").update(`espn-sports:${now.toISOString()}`).digest("hex").slice(0, 16);
  const report: EspnSportsReport = {
    job: "espn-sports",
    version: ESPN_SPORTS_JOB_VERSION,
    mode: opts.live ? "live" : "fixture",
    status: "dry_run",
    runId,
    ranAt: now.toISOString(),
    blockedReason: null,
    feedsFetched: [],
    feedErrors: [],
    signals: { active: 0, quarantined: 0 },
    feedFile: null,
    spine: null,
  };

  if (!opts.live) {
    const snapshots = fixtureSnapshots(now, feeds);
    const signals = buildEspnFeedSignals(snapshots);
    report.feedsFetched = snapshots.map((s) => s.feed.sport);
    report.signals = countSignals(signals);
    return report;
  }

  const pool = opts.pool ?? new Pool({ connectionString: dsnFromEnv() });
  const ownsPool = !opts.pool;
  try {
    const gate = await loadEspnSourceGate(pool);
    if (!gate.mayRun) {
      report.status = "blocked";
      report.blockedReason = gate.reason;
      return report;
    }
    const { snapshots, errors } = await liveSnapshots(feeds, now);
    report.feedsFetched = snapshots.map((s) => s.feed.sport);
    report.feedErrors = errors;
    if (snapshots.length === 0) {
      report.status = "failed";
      return report;
    }
    const status = errors.length > 0 ? "partial" : "succeeded";
    const signals = buildEspnFeedSignals(snapshots);
    report.signals = countSignals(signals);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      report.spine = await persistEspnSnapshots(client, snapshots, {
        status,
        errorText: errors.length ? errors.map((e) => `${e.sport}: ${e.error}`).join("; ") : null,
      });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    mkdirSync(dirname(ESPN_FEED_FILE), { recursive: true });
    writeFileSync(ESPN_FEED_FILE, JSON.stringify(espnSignalsFeed(signals, runId, report.ranAt), null, 2), "utf8");
    report.feedFile = ESPN_FEED_FILE;
    report.status = status;
    return report;
  } finally {
    if (ownsPool) await pool.end();
  }
}

function countSignals(signals: EspnFeedSignal[]): EspnSportsReport["signals"] {
  const active = signals.filter((s) => s.quarantineStatus === "active").length;
  return { active, quarantined: signals.length - active };
}

/**
 * Operator action (HS-5). Records the verified terms and enables the source.
 * Requires --confirm-operator on the CLI. `disable` reverses it.
 */
export async function setEspnSourceEnabled(db: Queryable, enabled: boolean): Promise<void> {
  if (enabled) {
    await db.query(
      `UPDATE vault_core.signals_news_source
          SET endpoint = 'https://www.espn.com/espn/rss/',
              adapter_enabled = true,
              is_active = true,
              verify_before_first_run = false,
              blocked_reason = NULL,
              terms = 'ESPN.com News Feeds FAQ (2020-01-28): display feed content unmodified, link to the espn.com article with the feed URL, credit ESPN, no advertising inside ESPN content. IQVault-only. Store headlines, summaries and links; never article bodies. redistribution_allowed=false.',
              prov_notes = 'Enabled by operator ' || to_char(now(), 'YYYY-MM-DD') || ' (ADR 0013 G-7). authority_seed is a seed estimate · unverified. Phase 2 off.'
        WHERE source_key = $1`,
      [ESPN_SOURCE_KEY],
    );
    return;
  }
  await db.query(
    `UPDATE vault_core.signals_news_source
        SET adapter_enabled = false,
            is_active = false,
            prov_notes = 'Disabled by operator ' || to_char(now(), 'YYYY-MM-DD') || '.'
      WHERE source_key = $1`,
    [ESPN_SOURCE_KEY],
  );
}

export function formatEspnSportsReport(r: EspnSportsReport): string {
  return [
    `VIP Job — espn-sports (${r.mode})`,
    `status: ${r.status}${r.blockedReason ? ` — ${r.blockedReason}` : ""}`,
    `runId: ${r.runId} · ranAt: ${r.ranAt}`,
    `feeds: ${r.feedsFetched.join(", ") || "(none)"}`,
    ...r.feedErrors.map((e) => `  feed error ${e.sport}: ${e.error}`),
    `signals: ${r.signals.active} active, ${r.signals.quarantined} quarantined`,
    `feed file: ${r.feedFile ?? "(not written)"}`,
    r.spine
      ? `spine: ingest_run ${r.spine.ingestRunId} · ${r.spine.documentsNew}/${r.spine.documentsFetched} new documents`
      : "spine: (not written)",
  ].join("\n");
}
