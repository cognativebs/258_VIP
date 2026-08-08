/**
 * RSS adapter for VIP signals.
 *
 * AT-13: No XML parser was present in packages/signals or services/api package.json.
 * We use a minimal tag extractor for RSS 2.0 <item> blocks instead of adding a
 * dependency — keeps the adapter swappable and tests fixture-driven. Upgrade to
 * fast-xml-parser only if feeds need namespaces/HTML entities beyond this scope.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NormalizedSignalFromRssSchema,
  RSS_ADAPTER_VERSION,
  RawRssSnapshotSchema,
  RssAdapterConfigSchema,
  type NormalizedSignalFromRss,
  type RawRssSnapshot,
  type RssAdapterConfig,
} from "../schemas/rss-adapter.js";
import type { IngestEvent } from "../pipeline.js";

type RssItem = {
  title: string;
  description: string;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
};

let lastFetchAt = 0;

function tagContent(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeXml(m[1]!.trim());
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1] ?? "";
    items.push({
      title: tagContent(block, "title") ?? "",
      description: tagContent(block, "description") ?? tagContent(block, "content:encoded") ?? "",
      link: tagContent(block, "link"),
      guid: tagContent(block, "guid"),
      pubDate: tagContent(block, "pubDate"),
    });
  }
  return items;
}

function stableId(sourceId: string, guid: string): string {
  return createHash("sha256").update(`${sourceId}:${guid}`).digest("hex").slice(0, 24);
}

function toIsoDate(pubDate: string | null, fallback: Date): string {
  if (pubDate) {
    const d = new Date(pubDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return fallback.toISOString().slice(0, 10);
}

export class RssAdapter {
  constructor(private readonly config: RssAdapterConfig) {
    RssAdapterConfigSchema.parse(config);
  }

  /** Live fetch → immutable snapshot on disk. feedUrl must come from config/env. */
  async fetchAndSnapshot(now = new Date()): Promise<RawRssSnapshot> {
    const url = this.config.feedUrl.trim();
    if (!url) {
      throw new Error("RssAdapter: feedUrl empty — set VIP_POKEMON_NEWS_RSS_URL or RSS_FEED_URL");
    }
    const elapsed = Date.now() - lastFetchAt;
    if (lastFetchAt > 0 && elapsed < this.config.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.config.rateLimitMs - elapsed));
    }
    const res = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    lastFetchAt = Date.now();
    if (!res.ok) {
      throw new Error(`RssAdapter fetch failed: ${res.status} ${res.statusText}`);
    }
    const rawXml = await res.text();
    return this.writeSnapshot(url, rawXml, now);
  }

  /** Write / re-write an immutable snapshot from known XML (tests + offline fixture). */
  writeSnapshot(url: string, rawXml: string, now = new Date()): RawRssSnapshot {
    mkdirSync(this.config.snapshotDir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const snapshotPath = join(
      this.config.snapshotDir,
      `${this.config.sourceId}-${stamp}.xml`,
    );
    writeFileSync(snapshotPath, rawXml, "utf8");
    return RawRssSnapshotSchema.parse({
      url,
      fetchedAt: now.toISOString(),
      rawXml,
      snapshotPath,
      byteLength: Buffer.byteLength(rawXml, "utf8"),
    });
  }

  /** Parse snapshot without network — regenerable from raw file alone. */
  parseSnapshot(snapshot: RawRssSnapshot): NormalizedSignalFromRss[] {
    RawRssSnapshotSchema.parse(snapshot);
    const fetchedAt = new Date(snapshot.fetchedAt);
    const items = extractItems(snapshot.rawXml);
    const out: NormalizedSignalFromRss[] = [];
    const seenGuids = new Set<string>();

    for (const item of items) {
      const guid = (item.guid || item.link || item.title || "").trim();
      if (!guid || !item.title.trim()) {
        out.push(
          NormalizedSignalFromRssSchema.parse({
            id: stableId(this.config.sourceId, `malformed-${out.length}`),
            guid: guid || `malformed-${out.length}`,
            title: item.title.trim() || "(missing title)",
            body: item.description || "Malformed RSS item — quarantined",
            sourceUrl: item.link,
            signalDate: toIsoDate(item.pubDate, fetchedAt),
            signalType: "news",
            quarantineStatus: "quarantined",
            provenance: {
              source: this.config.sourceId,
              method: "rss-parse",
              modelVersion: RSS_ADAPTER_VERSION,
              confidence: 0.1,
              verificationStatus: "quarantined",
            },
          }),
        );
        continue;
      }
      if (seenGuids.has(guid)) continue;
      seenGuids.add(guid);

      const body = (item.description || item.title).trim();
      out.push(
        NormalizedSignalFromRssSchema.parse({
          id: stableId(this.config.sourceId, guid),
          guid,
          title: item.title.trim(),
          body,
          sourceUrl: item.link,
          signalDate: toIsoDate(item.pubDate, fetchedAt),
          signalType: "news",
          quarantineStatus: "active",
          provenance: {
            source: this.config.sourceId,
            method: "rss-parse",
            modelVersion: RSS_ADAPTER_VERSION,
            confidence: 0.55,
            verificationStatus: "inferred",
          },
        }),
      );
    }
    return out;
  }

  /** Load snapshot XML from disk and parse (AT-02). */
  parseSnapshotFile(snapshotPath: string, url = "file://snapshot"): NormalizedSignalFromRss[] {
    const rawXml = readFileSync(snapshotPath, "utf8");
    const snapshot = RawRssSnapshotSchema.parse({
      url,
      fetchedAt: new Date().toISOString(),
      rawXml,
      snapshotPath,
      byteLength: Buffer.byteLength(rawXml, "utf8"),
    });
    return this.parseSnapshot(snapshot);
  }

  static toIngestEvents(signals: NormalizedSignalFromRss[]): IngestEvent[] {
    return signals
      .filter((s) => s.quarantineStatus === "active")
      .map((s) => ({
        sourceId: s.provenance.source,
        title: s.title,
        body: s.body,
        url: s.sourceUrl,
        externalId: s.guid,
        observedAt: new Date(`${s.signalDate}T12:00:00.000Z`),
      }));
  }
}

/** Reset rate-limit clock (tests). */
export function resetRssRateLimitForTests(): void {
  lastFetchAt = 0;
}
