/**
 * GDELT DOC 2.0 article-list adapter. One request per lane query
 * (mode=ArtList, format=json); the raw JSON is kept as an immutable,
 * content-addressed snapshot and parsed into headline items (title, outlet
 * link, seen date). GDELT carries no summaries and no article bodies; this
 * adapter never fetches the article pages. Rate: GDELT asks for at most one
 * request every 5 seconds.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RawRssSnapshot } from "../schemas/rss-adapter.js";

export const GDELT_DOC_ADAPTER_VERSION = "signals@gdelt-doc-v1";

export const GdeltLaneQuerySchema = z
  .object({
    lane: z.string().regex(/^[a-z][a-z0-9_]*$/),
    query: z.string().min(3).max(1500),
  })
  .strict();
export type GdeltLaneQuery = z.infer<typeof GdeltLaneQuerySchema>;

const GdeltArticleSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().optional(),
    seendate: z.string().optional(),
    domain: z.string().optional(),
    language: z.string().optional(),
    sourcecountry: z.string().optional(),
  })
  .passthrough();

const GdeltResponseSchema = z.object({ articles: z.array(GdeltArticleSchema).optional() }).passthrough();

export type GdeltItem = {
  guid: string;
  title: string;
  body: string;
  sourceUrl: string | null;
  signalDate: string;
  outlet: string | null;
  quarantineStatus: "active" | "quarantined";
};

let lastFetchAt = 0;

export function resetGdeltRateLimitForTests() {
  lastFetchAt = 0;
}

export function gdeltRequestUrl(endpoint: string, q: GdeltLaneQuery, opts: { maxRecords?: number; timespan?: string } = {}) {
  const u = new URL(endpoint);
  u.searchParams.set("query", GdeltLaneQuerySchema.parse(q).query);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("format", "json");
  u.searchParams.set("maxrecords", String(opts.maxRecords ?? 75));
  u.searchParams.set("timespan", opts.timespan ?? "24h");
  u.searchParams.set("sort", "DateDesc");
  return u.toString();
}

/** "20261001T121500Z" → "2026-10-01". */
function seenDate(seendate: string | undefined, fallback: Date): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(seendate ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : fallback.toISOString().slice(0, 10);
}

export class GdeltDocAdapter {
  constructor(
    private readonly config: { sourceId: string; snapshotDir: string; rateLimitMs: number },
  ) {}

  /** Same immutable, content-addressed layout as RssAdapter (a byte-identical response reuses its file). */
  writeSnapshot(url: string, rawJson: string, now = new Date()): RawRssSnapshot {
    mkdirSync(this.config.snapshotDir, { recursive: true });
    const hash = createHash("sha256").update(rawJson, "utf8").digest("hex");
    const snapshotPath = join(this.config.snapshotDir, `${this.config.sourceId}-${hash.slice(0, 32)}.json`);
    try {
      writeFileSync(snapshotPath, rawJson, { encoding: "utf8", flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    return { url, fetchedAt: now.toISOString(), rawXml: rawJson, snapshotPath, byteLength: Buffer.byteLength(rawJson, "utf8") };
  }

  async fetchAndSnapshot(url: string, now = new Date()): Promise<RawRssSnapshot> {
    const elapsed = Date.now() - lastFetchAt;
    if (lastFetchAt > 0 && elapsed < this.config.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.config.rateLimitMs - elapsed));
    }
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    lastFetchAt = Date.now();
    if (!res.ok) throw new Error(`GDELT fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.text();
    // GDELT answers query errors with plain text; never store those as evidence.
    try {
      GdeltResponseSchema.parse(JSON.parse(body));
    } catch {
      throw new Error(`GDELT returned a non-JSON answer: ${body.slice(0, 160)}`);
    }
    return this.writeSnapshot(url, body, now);
  }

  /** Regenerable from the raw file alone. Articles without a URL or title are quarantined, not dropped. */
  parseSnapshot(snapshot: Pick<RawRssSnapshot, "rawXml" | "fetchedAt">): GdeltItem[] {
    const parsed = GdeltResponseSchema.parse(JSON.parse(snapshot.rawXml || "{}"));
    const fetchedAt = new Date(snapshot.fetchedAt);
    const seen = new Set<string>();
    const out: GdeltItem[] = [];
    (parsed.articles ?? []).forEach((a, i) => {
      const url = a.url?.trim() || null;
      const title = a.title?.trim() || "";
      if (!url || !title) {
        out.push({
          guid: `malformed-${i}`,
          title: title || "(missing title)",
          body: "Malformed GDELT article — quarantined",
          sourceUrl: url,
          signalDate: seenDate(a.seendate, fetchedAt),
          outlet: a.domain ?? null,
          quarantineStatus: "quarantined",
        });
        return;
      }
      if (seen.has(url)) return;
      seen.add(url);
      out.push({
        // event_evidence.item_ref holds at most 1024 bytes.
        guid: url.length <= 1000 ? url : `sha256:${createHash("sha256").update(url, "utf8").digest("hex")}`,
        title,
        // GDELT has no summary; the outlet is the honest context.
        body: a.domain ? `${title} (${a.domain})` : title,
        sourceUrl: url,
        signalDate: seenDate(a.seendate, fetchedAt),
        outlet: a.domain ?? null,
        quarantineStatus: "active",
      });
    });
    return out;
  }
}
