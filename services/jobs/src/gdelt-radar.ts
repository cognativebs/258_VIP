/**
 * GDELT radar job (B1.2–B1.12, operator decisions 2026-10-17).
 *
 * Every 10 minutes: list the minute stamps after the checkpoint (up to five minutes ago), download
 * each published minute's TOC and quadgram files, match the watch vocabulary locally, and keep only
 * the matches: one immutable snapshot per domain lane (snapshots/gdelt_v5_ngrams/<domain>/, GDELT
 * DOC JSON so the headline classifiers read it) and one source_item per new article URL. Titles and
 * links only; article pages are never fetched (operator). Full minute files are kept 7 days under
 * raw/gdelt_v5/, then deleted (operator). A missing minute older than 30 minutes is a gap GDELT
 * never filled; a missing recent one ends the run so the next run retries it.
 *
 * Watch vocabulary: stored terms (Tier D seeds, operator terms) plus, built now, Tier A (Pokémon
 * Binder owned and wishlist sets and cards), Tier B (active hunt names) and Tier C (open
 * thesis subjects). The source row gates everything (HS-5); this job never enables it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  CircuitSchema,
  GDELT_V5_BASE,
  GDELT_V5_SOURCE_KEY,
  GdeltDocAdapter,
  PUBLISH_LAG_MINUTES,
  RADAR_VERSION,
  canonicalUrl,
  compileTerms,
  dateOfStamp,
  gramIndex,
  matchBatch,
  minuteStamps,
  normalizeRadarText,
  parseToc,
  radarSnapshotJson,
  recordOutcome,
  type Circuit,
  type RadarDomain,
  type RadarMatch,
  type WatchTerm,
} from "@vip/signals";
import { saveCircuitState } from "./circuit-state.js";
import { STATE_DIR, persistFeedSnapshots } from "./espn-sports.js";
import { sourceGate } from "./pokebeach.js";
import { upsertSourceItem } from "./source-items.js";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

const USER_AGENT = "IQVault-SIGNALS/0.1 (+personal collector research; GDELT radar, one file at a time)";
const GAP_AFTER_MINUTES = 30;
const FIRST_RUN_LOOKBACK_MINUTES = 60;
const MAX_BATCHES_PER_RUN = 120;
const RAW_RETENTION_DAYS = 7;
const TIME_SOURCE = "gdelt_v5_toc:date (when GDELT saw it, not the outlet's publish time)";
/** Pokémon card and set names are often everyday words ("Dawn", "Pitch Black"): the article must say Pokémon or TCG. */
const POKEMON_CONTEXT = ["pokemon", "tcg", "trading card", "trading cards"];
/** Binder set names too generic to search alone. */
const GENERIC_SET_NAMES = new Set(["151", "base", "base4", "team up", "promos", "black star promos"]);
const CARD_SUFFIX = /\b(ex|gx|v|vmax|vstar|vunion|lv x|prime|break|tag team)\b/g;
const HUNT_NAME_NOISE = /\b(hunt|master|set|collection|run|checklist)\b/gi;

type Checkpoint = { lastStamp: string | null; circuit: Circuit };

export type RadarReport = {
  job: "gdelt-radar";
  version: typeof RADAR_VERSION;
  status: "succeeded" | "partial" | "blocked" | "failed" | "idle";
  reason: string | null;
  terms: { total: number; byTier: Record<string, number> };
  batches: { checked: number; downloaded: number; gaps: number; pendingAt: string | null };
  articles: { scanned: number; matched: number; new: number; byDomain: Record<string, number> };
  topMatches: { title: string; url: string; terms: string[] }[];
  checkpoint: string | null;
  rawDeleted: number;
};

function readCheckpoint(path: string): Checkpoint {
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as { lastStamp?: string | null; circuit?: unknown };
    return { lastStamp: c.lastStamp ?? null, circuit: CircuitSchema.parse(c.circuit ?? {}) };
  } catch {
    return { lastStamp: null, circuit: CircuitSchema.parse({}) };
  }
}

