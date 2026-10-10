/**
 * PokéBeach connector, steps 1–3 of the operator's build spec (2026-10-03):
 * official homepage ingestion, canonical dedupe with revision history, and
 * tracked-member configuration. No classification, clustering or scoring here.
 *
 * Official news: the homepage lists articles; each new article page is fetched
 * once for its identity (canonical URL, WordPress post id) and its UTC publish
 * time (article:published_time). Discovery feeds (community front-page feed,
 * forum RSS) only point at articles or link their comment threads; their
 * timestamps are never used. A page that no longer parses marks the URL
 * parser-degraded and ingests nothing.
 *
 * Fetching is polite: descriptive User-Agent, one request at a time with a
 * jittered gap, conditional GET, exponential backoff. Never logged in; a 401
 * or 403 is never retried around. Each source is gated by its
 * signals_news_source row (HS-5); this module never enables one.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOMEPAGE_TIME_SOURCE,
  MemberWeightsSchema,
  POKEBEACH_PARSER_VERSION,
  articleContentHash,
  pacificDisplayTimeToUtc,
  newsAdapterMayRun,
  parseArticlePage,
  parseDiscoveryFeedUrls,
  parseForumThreads,
  parseHomepage,
  titleKey,
  type ArticlePage,
  type HomepageArticle,
  type MemberWeights,
} from "@vip/signals";
import { STATE_DIR } from "./espn-sports.js";
import { upsertSourceItem, type UpsertResult } from "./source-items.js";

export const POKEBEACH_JOB_VERSION = "pokebeach@0.1.0";
export const OFFICIAL = "pokebeach_official";
export const FRONTPAGE_FEED = "pokebeach_frontpage_feed";
export const FORUM_RSS = "pokebeach_rss";
export const MEMBERS = "pokebeach_members";

export const DEFAULT_USER_AGENT = "IQVault-SIGNALS/0.1 (+personal collector research; one request at a time)";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type FetchImpl = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const POKEBEACH_FIXTURE_DIR = join(__dirname, "..", "..", "..", "packages", "signals", "src", "connectors", "pokebeach", "fixtures");

// ---------------------------------------------------------------------------
// Polite fetching

export type ClientOptions = {
  fetchImpl?: FetchImpl;
  userAgent?: string;
  /** Minimum gap between requests; jitter of up to half of it is added. 0 in tests. */
  minGapMs?: number;
  now?: () => Date;
};

export type FetchOutcome =
  | { kind: "ok"; status: number; body: string }
  | { kind: "not_modified" }
  | { kind: "backoff"; until: string }
  | { kind: "error"; status: number | null; message: string };

let lastRequestAt = 0;
export function resetPokebeachThrottleForTests() {
  lastRequestAt = 0;
}

const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** A login wall or bot challenge (401 / 403) is the site saying no: look again once a day, no sooner. */
const BLOCKED_RECHECK_MS = 24 * 60 * 60 * 1000;

