import { z } from "zod";

/**
 * Tighten eBay Browse queries so LIVE ranges reflect the book on the shelf,
 * not every listing that shares a publisher or a loose keyword.
 *
 * Browse is still active asks · unverified. This module never writes
 * vault_market.sale and never treats a match as a sold comp.
 */
export const COMIC_BROWSE_RULE = "ebay-sold@0.2.0";

/** Comic Books & Memorabilia — Browse searches this tree and its leaves. */
export const COMIC_BROWSE_CATEGORY_IDS = "63";

const SERIES_STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "vol",
  "vol.",
  "volume",
  "pt",
  "part",
]);

const REJECT_TITLE =
  /\b(lot of|lots? of \d|complete (run|set)|omnibus|hardcover|\bhc\b|tpb|trade paperback|box set|run of|graphic novel collection|bound volume)\b/i;

export const ComicIssueKeySchema = z.object({
  raw: z.string(),
  number: z.string().min(1),
  variant: z.string().nullable(),
});
export type ComicIssueKey = z.infer<typeof ComicIssueKeySchema>;

export const ComicBrowseQuerySchema = z.object({
  q: z.string().min(1),
  seriesTokens: z.array(z.string().min(1)),
  issue: ComicIssueKeySchema,
  categoryIds: z.literal(COMIC_BROWSE_CATEGORY_IDS),
  ruleOrModelVersion: z.literal(COMIC_BROWSE_RULE),
});
export type ComicBrowseQuery = z.infer<typeof ComicBrowseQuerySchema>;

export function parseComicIssue(raw: string): ComicIssueKey | null {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/#?\s*(\d+)\s*([A-Za-z])?/);
  if (!match?.[1]) return null;
  const variant = match[2] ? match[2].toUpperCase() : null;
  return ComicIssueKeySchema.parse({
    raw: text,
    number: String(Number(match[1])),
    variant,
  });
}

/** Drop volume suffixes so "Action Comics, Vol. 1" searches as Action Comics. */
export function seriesSearchName(series: string): string {
  return series
    .replace(/[,:]?\s*(vol\.?|volume)\s*\d+[a-z]?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function seriesMatchTokens(series: string, issueNumber?: string): string[] {
  const tokens = seriesSearchName(series)
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !SERIES_STOP.has(t));
  const issue = issueNumber?.toLowerCase();
  return [...new Set(tokens.filter((t) => t !== issue))];
}

export function buildComicBrowseQuery(input: {
  series: string;
  issue: string;
}): ComicBrowseQuery | null {
  const issue = parseComicIssue(input.issue);
  const series = seriesSearchName(input.series);
  if (!issue || !series) return null;
  const seriesTokens = seriesMatchTokens(series, issue.number);
  if (!seriesTokens.length) return null;
  return ComicBrowseQuerySchema.parse({
    q: `${series} #${issue.number}`,
    seriesTokens,
    issue,
    categoryIds: COMIC_BROWSE_CATEGORY_IDS,
    ruleOrModelVersion: COMIC_BROWSE_RULE,
  });
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleHasIssue(title: string, issue: ComicIssueKey): boolean {
  const n = issue.number;
  const compact = normalizeTitle(title);
  if (issue.variant) {
    const letter = issue.variant.toLowerCase();
    if (new RegExp(`(?:#|no\\.?|issue)\\s*0*${n}\\s*${letter}\\b`).test(compact)) return true;
    if (new RegExp(`\\b${n}\\s*${letter}\\b`).test(compact)) return true;
  }
  if (new RegExp(`(?:#|no\\.?|issue)\\s*0*${n}\\b`).test(compact)) return true;
  // Distinctive issue numbers can stand alone. Single-digit issues cannot —
  // "vol 1" and "Amazing Spider-Man 101" would otherwise match issue 1.
  if (n.length >= 2 && new RegExp(`\\b${n}\\b`).test(compact)) return true;
  return false;
}

function titleHasSeries(title: string, tokens: string[]): boolean {
  const compact = normalizeTitle(title).replace(/-/g, "");
  return tokens.every((token) => compact.includes(token.replace(/-/g, "")));
}

/**
 * Keep a Browse hit only when the title names this series and issue and is
 * not a lot / omnibus / TPB. Variant letter is a confidence boost, not a gate.
 */
export function listingTitleMatchesComic(title: string | undefined, query: ComicBrowseQuery): boolean {
  if (!title?.trim()) return false;
  if (REJECT_TITLE.test(title)) return false;
  if (!titleHasSeries(title, query.seriesTokens)) return false;
  return titleHasIssue(title, query.issue);
}

export function comicBrowseConfidence(title: string, query: ComicBrowseQuery): number {
  let confidence = 0.55;
  const compact = normalizeTitle(title);
  if (query.issue.variant && new RegExp(`\\b${query.issue.number}\\s*${query.issue.variant.toLowerCase()}\\b`).test(compact)) {
    confidence += 0.1;
  }
  return Math.min(0.75, confidence);
}