function writeCheckpoint(path: string, c: Checkpoint) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(c, null, 2));
}

async function rows(db: Queryable, sql: string, params: unknown[] = []): Promise<any[]> {
  try {
    return (await db.query(sql, params)).rows;
  } catch {
    // A tier whose table is missing contributes nothing; the radar still runs.
    return [];
  }
}

/** The watch vocabulary for this run: stored terms plus Tier A/B/C built from the Binder, hunts and theses. */
export async function buildWatchTerms(db: Queryable): Promise<WatchTerm[]> {
  const out: WatchTerm[] = [];
  for (const r of await rows(db, `SELECT term, tier, domain, priority, context_terms FROM vault_signals.signal_watch_term WHERE enabled`)) {
    out.push({ term: r.term, tier: r.tier === "operator" ? "D" : r.tier, domain: r.domain, priority: Number(r.priority), context: r.context_terms ?? [], source: `watch_term:${r.tier}` });
  }
  for (const r of await rows(db, `SELECT set_name, card_name, bool_or(owned) AS owned FROM vault_tcg.binder_slot WHERE owned OR on_wishlist GROUP BY set_name, card_name`)) {
    const set = String(r.set_name ?? "").trim();
    if (set && !GENERIC_SET_NAMES.has(normalizeRadarText(set)) && normalizeRadarText(set).length >= 4) {
      out.push({ term: set, tier: "A", domain: "collectibles", priority: r.owned ? 85 : 75, context: POKEMON_CONTEXT, source: "binder:set" });
    }
    const card = normalizeRadarText(String(r.card_name ?? "")).replace(CARD_SUFFIX, " ").replace(/\s+/g, " ").trim();
    if (card.length >= 4 && card.split(" ").length <= 4) {
      out.push({ term: card, tier: "A", domain: "collectibles", priority: r.owned ? 80 : 70, context: POKEMON_CONTEXT, source: "binder:card" });
    }
  }
  // Hunt names only: hunt sets are cover and checklist labels ("Cover A — Cloaked trio"), not news terms.
  for (const r of await rows(db, `SELECT name FROM vault_hunt.collection_hunt WHERE status = 'active'`)) {
    const name = String(r.name ?? "").replace(HUNT_NAME_NOISE, " ").replace(/\s+/g, " ").trim();
    if (normalizeRadarText(name).length >= 4) out.push({ term: name, tier: "B", domain: "collectibles", priority: 85, context: [], source: "hunt" });
  }
  for (const r of await rows(db, `SELECT domain, subject_refs FROM vault_signals.thesis WHERE status IN ('draft', 'active')`)) {
    const domain = (["collectibles", "sports_cards", "macro"].includes(r.domain) ? r.domain : "collectibles") as RadarDomain;
    for (const subject of (r.subject_refs ?? []) as string[]) {
      if (normalizeRadarText(subject).length >= 4) out.push({ term: subject, tier: "C", domain, priority: 90, context: [], source: "thesis" });
    }
  }
  // Terms longer than four words cannot match a quadgram index.
  return out.filter((t) => {
    const k = normalizeRadarText(t.term);
    return k.length >= 2 && k.split(" ").length <= 4;
  });
}

function pruneRaw(dir: string, now: Date): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (now.getTime() - statSync(p).mtimeMs > RAW_RETENTION_DAYS * 86_400_000) {
      unlinkSync(p);
      n += 1;
    }
  }
  return n;
}

