/**
 * GDELT radar (B1, operator decisions 2026-10-17): discovery from GDELT 5's
 * downloadable Web NGrams instead of the overloaded DOC search API.
 *
 * Each published minute has two files under
 * https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams/<YYYYMMDDHHMM00>:
 *   .ngrams.txt.gz  DOCID <tab> QUADGRAM <tab> COUNT   (DOCIDs reset per file)
 *   .toc.json.gz    one JSON per line: {ID, date, img, lang, title, url}
 * Files arrive in bursts on a 15-minute heartbeat; GDELT asks for files at
 * least five minutes old. One download serves every watch term: matching is
 * local, so 100 or 10,000 terms cost the same requests.
 *
 * Pure: parsing, the 1–4-word gram index, watch-term matching and the snapshot
 * shape (GDELT DOC JSON, so the existing headline classifiers read it).
 */
import { z } from "zod";

export const GDELT_V5_SOURCE_KEY = "gdelt_v5_ngrams";
export const GDELT_V5_BASE = "https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams/";
export const RADAR_VERSION = "gdelt-radar@0.1.0";
/** GDELT: request files from at least five minutes ago. */
export const PUBLISH_LAG_MINUTES = 5;

export const RadarDomainSchema = z.enum(["collectibles", "sports_cards", "macro"]);
export type RadarDomain = z.infer<typeof RadarDomainSchema>;

export const WatchTermSchema = z
  .object({
    term: z.string().trim().min(2).max(120),
    /** A owned · B hunts · C theses · D market infrastructure · E emerging. */
    tier: z.enum(["A", "B", "C", "D", "E"]),
    domain: RadarDomainSchema,
    priority: z.number().int().min(1).max(100),
    /** For single words (and any term that sets them): at least one must appear in the same article. */
    context: z.array(z.string().trim().min(2)).default([]),
    source: z.string().min(1),
  })
  .strict();
export type WatchTerm = z.infer<typeof WatchTermSchema>;

/** Shared by single-word terms that name no context of their own. */
export const DEFAULT_CONTEXT: Record<RadarDomain, string[]> = {
  // Everyday words ("card", "set") would let "set to reopen" or "credit card" through.
  collectibles: ["tcg", "trading card", "trading cards", "collectible", "collectibles", "graded", "grading", "comic book", "comics", "booster box", "sealed", "auction"],
  sports_cards: ["rookie card", "trading card", "trading cards", "sports cards", "autograph", "memorabilia", "graded", "auction"],
  macro: ["collectibles", "trading cards", "toys", "shipping", "consumer", "retail"],
};

/** Lowercase, accents folded (Pokémon → pokemon), anything but letters and digits → one space. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Minute stamps after `fromExclusive` up to `until` (inclusive), oldest first, at most `max`. */
export function minuteStamps(fromExclusive: Date, until: Date, max = 24 * 60): string[] {
  const out: string[] = [];
  const t = new Date(fromExclusive);
  t.setUTCSeconds(0, 0);
  for (t.setUTCMinutes(t.getUTCMinutes() + 1); t <= until && out.length < max; t.setUTCMinutes(t.getUTCMinutes() + 1)) {
    out.push(stampOf(t));
  }
  return out;
}

