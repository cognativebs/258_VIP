/**
 * Source items for any news source: one row per canonical URL (and the
 * source's own id), with append-only revisions. The indexer turns stored feed
 * snapshots (RSS/Atom, GDELT JSON) into items so entities and clusters work
 * across outlets. Feed-provided times are labeled with where they came from;
 * an item without a usable time keeps published_at NULL and clusters on when
 * it was first seen.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { GdeltDocAdapter, RssAdapter, normalizeSignalUrl } from "@vip/signals";
import { STATE_DIR } from "./espn-sports.js";
import { snapshotPathFor } from "./sports-classifier.js";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type UpsertResult = "created" | "revised" | "seen";

export const SOURCE_ITEM_INDEXER_VERSION = "source-item-indexer@0.1.0";

export type SourceItemInput = {
  externalId: string | null;
  canonicalUrl: string;
  title: string;
  author: string | null;
  authorSlug: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  description: string | null;
};

/** Material content only (title, author, publish time, summary); comment counts and routes never revise. */
export function sourceItemContentHash(i: Pick<SourceItemInput, "title" | "author" | "publishedAt" | "description">): string {
  const norm = (s: string | null) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update([norm(i.title), norm(i.author), i.publishedAt ? new Date(i.publishedAt).toISOString() : "", norm(i.description)].join("␟"))
    .digest("hex");
}

export async function upsertSourceItem(
  db: Queryable,
  sourceKey: string,
  item: SourceItemInput,
  opts: {
    via: string;
    rawDocumentId: string | null;
    now: Date;
    timeSource: string | null;
    status: "confirmed" | "discovered";
    parserVersion: string;
    hash?: string;
  },
): Promise<UpsertResult> {
  const hash = opts.hash ?? sourceItemContentHash(item);
  const excerpt = item.description ? item.description.slice(0, 600) : null;
  const found = await db.query(
    `SELECT id, content_hash FROM vault_signals.source_item
      WHERE source_id = $1 AND (canonical_url = $2 OR (item_kind = 'article' AND external_id = $3))
      ORDER BY (external_id IS NOT DISTINCT FROM $3) DESC LIMIT 1`,
    [sourceKey, item.canonicalUrl, item.externalId],
  );
  const existing = found.rows[0];
  if (!existing) {
    const ins = await db.query(
      `INSERT INTO vault_signals.source_item (
         source_id, item_kind, external_id, canonical_url, title, author_name, author_ref,
         published_at, published_at_source, modified_at, excerpt, content_hash, status,
         first_seen_at, last_seen_at, discovered_via, parser_version
       ) VALUES ($1, 'article', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, ARRAY[$14], $15)
       RETURNING id`,
      [
        sourceKey,
        item.externalId,
        item.canonicalUrl,
        item.title,
        item.author,
        item.authorSlug,
        item.publishedAt,
        item.publishedAt ? opts.timeSource : null,
        item.modifiedAt,
        excerpt,
        hash,
        opts.status,
        opts.now,
        opts.via,
        opts.parserVersion,
      ],
    );
    await db.query(
      `INSERT INTO vault_signals.source_item_revision
         (source_item_id, observed_at, raw_document_id, content_hash, title, author_name, published_at, excerpt, change_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'initial')`,
      [ins.rows[0].id, opts.now, opts.rawDocumentId, hash, item.title, item.author, item.publishedAt, excerpt],
    );
    return "created";
  }
  const revised = existing.content_hash !== hash;
  await db.query(
    `UPDATE vault_signals.source_item
        SET last_seen_at = greatest(last_seen_at, $2),
            discovered_via = CASE WHEN $3 = ANY(discovered_via) THEN discovered_via ELSE array_append(discovered_via, $3) END,
            modified_at = coalesce($4, modified_at),
            canonical_url = $5,
            title = CASE WHEN $6 THEN $7 ELSE title END,
            author_name = CASE WHEN $6 THEN $8 ELSE author_name END,
            published_at = CASE WHEN $6 THEN $9::timestamptz ELSE published_at END,
            excerpt = CASE WHEN $6 THEN $10 ELSE excerpt END,
            content_hash = $11,
            revision_count = revision_count + CASE WHEN $6 THEN 1 ELSE 0 END
      WHERE id = $1`,
    [existing.id, opts.now, opts.via, item.modifiedAt, item.canonicalUrl, revised, item.title, item.author, item.publishedAt, excerpt, hash],
  );
  if (revised) {
    await db.query(
      `INSERT INTO vault_signals.source_item_revision
         (source_item_id, observed_at, raw_document_id, content_hash, title, author_name, published_at, excerpt, change_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'material')`,
      [existing.id, opts.now, opts.rawDocumentId, hash, item.title, item.author, item.publishedAt, excerpt],
    );
  }
  return revised ? "revised" : "seen";
}