async function download(fetchImpl: FetchLike, url: string): Promise<{ status: number; body: Buffer | null }> {
  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

export async function runGdeltRadar(
  db: Queryable,
  opts: { now?: Date; fetchImpl?: FetchLike; stateDir?: string; maxBatches?: number; terms?: WatchTerm[] } = {},
): Promise<RadarReport> {
  const now = opts.now ?? new Date();
  const stateDir = opts.stateDir ?? STATE_DIR;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const report: RadarReport = {
    job: "gdelt-radar",
    version: RADAR_VERSION,
    status: "idle",
    reason: null,
    terms: { total: 0, byTier: {} },
    batches: { checked: 0, downloaded: 0, gaps: 0, pendingAt: null },
    articles: { scanned: 0, matched: 0, new: 0, byDomain: {} },
    topMatches: [],
    checkpoint: null,
    rawDeleted: 0,
  };
  const gate = await sourceGate(db, GDELT_V5_SOURCE_KEY);
  if (!gate.mayRun) return { ...report, status: "blocked", reason: gate.reason };
  const base = gate.endpoint ?? GDELT_V5_BASE;

  const terms = opts.terms ?? (await buildWatchTerms(db));
  const compiled = compileTerms(terms);
  report.terms = { total: compiled.length, byTier: compiled.reduce<Record<string, number>>((m, c) => ({ ...m, [c.t.tier]: (m[c.t.tier] ?? 0) + 1 }), {}) };

  const cpPath = join(stateDir, "gdelt-v5-checkpoint.json");
  const cp = readCheckpoint(cpPath);
  const until = new Date(now.getTime() - PUBLISH_LAG_MINUTES * 60_000);
  const from = cp.lastStamp ? dateOfStamp(cp.lastStamp) : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MINUTES * 60_000);
  const stamps = minuteStamps(from, until, opts.maxBatches ?? MAX_BATCHES_PER_RUN);
  const rawDir = join(stateDir, "raw", "gdelt_v5");
  mkdirSync(rawDir, { recursive: true });
  let lastStamp = cp.lastStamp;
  let circuit = cp.circuit;
  let failure: string | null = null;

  for (const stamp of stamps) {
    report.batches.checked += 1;
    let toc: { status: number; body: Buffer | null };
    try {
      toc = await download(fetchImpl, `${base}${stamp}.toc.json.gz`);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      break;
    }
    if (toc.status === 404) {
      if (now.getTime() - dateOfStamp(stamp).getTime() > GAP_AFTER_MINUTES * 60_000) {
        report.batches.gaps += 1;
        lastStamp = stamp;
        continue;
      }
      report.batches.pendingAt = stamp;
      break;
    }
    if (!toc.body) {
      failure = `HTTP ${toc.status} for ${stamp}.toc.json.gz`;
      break;
    }
    let ngrams: { status: number; body: Buffer | null };
    try {
      ngrams = await download(fetchImpl, `${base}${stamp}.ngrams.txt.gz`);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      break;
    }
    if (!ngrams.body) {
      if (ngrams.status === 404 && now.getTime() - dateOfStamp(stamp).getTime() <= GAP_AFTER_MINUTES * 60_000) {
        report.batches.pendingAt = stamp;
        break;
      }
      report.batches.gaps += 1;
      lastStamp = stamp;
      continue;
    }
    report.batches.downloaded += 1;
    writeFileSync(join(rawDir, `${stamp}.toc.json.gz`), toc.body);
    writeFileSync(join(rawDir, `${stamp}.ngrams.txt.gz`), ngrams.body);

    const tocRows = parseToc(gunzipSync(toc.body).toString("utf8"));
    const grams = gramIndex(gunzipSync(ngrams.body).toString("utf8"), tocRows);
    report.articles.scanned += tocRows.size;
    const matches = matchBatch(tocRows, grams, compiled)
      .map((m) => ({ ...m, url: canonicalUrl(m.url) ?? "" }))
      .filter((m) => m.url.startsWith("https://"));
    report.articles.matched += matches.length;
    if (matches.length) await keepMatches(db, stamp, base, matches, report, stateDir, now);
    lastStamp = stamp;
  }

  circuit = failure ? recordOutcome(circuit, { ok: false, failureType: failure }, now) : report.batches.downloaded ? recordOutcome(circuit, { ok: true }, now) : circuit;
  writeCheckpoint(cpPath, { lastStamp, circuit });
  await saveCircuitState(db, GDELT_V5_SOURCE_KEY, base, circuit, failure ? Number(/HTTP (\d{3})/.exec(failure)?.[1] ?? 0) || null : report.batches.downloaded ? 200 : null, now).catch(() => undefined);
  report.rawDeleted = pruneRaw(rawDir, now);
  report.checkpoint = lastStamp;
  report.status = failure ? (report.batches.downloaded ? "partial" : "failed") : report.batches.downloaded || report.batches.gaps ? "succeeded" : "idle";
  report.reason = failure;
  return report;
}