export const stampOf = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 12) + "00";
export const dateOfStamp = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00Z`);

const TocRowSchema = z
  .object({ ID: z.coerce.number().int(), date: z.string().optional(), lang: z.string().optional(), title: z.string().optional(), url: z.string().optional() })
  .passthrough();
export type TocRow = { id: number; date: string | null; lang: string | null; title: string; url: string };

/** JSON lines; rows without an http(s) URL or a title are skipped. */
export function parseToc(jsonl: string): Map<number, TocRow> {
  const out = new Map<number, TocRow>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const p = TocRowSchema.safeParse(raw);
    if (!p.success) continue;
    const url = p.data.url?.trim() ?? "";
    const title = p.data.title?.trim() ?? "";
    if (!/^https?:\/\//.test(url) || !title) continue;
    out.set(p.data.ID, { id: p.data.ID, date: p.data.date ?? null, lang: p.data.lang ?? null, title, url });
  }
  return out;
}

function addGrams(words: string[], into: Set<string>) {
  for (let i = 0; i < words.length; i++) {
    let g = "";
    for (let n = 0; n < 4 && i + n < words.length; n++) {
      g = n ? `${g} ${words[i + n]}` : words[i]!;
      into.add(g);
    }
  }
}

/**
 * Every 1–4-word gram of each document (from its quadgrams and its TOC title), so a
 * watch term of up to four words is one set lookup. Documents not in `toc` are skipped.
 */
export function gramIndex(ngramsTsv: string, toc: ReadonlyMap<number, TocRow>): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const [id, row] of toc) {
    const set = new Set<string>();
    addGrams(normalizeText(row.title).split(" ").filter(Boolean), set);
    out.set(id, set);
  }
  let start = 0;
  while (start < ngramsTsv.length) {
    let end = ngramsTsv.indexOf("\n", start);
    if (end < 0) end = ngramsTsv.length;
    const line = ngramsTsv.slice(start, end);
    start = end + 1;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const set = out.get(Number(line.slice(0, tab)));
    if (!set) continue;
    const tab2 = line.indexOf("\t", tab + 1);
    addGrams(normalizeText(tab2 < 0 ? line.slice(tab + 1) : line.slice(tab + 1, tab2)).split(" ").filter(Boolean), set);
  }
  return out;
}

export type RadarMatch = {
  docId: number;
  url: string;
  title: string;
  date: string | null;
  lang: string | null;
  domain: RadarDomain;
  /** Highest-priority term first. */
  terms: { term: string; tier: WatchTerm["tier"]; domain: RadarDomain; priority: number }[];
  /** 0–1: best term priority, nudged up by more distinct matched terms. Discovery confidence, not signal confidence. */
  discoveryConfidence: number;
};

type Compiled = { key: string; words: number; context: string[]; t: WatchTerm };

/** Dedupe terms by (normalized text, domain), keeping the highest priority; compile context. */
export function compileTerms(terms: ReadonlyArray<WatchTerm>): Compiled[] {
  const best = new Map<string, Compiled>();
  for (const t of terms) {
    const key = normalizeText(t.term);
    if (!key || key.split(" ").length > 4) continue;
    const words = key.split(" ").length;
    const own = t.context.map(normalizeText).filter(Boolean);
    const context = own.length ? own : words === 1 ? DEFAULT_CONTEXT[t.domain].map(normalizeText) : [];
    const id = `${key}|${t.domain}`;
    const prev = best.get(id);
    if (!prev || prev.t.priority < t.priority) best.set(id, { key, words, context, t });
  }
  return [...best.values()];
}

export function matchBatch(toc: ReadonlyMap<number, TocRow>, grams: ReadonlyMap<number, Set<string>>, terms: ReadonlyArray<Compiled>): RadarMatch[] {
  const out: RadarMatch[] = [];
  for (const [id, set] of grams) {
    const hits = terms.filter((c) => set.has(c.key) && (!c.context.length || c.context.some((k) => set.has(k))));
    if (!hits.length) continue;
    const row = toc.get(id)!;
    const sorted = hits.map((h) => h.t).sort((a, b) => b.priority - a.priority || a.term.localeCompare(b.term));
    const distinct = new Set(sorted.map((t) => normalizeText(t.term))).size;
    out.push({
      docId: id,
      url: row.url,
      title: row.title,
      date: row.date,
      lang: row.lang,
      domain: sorted[0]!.domain,
      terms: sorted.map((t) => ({ term: t.term, tier: t.tier, domain: t.domain, priority: t.priority })),
      discoveryConfidence: Math.min(0.95, Math.round((sorted[0]!.priority / 100 + 0.05 * (distinct - 1)) * 100) / 100),
    });
  }
  return out.sort((a, b) => b.discoveryConfidence - a.discoveryConfidence || a.docId - b.docId);
}

/** Lowercase host, no fragment, common tracking parameters dropped. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|ocid$|cmpid$)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

/** GDELT DOC JSON (what GdeltDocAdapter.parseSnapshot reads) plus the radar's own match record per article. */
export function radarSnapshotJson(stamp: string, matches: ReadonlyArray<RadarMatch>): string {
  const seendate = `${stamp.slice(0, 8)}T${stamp.slice(8, 14)}Z`;
  return JSON.stringify(
    {
      radar: { version: RADAR_VERSION, batch: stamp, source: GDELT_V5_SOURCE_KEY },
      articles: matches.map((m) => {
        let domain: string | undefined;
        try {
          domain = new URL(m.url).hostname.replace(/^www\./, "");
        } catch {
          domain = undefined;
        }
        return {
          url: m.url,
          title: m.title,
          seendate,
          domain,
          language: m.lang ?? undefined,
          gdeltDocId: m.docId,
          matchedTerms: m.terms,
          discoveryConfidence: m.discoveryConfidence,
        };
      }),
    },
    null,
    2,
  );
}