export async function politeGet(
  db: Queryable,
  sourceId: string,
  url: string,
  opts: ClientOptions & { conditional?: boolean } = {},
): Promise<FetchOutcome> {
  const now = opts.now ?? (() => new Date());
  const { rows } = await db.query(
    `SELECT etag, last_modified, consecutive_failures, next_attempt_at
       FROM vault_signals.source_fetch_state WHERE source_id = $1 AND url = $2`,
    [sourceId, url],
  );
  const state = rows[0];
  if (state?.next_attempt_at && new Date(state.next_attempt_at) > now()) {
    return { kind: "backoff", until: new Date(state.next_attempt_at).toISOString() };
  }
  const gap = opts.minGapMs ?? Number(process.env.VIP_POKEBEACH_MIN_GAP_MS ?? 4000);
  if (gap > 0) {
    const wait = lastRequestAt + gap + Math.random() * (gap / 2) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const headers: Record<string, string> = {
    "User-Agent": opts.userAgent ?? process.env.VIP_SIGNALS_USER_AGENT ?? DEFAULT_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (opts.conditional && state?.etag) headers["If-None-Match"] = state.etag;
  if (opts.conditional && state?.last_modified) headers["If-Modified-Since"] = state.last_modified;

  let res: Response | null = null;
  let error: string | null = null;
  try {
    res = await (opts.fetchImpl ?? (fetch as unknown as FetchImpl))(url, { headers });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  lastRequestAt = Date.now();
  const at = now();

  if (res && (res.ok || res.status === 304)) {
    const body = res.status === 304 ? "" : await res.text();
    await db.query(
      `INSERT INTO vault_signals.source_fetch_state
         (source_id, url, etag, last_modified, last_status, last_fetched_at, last_success_at, consecutive_failures, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 0, NULL)
       ON CONFLICT (source_id, url) DO UPDATE
         SET etag = coalesce(EXCLUDED.etag, vault_signals.source_fetch_state.etag),
             last_modified = coalesce(EXCLUDED.last_modified, vault_signals.source_fetch_state.last_modified),
             last_status = EXCLUDED.last_status, last_fetched_at = EXCLUDED.last_fetched_at,
             last_success_at = EXCLUDED.last_success_at, consecutive_failures = 0, next_attempt_at = NULL`,
      [sourceId, url, res.headers.get("etag"), res.headers.get("last-modified"), res.status, at],
    );
    return res.status === 304 ? { kind: "not_modified" } : { kind: "ok", status: res.status, body };
  }

  const failures = Number(state?.consecutive_failures ?? 0) + 1;
  const status = res?.status ?? null;
  // A login wall or block is access control: wait the maximum, never work around it.
  const delay = status === 401 || status === 403 ? BLOCKED_RECHECK_MS : Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
  const next = new Date(at.getTime() + delay);
  await db.query(
    `INSERT INTO vault_signals.source_fetch_state
       (source_id, url, last_status, last_fetched_at, consecutive_failures, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_id, url) DO UPDATE
       SET last_status = EXCLUDED.last_status, last_fetched_at = EXCLUDED.last_fetched_at,
           consecutive_failures = EXCLUDED.consecutive_failures, next_attempt_at = EXCLUDED.next_attempt_at`,
    [sourceId, url, status, at, failures, next],
  );
  return { kind: "error", status, message: error ?? `HTTP ${status}` };
}

async function setParserState(db: Queryable, sourceId: string, url: string, state: "ok" | "degraded", note: string | null) {
  await db.query(
    `INSERT INTO vault_signals.source_fetch_state (source_id, url, parser_state, parser_note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, url) DO UPDATE SET parser_state = EXCLUDED.parser_state, parser_note = EXCLUDED.parser_note`,
    [sourceId, url, state, note],
  );
}

// ---------------------------------------------------------------------------
// Raw evidence: immutable, content-addressed local snapshots + raw_document rows

function writeSnapshot(sourceId: string, kind: string, body: string, ext: string): { path: string; hash: string; bytes: number } {
  const hash = createHash("sha256").update(body, "utf8").digest("hex");
  const dir = join(STATE_DIR, "snapshots", sourceId, kind);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sourceId}-${hash.slice(0, 32)}.${ext}`);
  try {
    writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return { path, hash, bytes: Buffer.byteLength(body, "utf8") };
}

async function recordRawDocument(
  db: Queryable,
  ingestRunId: string,
  sourceId: string,
  url: string,
  body: string,
  opts: { kind: string; ext: "html" | "xml"; mediaType: string; httpStatus: number | null; fetchedAt: Date },
): Promise<string> {
  const snap = writeSnapshot(sourceId, opts.kind, body, opts.ext);
  const storageKey = `jobs/.state/${relative(STATE_DIR, snap.path).split("\\").join("/")}`;
  const inserted = await db.query(
    `INSERT INTO vault_signals.raw_document (
       source_id, fetched_at, source_url, content_hash, http_status, raw_payload_ref, extraction_status, ingest_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6, 'indexed', $7)
     ON CONFLICT (source_id, content_hash) DO NOTHING
     RETURNING id`,
    [sourceId, opts.fetchedAt, url, snap.hash, opts.httpStatus, `local_fs:${storageKey}`, ingestRunId],
  );
  if (inserted.rows[0]) {
    await db.query(
      `INSERT INTO vault_signals.document_snapshot (raw_document_id, storage_backend, storage_key, byte_size, media_type)
       VALUES ($1, 'local_fs', $2, $3, $4)`,
      [inserted.rows[0].id, storageKey, snap.bytes, opts.mediaType],
    );
    return inserted.rows[0].id;
  }
  const existing = await db.query(`SELECT id FROM vault_signals.raw_document WHERE source_id = $1 AND content_hash = $2`, [sourceId, snap.hash]);
  return existing.rows[0].id;
}

async function startRun(db: Queryable, sourceId: string): Promise<string> {
  const run = await db.query(`INSERT INTO vault_signals.ingest_run (source_id, status) VALUES ($1, 'running') RETURNING id`, [sourceId]);
  return run.rows[0].id;
}

async function finishRun(db: Queryable, id: string, status: "succeeded" | "partial" | "failed", fetched: number, created: number, error: string | null) {
  await db.query(
    `UPDATE vault_signals.ingest_run
        SET finished_at = now(), status = $2, documents_fetched = $3, documents_new = $4, error_text = $5
      WHERE id = $1`,
    [id, status, fetched, created, error],
  );
}

// ---------------------------------------------------------------------------
// Item identity and revisions

export type { UpsertResult };

/**
 * One item per canonical URL (and WordPress post id). A changed title, author,
 * publish time or publisher summary appends a material revision; comment
 * counts, modified_time and the discovery route never do.
 */
export async function upsertArticle(
  db: Queryable,
  article: ArticlePage,
  opts: {
    via: string;
    rawDocumentId: string | null;
    now: Date;
    /** Defaults to the article page's own time; homepage-only items name the inferred source. */
    timeSource?: string;
    status?: "confirmed" | "discovered";
  },
): Promise<UpsertResult> {
  return upsertSourceItem(
    db,
    OFFICIAL,
    {
      externalId: article.postId,
      canonicalUrl: article.canonicalUrl,
      title: article.title,
      author: article.author,
      authorSlug: article.authorSlug,
      publishedAt: article.publishedAt,
      modifiedAt: article.modifiedAt,
      description: article.description,
    },
    {
      via: opts.via,
      rawDocumentId: opts.rawDocumentId,
      now: opts.now,
      timeSource: opts.timeSource ?? "article:published_time",
      status: opts.status ?? "confirmed",
      parserVersion: POKEBEACH_PARSER_VERSION,
      hash: articleContentHash(article),
    },
  );
}

/**
 * Homepage-only mode: what the front page itself shows. The publish time is the
 * displayed Pacific wall-clock time, converted to UTC and labeled inferred.
 */
export function articleFromHomepage(a: HomepageArticle): ArticlePage | null {
  const publishedAt = pacificDisplayTimeToUtc(a.displayedTime);
  if (!publishedAt) return null;
  return {
    postId: a.postId,
    canonicalUrl: a.canonicalUrl,
    title: a.title,
    author: a.author,
    authorSlug: a.authorSlug,
    publishedAt,
    modifiedAt: null,
    description: null,
  };
}

/** Article pages are off unless VIP_POKEBEACH_ARTICLE_PAGES=on (PokéBeach refused them on 2026-10-03). */
export const articlePagesEnabled = (env: NodeJS.ProcessEnv = process.env) => env.VIP_POKEBEACH_ARTICLE_PAGES === "on";

/** A sighting of a known article (homepage, discovery feed): last seen and route only. */
async function touchArticle(db: Queryable, canonicalUrl: string, postId: string | null, via: string, now: Date): Promise<boolean> {
  const r = await db.query(
    `UPDATE vault_signals.source_item
        SET last_seen_at = greatest(last_seen_at, $4),
            discovered_via = CASE WHEN $5 = ANY(discovered_via) THEN discovered_via ELSE array_append(discovered_via, $5) END
      WHERE source_id = $1 AND (canonical_url = $2 OR (item_kind = 'article' AND external_id = $3))
      RETURNING id`,
    [OFFICIAL, canonicalUrl, postId, now, via],
  );
  return r.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Jobs

type SourceGate = { mayRun: boolean; endpoint: string | null; reason: string | null };

export async function sourceGate(db: Queryable, sourceKey: string): Promise<SourceGate> {
  const { rows } = await db.query(
    `SELECT endpoint, adapter_enabled, is_active, verify_before_first_run, blocked_reason
       FROM vault_core.signals_news_source WHERE source_key = $1`,
    [sourceKey],
  );
  const row = rows[0];
  if (!row) return { mayRun: false, endpoint: null, reason: `${sourceKey} row missing (apply 20261003_01)` };
  const mayRun =
    Boolean(row.endpoint) &&
    newsAdapterMayRun({
      adapterEnabled: row.adapter_enabled,
      isActive: row.is_active,
      verifyBeforeFirstRun: row.verify_before_first_run,
      blockedReason: row.blocked_reason,
    });
  return {
    mayRun,
    endpoint: row.endpoint,
    reason: mayRun ? null : (row.blocked_reason ?? `${sourceKey} is not enabled (npm run news-source -- enable ${sourceKey} --confirm-operator)`),
  };
}

export type OfficialReport = {
  job: "pokebeach";
  mode: "official" | "reconcile" | "backfill" | "discover";
  version: typeof POKEBEACH_JOB_VERSION;
  status: "succeeded" | "partial" | "blocked" | "degraded" | "failed" | "not_modified";
  reason: string | null;
  pagesFetched: number;
  articlesListed: number;
  created: number;
  revised: number;
  seen: number;
  articleErrors: { url: string; reason: string }[];
  threadsLinked: number;
  /** Discovery feed articles the homepage never listed (not created in homepage-only mode). */
  notOnHomepage: number;
  /** Set by the first 401/403: no further article page is requested in this run. */
  accessBlocked: boolean;
  skipped: number;
};

function emptyReport(mode: OfficialReport["mode"]): OfficialReport {
  return {
    job: "pokebeach",
    mode,
    version: POKEBEACH_JOB_VERSION,
    status: "succeeded",
    reason: null,
    pagesFetched: 0,
    articlesListed: 0,
    created: 0,
    revised: 0,
    seen: 0,
    articleErrors: [],
    threadsLinked: 0,
    notOnHomepage: 0,
    accessBlocked: false,
    skipped: 0,
  };
}

/** Fetch one article page, snapshot it, and upsert the item. Degraded pages ingest nothing. */
async function ingestArticle(
  db: Queryable,
  runId: string,
  url: string,
  via: string,
  report: OfficialReport,
  client: ClientOptions,
  conditional = false,
): Promise<void> {
  if (report.accessBlocked) {
    report.skipped += 1;
    return;
  }
  const now = (client.now ?? (() => new Date()))();
  const got = await politeGet(db, OFFICIAL, url, { ...client, conditional });
  if (got.kind === "not_modified") {
    report.seen += 1;
    return;
  }
  if (got.kind === "backoff") {
    report.skipped += 1;
    return;
  }
  if (got.kind !== "ok") {
    // A refusal is access control: stop asking for article pages for the rest of this run.
    if (got.status === 401 || got.status === 403) report.accessBlocked = true;
    report.articleErrors.push({ url, reason: got.message });
    return;
  }
  report.pagesFetched += 1;
  const rawId = await recordRawDocument(db, runId, OFFICIAL, url, got.body, {
    kind: "articles",
    ext: "html",
    mediaType: "text/html",
    httpStatus: got.status,
    fetchedAt: now,
  });
  const parsed = parseArticlePage(got.body);
  if (!parsed.ok) {
    await setParserState(db, OFFICIAL, url, "degraded", parsed.reason);
    report.articleErrors.push({ url, reason: `PARSER_DEGRADED: ${parsed.reason}` });
    return;
  }
  await setParserState(db, OFFICIAL, url, "ok", null);
  const result = await upsertArticle(db, parsed.value, { via, rawDocumentId: rawId, now });
  report[result] += 1;
}

const finish = (r: OfficialReport): OfficialReport => {
  if (r.accessBlocked) {
    r.status = "blocked";
    r.reason = "PokéBeach refused an article page (HTTP 401/403); no further article pages were requested this run, and nothing tries to get around it";
  } else if (r.status === "succeeded" && (r.articleErrors.length || r.skipped)) {
    r.status = "partial";
  }
  return r;
};

/**
 * Official poll: the homepage (conditional GET), then each article not seen
 * before. Known articles are only touched.
 */
export async function runPokebeachOfficial(
  db: Queryable,
  client: ClientOptions = {},
  opts: { maxPages?: number; olderThan?: Date; articlePages?: boolean } = {},
): Promise<OfficialReport> {
  const articlePages = opts.articlePages ?? articlePagesEnabled();
  const report = emptyReport(opts.olderThan ? "backfill" : "official");
  const gate = await sourceGate(db, OFFICIAL);
  if (!gate.mayRun) return { ...report, status: "blocked", reason: gate.reason };
  const runId = await startRun(db, OFFICIAL);
  let url: string | null = gate.endpoint!;
  let page = 0;
  try {
    while (url && page < (opts.maxPages ?? 1)) {
      const now = (client.now ?? (() => new Date()))();
      const got = await politeGet(db, OFFICIAL, url, { ...client, conditional: page === 0 && !opts.olderThan });
      if (got.kind === "not_modified") {
        report.status = page === 0 ? "not_modified" : report.status;
        break;
      }
      if (got.kind !== "ok") {
        report.status = page === 0 ? "failed" : "partial";
        report.reason = got.kind === "backoff" ? `backing off until ${got.until}` : got.message;
        if (got.kind === "error" && (got.status === 401 || got.status === 403)) report.accessBlocked = true;
        break;
      }
      report.pagesFetched += 1;
      const homeRawId = await recordRawDocument(db, runId, OFFICIAL, url, got.body, { kind: "home", ext: "html", mediaType: "text/html", httpStatus: got.status, fetchedAt: now });
      const parsed = parseHomepage(got.body);
      if (!parsed.ok) {
        await setParserState(db, OFFICIAL, url, "degraded", parsed.reason);
        report.status = "degraded";
        report.reason = `PARSER_DEGRADED: ${parsed.reason}`;
        break;
      }
      await setParserState(db, OFFICIAL, url, "ok", null);
      report.articlesListed += parsed.value.articles.length;
      let oldestOnPage: Date | null = null;
      for (const a of parsed.value.articles) {
        if (!articlePages) {
          const fromHome = articleFromHomepage(a);
          if (!fromHome) {
            report.articleErrors.push({ url: a.canonicalUrl, reason: `PARSER_DEGRADED: homepage time "${a.displayedTime}" did not parse` });
            continue;
          }
          const result = await upsertArticle(db, fromHome, {
            via: "homepage",
            rawDocumentId: homeRawId,
            now,
            timeSource: HOMEPAGE_TIME_SOURCE,
            status: "discovered",
          });
          report[result] += 1;
          const t = new Date(fromHome.publishedAt);
          if (!oldestOnPage || t < oldestOnPage) oldestOnPage = t;
          continue;
        }
        if (await touchArticle(db, a.canonicalUrl, a.postId, "homepage", now)) {
          report.seen += 1;
        } else {
          await ingestArticle(db, runId, a.canonicalUrl, "homepage", report, client);
        }
        const t = await db.query(`SELECT published_at FROM vault_signals.source_item WHERE source_id = $1 AND canonical_url = $2`, [OFFICIAL, a.canonicalUrl]);
        const published = t.rows[0]?.published_at ? new Date(t.rows[0].published_at) : null;
        if (published && (!oldestOnPage || published < oldestOnPage)) oldestOnPage = published;
      }
      page += 1;
      if (opts.olderThan && oldestOnPage && oldestOnPage < opts.olderThan) break;
      url = parsed.value.nextPageUrl;
    }
    await finishRun(db, runId, report.status === "failed" ? "failed" : report.articleErrors.length || report.status === "degraded" ? "partial" : "succeeded", report.pagesFetched, report.created, report.reason);
    return finish(report);
  } catch (e) {
    await finishRun(db, runId, "failed", report.pagesFetched, report.created, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Daily: re-read articles first seen in the last 48h (catches edits and corrections), then the first two homepage pages. */
export async function runPokebeachReconcile(db: Queryable, client: ClientOptions = {}, opts: { lookbackHours?: number } = {}): Promise<OfficialReport> {
  const report = emptyReport("reconcile");
  const gate = await sourceGate(db, OFFICIAL);
  if (!gate.mayRun) return { ...report, status: "blocked", reason: gate.reason };
  if (!articlePagesEnabled()) {
    // Homepage-only: nothing to re-read per article; re-list the front page.
    const listing = await runPokebeachOfficial(db, client, { maxPages: 1, articlePages: false });
    return { ...listing, mode: "reconcile" };
  }
  const now = (client.now ?? (() => new Date()))();
  const runId = await startRun(db, OFFICIAL);
  const recent = await db.query(
    `SELECT canonical_url FROM vault_signals.source_item
      WHERE source_id = $1 AND item_kind = 'article' AND first_seen_at > $2
      ORDER BY first_seen_at`,
    [OFFICIAL, new Date(now.getTime() - (opts.lookbackHours ?? 48) * 3600 * 1000)],
  );
  for (const r of recent.rows) await ingestArticle(db, runId, r.canonical_url, "reconcile", report, client, true);
  await finishRun(db, runId, report.articleErrors.length ? "partial" : "succeeded", report.pagesFetched, report.created, null);
  const listing = await runPokebeachOfficial(db, client, { maxPages: 2, olderThan: new Date(0) });
  report.pagesFetched += listing.pagesFetched;
  report.articlesListed += listing.articlesListed;
  report.created += listing.created;
  report.seen += listing.seen;
  report.articleErrors.push(...listing.articleErrors);
  return finish(report);
}

/** Initial import: walk homepage pages until articles are older than the cutoff (default 90 days). */
export function runPokebeachBackfill(db: Queryable, client: ClientOptions = {}, opts: { days?: number; maxPages?: number } = {}) {
  const now = (client.now ?? (() => new Date()))();
  return runPokebeachOfficial(db, client, {
    maxPages: opts.maxPages ?? 25,
    olderThan: new Date(now.getTime() - (opts.days ?? 90) * 24 * 3600 * 1000),
  });
}

/**
 * Discovery feeds. The community front-page feed may add an article the
 * homepage poll missed (fetched from PokéBeach itself, never trusted for time).
 * The forum RSS links articles to their comment threads by title.
 */
export async function runPokebeachDiscovery(db: Queryable, client: ClientOptions = {}): Promise<OfficialReport> {
  const report = emptyReport("discover");
  const official = await sourceGate(db, OFFICIAL);
  if (!official.mayRun) return { ...report, status: "blocked", reason: official.reason };
  const runId = await startRun(db, OFFICIAL);
  const now = (client.now ?? (() => new Date()))();
  const reasons: string[] = [];

  const community = await sourceGate(db, FRONTPAGE_FEED);
  if (community.mayRun) {
    const got = await politeGet(db, FRONTPAGE_FEED, community.endpoint!, { ...client, conditional: true });
    if (got.kind === "ok") {
      report.pagesFetched += 1;
      const feedRun = await startRun(db, FRONTPAGE_FEED);
      await recordRawDocument(db, feedRun, FRONTPAGE_FEED, community.endpoint!, got.body, { kind: "feed", ext: "xml", mediaType: "application/rss+xml", httpStatus: got.status, fetchedAt: now });
      await finishRun(db, feedRun, "succeeded", 1, 0, null);
      for (const url of parseDiscoveryFeedUrls(got.body)) {
        if (await touchArticle(db, url, null, "community_feed", now)) report.seen += 1;
        else if (articlePagesEnabled()) await ingestArticle(db, runId, url, "community_feed", report, client);
        else report.notOnHomepage += 1;
      }
    } else if (got.kind !== "not_modified") {
      reasons.push(`${FRONTPAGE_FEED}: ${got.kind === "backoff" ? `backing off until ${got.until}` : got.message}`);
    }
  } else {
    reasons.push(`${FRONTPAGE_FEED}: ${community.reason}`);
  }

  const forum = await sourceGate(db, FORUM_RSS);
  if (forum.mayRun) {
    const got = await politeGet(db, FORUM_RSS, forum.endpoint!, { ...client, conditional: true });
    if (got.kind === "ok") {
      report.pagesFetched += 1;
      const feedRun = await startRun(db, FORUM_RSS);
      await recordRawDocument(db, feedRun, FORUM_RSS, forum.endpoint!, got.body, { kind: "feed", ext: "xml", mediaType: "application/rss+xml", httpStatus: got.status, fetchedAt: now });
      await finishRun(db, feedRun, "succeeded", 1, 0, null);
      const threads = new Map(parseForumThreads(got.body).map((t) => [titleKey(t.title), t]));
      const recent = await db.query(
        `SELECT id, title FROM vault_signals.source_item
          WHERE source_id = $1 AND item_kind = 'article' AND discussion_url IS NULL
          ORDER BY first_seen_at DESC LIMIT 200`,
        [OFFICIAL],
      );
      for (const item of recent.rows) {
        const t = threads.get(titleKey(item.title));
        if (!t) continue;
        await db.query(`UPDATE vault_signals.source_item SET discussion_url = $2 WHERE id = $1`, [item.id, t.url]);
        report.threadsLinked += 1;
      }
    } else if (got.kind !== "not_modified") {
      reasons.push(`${FORUM_RSS}: ${got.kind === "backoff" ? `backing off until ${got.until}` : got.message}`);
    }
  } else {
    reasons.push(`${FORUM_RSS}: ${forum.reason}`);
  }

  report.reason = reasons.length ? reasons.join("; ") : null;
  await finishRun(db, runId, report.articleErrors.length ? "partial" : "succeeded", report.pagesFetched, report.created, report.reason);
  return finish(report);
}

// ---------------------------------------------------------------------------
// Tracked members (configuration only; no member adapter until the access check passes)

export type TrackedMemberRow = {
  handle: string;
  profileUrl: string | null;
  tracked: boolean;
  weights: MemberWeights;
  weightsFrom: string;
};

export async function listTrackedMembers(db: Queryable): Promise<TrackedMemberRow[]> {
  const { rows } = await db.query(
    `SELECT handle, profile_url, tracked, weights, weights_from
       FROM vault_core.signals_source_author WHERE source_key = $1 ORDER BY lower(handle)`,
    [MEMBERS],
  );
  return rows.map((r) => ({
    handle: r.handle,
    profileUrl: r.profile_url,
    tracked: r.tracked,
    weights: MemberWeightsSchema.parse(r.weights),
    weightsFrom: r.weights_from,
  }));
}

/** Only https://www.pokebeach.com/forums/members/... profile pages. */
export function memberProfileUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.hostname.replace(/^www\./, "") !== "pokebeach.com" || !/^\/forums\/members\/[^/]+\/?$/.test(u.pathname)) {
    throw new Error("profile URL must look like https://www.pokebeach.com/forums/members/<name>.<id>/");
  }
  return `https://www.pokebeach.com${u.pathname.replace(/\/?$/, "/")}`;
}

export async function updateTrackedMember(
  db: Queryable,
  handle: string,
  patch: { profileUrl?: string; tracked?: boolean; weights?: Partial<MemberWeights> },
): Promise<TrackedMemberRow> {
  const current = (await listTrackedMembers(db)).find((m) => m.handle === handle);
  if (!current) throw new Error(`no tracked member "${handle}"`);
  const weights = patch.weights ? MemberWeightsSchema.parse({ ...current.weights, ...patch.weights }) : current.weights;
  await db.query(
    `UPDATE vault_core.signals_source_author
        SET profile_url = $3, tracked = $4, weights = $5::jsonb,
            weights_from = CASE WHEN $6 THEN 'operator' ELSE weights_from END, updated_at = now()
      WHERE source_key = $1 AND handle = $2`,
    [MEMBERS, handle, patch.profileUrl ? memberProfileUrl(patch.profileUrl) : current.profileUrl, patch.tracked ?? current.tracked, JSON.stringify(weights), Boolean(patch.weights)],
  );
  return (await listTrackedMembers(db)).find((m) => m.handle === handle)!;
}

export type AccessCheck = { handle: string; url: string | null; result: "reachable" | "blocked" | "error" | "no_profile_url" | "skipped_backoff"; status: number | null };

/**
 * One polite request per tracked member's profile page; nothing is parsed or
 * stored. A 401/403 or a challenge page means member tracking stays off.
 */
export async function checkMemberAccess(db: Queryable, client: ClientOptions = {}): Promise<AccessCheck[]> {
  const out: AccessCheck[] = [];
  for (const m of await listTrackedMembers(db)) {
    if (!m.tracked) continue;
    if (!m.profileUrl) {
      out.push({ handle: m.handle, url: null, result: "no_profile_url", status: null });
      continue;
    }
    const got = await politeGet(db, MEMBERS, m.profileUrl, client);
    if (got.kind === "ok") {
      const challenge = /cf-challenge|cf_chl_|Just a moment\.\.\.|captcha/i.test(got.body);
      out.push({ handle: m.handle, url: m.profileUrl, result: challenge ? "blocked" : "reachable", status: got.status });
    } else if (got.kind === "backoff") {
      out.push({ handle: m.handle, url: m.profileUrl, result: "skipped_backoff", status: null });
    } else if (got.kind === "error") {
      out.push({ handle: m.handle, url: m.profileUrl, result: got.status === 401 || got.status === 403 ? "blocked" : "error", status: got.status });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offline fixture run (dry run, nothing written)

export function pokebeachFixtureReport() {
  const read = (f: string) => readFileSync(join(POKEBEACH_FIXTURE_DIR, f), "utf8");
  const home = parseHomepage(read("homepage.html"));
  const article = parseArticlePage(read("article.html"));
  const degraded = parseHomepage(read("homepage-degraded.html"));
  return {
    homepage: home.ok ? { articles: home.value.articles.length, nextPage: home.value.nextPageUrl } : { degraded: home.reason },
    article: article.ok ? { canonicalUrl: article.value.canonicalUrl, publishedAt: article.value.publishedAt } : { degraded: article.reason },
    degradedFixture: degraded.ok ? "parsed (unexpected)" : `degraded: ${degraded.reason}`,
    discovery: parseDiscoveryFeedUrls(read("community-feed.xml")),
    threads: parseForumThreads(read("forum.rss")).length,
  };
}

export function formatPokebeachReport(r: OfficialReport): string {
  return [
    `VIP Job — pokebeach ${r.mode} · status: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`,
    `pages fetched ${r.pagesFetched} · listed ${r.articlesListed} · new ${r.created} · revised ${r.revised} · seen ${r.seen}` +
      (r.skipped ? ` · skipped ${r.skipped} (blocked or backing off)` : "") +
      (r.notOnHomepage ? ` · ${r.notOnHomepage} in the community feed but not on the homepage (not created without article pages)` : "") +
      (r.threadsLinked ? ` · threads linked ${r.threadsLinked}` : ""),
    ...r.articleErrors.map((e) => `  ${e.url}: ${e.reason}`),
  ].join("\n");
}