/** New URLs only: one snapshot per domain lane for this minute, plus a source_item per article. */
async function keepMatches(db: Queryable, stamp: string, base: string, matches: RadarMatch[], report: RadarReport, stateDir: string, now: Date) {
  const known = new Set(
    (await db.query(`SELECT canonical_url FROM vault_signals.source_item WHERE source_id = $1 AND canonical_url = ANY($2::text[])`, [GDELT_V5_SOURCE_KEY, matches.map((m) => m.url)])).rows.map(
      (r) => r.canonical_url as string,
    ),
  );
  const fresh = matches.filter((m, i) => !known.has(m.url) && matches.findIndex((x) => x.url === m.url) === i);
  if (!fresh.length) return;
  const byDomain = new Map<RadarDomain, RadarMatch[]>();
  for (const m of fresh) byDomain.set(m.domain, [...(byDomain.get(m.domain) ?? []), m]);
  for (const [domain, list] of byDomain) {
    const adapter = new GdeltDocAdapter({ sourceId: GDELT_V5_SOURCE_KEY, snapshotDir: join(stateDir, "snapshots", GDELT_V5_SOURCE_KEY, domain), rateLimitMs: 0 });
    const url = `${base}${stamp}.toc.json.gz`;
    const snapshot = adapter.writeSnapshot(url, radarSnapshotJson(stamp, list), now);
    await persistFeedSnapshots(db as unknown as Parameters<typeof persistFeedSnapshots>[0], GDELT_V5_SOURCE_KEY, [{ url, snapshot, live: true }], { status: "succeeded", stateDir });
    const hash = createHash("sha256").update(snapshot.rawXml, "utf8").digest("hex");
    const raw = (await db.query(`SELECT id FROM vault_signals.raw_document WHERE source_id = $1 AND content_hash = $2`, [GDELT_V5_SOURCE_KEY, hash])).rows[0];
    for (const m of list) {
      const description = `GDELT radar matched: ${m.terms.map((t) => `${t.term} (${t.tier})`).join(", ")}`;
      await upsertSourceItem(
        db,
        GDELT_V5_SOURCE_KEY,
        { externalId: null, canonicalUrl: m.url, title: m.title.slice(0, 500), author: null, authorSlug: null, publishedAt: m.date ?? dateOfStamp(stamp).toISOString(), modifiedAt: null, description },
        { via: "gdelt_v5_ngrams", rawDocumentId: raw?.id ?? null, now, timeSource: TIME_SOURCE, status: "discovered", parserVersion: RADAR_VERSION },
      );
      report.articles.new += 1;
      report.articles.byDomain[domain] = (report.articles.byDomain[domain] ?? 0) + 1;
      if (report.topMatches.length < 8) report.topMatches.push({ title: m.title, url: m.url, terms: m.terms.map((t) => t.term) });
    }
  }
}

export function formatRadarReport(r: RadarReport): string {
  return [
    `VIP Job — gdelt-radar (${r.version}) · status: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`,
    `terms ${r.terms.total} (${Object.entries(r.terms.byTier).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}) · minutes checked ${r.batches.checked} · downloaded ${r.batches.downloaded} · gaps ${r.batches.gaps}${r.batches.pendingAt ? ` · waiting on ${r.batches.pendingAt}` : ""}`,
    `articles scanned ${r.articles.scanned} · matched ${r.articles.matched} · new ${r.articles.new} ${JSON.stringify(r.articles.byDomain)} · checkpoint ${r.checkpoint ?? "none"} · raw files deleted ${r.rawDeleted}`,
    ...r.topMatches.map((m) => `  · ${m.title.slice(0, 90)} [${m.terms.slice(0, 3).join(", ")}]`),
  ].join("\n");
}