/** Feeds the indexer reads, and which GDELT lanes count (only business news is collectibles-relevant). */
export const INDEXED_FEED_SOURCES = ["comicsbeat_rss", "alpha_investments_youtube", "psa_news", "tag_news", "gdelt_doc_v2"] as const;
const GDELT_LANES = new Set(["business"]);

export type IndexReport = {
  job: "source-item-index";
  version: typeof SOURCE_ITEM_INDEXER_VERSION;
  documents: number;
  missingSnapshot: number;
  created: number;
  revised: number;
  seen: number;
  skipped: number;
};

/**
 * Re-reads stored snapshots fetched in the last `days` and upserts their
 * items. Idempotent: an unchanged item is only touched.
 */
export async function indexFeedItems(
  db: Queryable,
  opts: { sourceKeys?: ReadonlyArray<string>; days?: number; stateDir?: string; now?: Date } = {},
): Promise<IndexReport> {
  const now = opts.now ?? new Date();
  const stateDir = opts.stateDir ?? STATE_DIR;
  const report: IndexReport = { job: "source-item-index", version: SOURCE_ITEM_INDEXER_VERSION, documents: 0, missingSnapshot: 0, created: 0, revised: 0, seen: 0, skipped: 0 };
  const docs = await db.query(
    `SELECT d.id, d.source_id, d.fetched_at, d.source_url, s.storage_key
       FROM vault_signals.raw_document d
       JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id
      WHERE d.source_id = ANY($1::text[]) AND d.fetched_at > $2
      ORDER BY d.fetched_at, d.id`,
    [opts.sourceKeys ?? INDEXED_FEED_SOURCES, new Date(now.getTime() - (opts.days ?? 7) * 86_400_000)],
  );
  for (const doc of docs.rows) {
    const sourceKey: string = doc.source_id;
    const lane = /snapshots\/[^/]+\/([a-z0-9_]+)\/[^/]+$/.exec(doc.storage_key)?.[1] ?? null;
    if (sourceKey === "gdelt_doc_v2" && !GDELT_LANES.has(lane ?? "")) continue;
    const path = snapshotPathFor(doc.storage_key, stateDir);
    if (!existsSync(path)) {
      report.missingSnapshot += 1;
      continue;
    }
    report.documents += 1;
    const raw = readFileSync(path, "utf8");
    const fetchedAt = new Date(doc.fetched_at).toISOString();
    const snap = { url: doc.source_url, fetchedAt, rawXml: raw, snapshotPath: path, byteLength: Buffer.byteLength(raw, "utf8") };
    const parsed =
      sourceKey === "gdelt_doc_v2"
        ? new GdeltDocAdapter({ sourceId: sourceKey, snapshotDir: stateDir, rateLimitMs: 0 }).parseSnapshot(snap).map((i) => ({
            guid: i.guid,
            title: i.title,
            link: i.sourceUrl,
            description: null as string | null,
            publishedAt: i.seenAt,
            timeSource: "gdelt:seendate (first seen by GDELT)",
            status: "discovered" as const,
            active: i.quarantineStatus === "active",
          }))
        : new RssAdapter({ feedUrl: "", sourceId: sourceKey, rateLimitMs: 0, snapshotDir: stateDir }).parseSnapshot(snap).map((i) => ({
            guid: i.guid,
            title: i.title,
            link: i.sourceUrl,
            description: i.body && i.body !== i.title ? i.body : null,
            publishedAt: i.publishedAt ?? null,
            timeSource: "feed:pubDate",
            status: i.publishedAt ? ("confirmed" as const) : ("discovered" as const),
            active: i.quarantineStatus === "active",
          }));
    for (const p of parsed) {
      const canonical = p.link ? normalizeSignalUrl(p.link, "canonical") : null;
      if (!p.active || !canonical || !/^https:\/\//.test(canonical)) {
        report.skipped += 1;
        continue;
      }
      const result = await upsertSourceItem(
        db,
        sourceKey,
        {
          externalId: p.guid.length <= 500 ? p.guid : null,
          canonicalUrl: canonical,
          title: p.title,
          author: null,
          authorSlug: null,
          publishedAt: p.publishedAt,
          modifiedAt: null,
          description: p.description,
        },
        { via: lane ? `feed:${lane}` : "feed", rawDocumentId: doc.id, now, timeSource: p.timeSource, status: p.status, parserVersion: SOURCE_ITEM_INDEXER_VERSION },
      );
      report[result] += 1;
    }
  }
  return report;
}

export function formatIndexReport(r: IndexReport): string {
  return [
    `VIP Job — source-item index (${r.version})`,
    `documents ${r.documents}${r.missingSnapshot ? ` (+${r.missingSnapshot} missing snapshot; set VIP_JOBS_STATE_DIR)` : ""} · new ${r.created} · revised ${r.revised} · seen ${r.seen} · skipped ${r.skipped}`,
  ].join("\n");
}
