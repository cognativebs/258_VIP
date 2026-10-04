/**
 * PokéBeach parsers (pure, no network). Identity and time come only from the
 * article page: <link rel="canonical">, the WordPress post id (shortlink
 * ?p=NNN), and article:published_time / modified_time (UTC). The homepage's
 * "Oct 2, 2026 at 10:00 AM" carries no timezone and is never stored as a time.
 * Discovery feeds only point at articles: the community front-page feed labels
 * Pacific time as GMT, and the forum RSS dates threads by their last reply.
 *
 * A parse that cannot find the fields it needs returns degraded instead of
 * partial data, so a markup change never ingests malformed items.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const POKEBEACH_PARSER_VERSION = "pokebeach-parser@0.1.0";
export const POKEBEACH_ORIGIN = "https://www.pokebeach.com";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
};

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const text = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** https, lowercase host, no query/fragment, no trailing slash. Only pokebeach.com/YYYY/MM/slug articles. */
export function canonicalArticleUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(decodeHtml(raw.trim()), POKEBEACH_ORIGIN);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "pokebeach.com") return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!/^\/\d{4}\/\d{2}\/[a-z0-9%_-]+$/i.test(path)) return null;
  return `https://www.pokebeach.com${path.toLowerCase()}`;
}

export const HomepageArticleSchema = z
  .object({
    postId: z.string().regex(/^\d+$/),
    canonicalUrl: z.string().url(),
    title: z.string().min(1),
    author: z.string().min(1),
    authorSlug: z.string().min(1).nullable(),
    /** As displayed, no timezone. Kept for diagnostics only; never stored as published_at. */
    displayedTime: z.string().nullable(),
    commentCount: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type HomepageArticle = z.infer<typeof HomepageArticleSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; degraded: true; reason: string };

export function parseHomepage(html: string): ParseResult<{ articles: HomepageArticle[]; nextPageUrl: string | null }> {
  const blocks = [...html.matchAll(/<article\b[^>]*\bid="post-(\d+)"[^>]*>([\s\S]*?)<\/article>/g)];
  if (blocks.length === 0) return { ok: false, degraded: true, reason: "no <article id=\"post-N\"> blocks" };
  const articles: HomepageArticle[] = [];
  for (const [, postId, body] of blocks) {
    const titleLink = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(body!);
    const author = /<a[^>]*class="article__author"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(body!);
    const time = /<span class="screen-reader-text">Posted on<\/span>\s*<a[^>]*>([^<]+)<\/a>/.exec(body!);
    const comments = /#comments"[^>]*>\s*([\d,]+)\s+Comments?/.exec(body!);
    const url = canonicalArticleUrl(titleLink?.[1]);
    const parsed = HomepageArticleSchema.safeParse({
      postId,
      canonicalUrl: url,
      title: titleLink ? text(titleLink[2]!) : "",
      author: author ? text(author[2]!) : "",
      authorSlug: author ? (/\/author\/([^/"]+)/.exec(author[1]!)?.[1] ?? null) : null,
      displayedTime: time ? text(time[1]!) : null,
      commentCount: comments ? Number(comments[1]!.replace(/,/g, "")) : null,
    });
    if (!parsed.success) {
      return { ok: false, degraded: true, reason: `post-${postId}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")} missing or invalid` };
    }
    articles.push(parsed.data);
  }
  const next = /<a href="([^"]+)" class="pageNav-jump pageNav-jump--next">/.exec(html)?.[1] ?? null;
  return { ok: true, value: { articles, nextPageUrl: next ? decodeHtml(next) : null } };
}

export const ArticlePageSchema = z
  .object({
    postId: z.string().regex(/^\d+$/),
    canonicalUrl: z.string().url(),
    title: z.string().min(1),
    author: z.string().min(1),
    authorSlug: z.string().min(1).nullable(),
    publishedAt: z.string().datetime({ offset: true }),
    modifiedAt: z.string().datetime({ offset: true }).nullable(),
    /** The publisher's own summary (meta description). Article bodies are not stored. */
    description: z.string().nullable(),
  })
  .strict();
export type ArticlePage = z.infer<typeof ArticlePageSchema>;

const meta = (html: string, attr: "property" | "name", key: string) =>
  new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`, "i").exec(html)?.[1] ?? null;

export function parseArticlePage(html: string): ParseResult<ArticlePage> {
  const canonical = canonicalArticleUrl(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]);
  const postId = /<link rel=['"]shortlink['"] href=['"][^'"]*\?p=(\d+)['"]/.exec(html)?.[1];
  const h1 = /<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  const ogTitle = meta(html, "property", "og:title");
  const author = /<a[^>]*class="article__author"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  const description = meta(html, "name", "description") ?? meta(html, "property", "og:description");
  const parsed = ArticlePageSchema.safeParse({
    postId,
    canonicalUrl: canonical,
    title: h1 ? text(h1) : ogTitle ? text(ogTitle).replace(/\s+-\s+PokeBeach$/i, "") : "",
    author: author ? text(author[2]!) : "",
    authorSlug: author ? (/\/author\/([^/"]+)/.exec(author[1]!)?.[1] ?? null) : null,
    publishedAt: meta(html, "property", "article:published_time"),
    modifiedAt: meta(html, "property", "article:modified_time"),
    description: description ? text(description) : null,
  });
  if (!parsed.success) {
    return { ok: false, degraded: true, reason: parsed.error.issues.map((i) => `${i.path.join(".")} missing or invalid`).join(", ") };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Material content for revision detection: title, author, publish time, the
 * publisher's summary. Comment counts, modified_time and discovery route are
 * excluded, so they never create a new revision.
 */
export function articleContentHash(a: Pick<ArticlePage, "title" | "author" | "publishedAt" | "description">): string {
  const norm = (s: string | null) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update([norm(a.title), norm(a.author), new Date(a.publishedAt).toISOString(), norm(a.description)].join("␟"))
    .digest("hex");
}

/** Community front-page feed: discovery only. Its dates are not trusted and not returned. */
export function parseDiscoveryFeedUrls(xml: string): string[] {
  const out = new Set<string>();
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const url = canonicalArticleUrl(/<link>([\s\S]*?)<\/link>/.exec(block!)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, ""));
    if (url) out.add(url);
  }
  return [...out];
}

export type ForumThread = { threadId: string; title: string; url: string };

/** Forum RSS: each article has a comment thread with the same title. Used to link threads, never to create articles. */
export function parseForumThreads(xml: string): ForumThread[] {
  const out: ForumThread[] = [];
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(block!)?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(block!)?.[1];
    const id = /\.(\d+)\/?$/.exec(link ?? "")?.[1] ?? /<guid[^>]*>(\d+)<\/guid>/.exec(block!)?.[1];
    if (title && link && id) out.push({ threadId: id, title: text(title.replace(/<!\[CDATA\[|\]\]>/g, "")), url: decodeHtml(link.trim()) });
  }
  return out;
}

/** Title key for matching a forum thread to its article: case, punctuation and quote style ignored. */
export function titleKey(title: string): string {
  return decodeHtml(title)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
