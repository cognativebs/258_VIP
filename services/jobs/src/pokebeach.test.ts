import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POKEBEACH_FIXTURE_DIR,
  checkMemberAccess,
  listTrackedMembers,
  memberProfileUrl,
  politeGet,
  pokebeachFixtureReport,
  runPokebeachDiscovery,
  runPokebeachOfficial,
  runPokebeachReconcile,
  updateTrackedMember,
  type FetchImpl,
} from "./pokebeach.js";

const DSN = process.env.IQVAULT_TEST_DSN;
const NOW = new Date("2026-10-03T12:00:00.000Z");
const fixture = (f: string) => readFileSync(join(POKEBEACH_FIXTURE_DIR, f), "utf8");

const HOME = "https://www.pokebeach.com/";
const STORM = "https://www.pokebeach.com/2026/10/fixture-storm-elite-trainer-box-revealed";
const DECK = "https://www.pokebeach.com/2026/10/fixture-deck-strategy";
const MISSED = "https://www.pokebeach.com/2026/09/fixture-missed-article";
const COMMUNITY = "https://kaprestridge.github.io/pokebeach-news-feed/feed.xml";
const FORUM = "https://www.pokebeach.com/forums/forum/-/index.rss";

const missedArticle = () =>
  fixture("article.html")
    .replaceAll(STORM, MISSED)
    .replace("?p=900001", "?p=899999")
    .replaceAll("&#8220;Fixture Storm&#8221; Elite Trainer Box Revealed!", "Fixture Missed Article")
    .replace("2026-10-02T18:14:10+00:00", "2026-09-30T16:00:00+00:00");

type Route = { status: number; body?: string; etag?: string };

/** Serves fixtures by URL; answers 304 when the client sends a matching If-None-Match. */
function fakeSite(routes: Record<string, Route | (() => Route)>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const entry = routes[url];
    const route = typeof entry === "function" ? entry() : entry;
    if (!route) return new Response("not found", { status: 404 });
    if (route.etag && init.headers["If-None-Match"] === route.etag) return new Response(null, { status: 304 });
    return new Response(route.body ?? "", { status: route.status, headers: route.etag ? { etag: route.etag } : {} });
  };
  return { impl, calls };
}

const client = (impl: FetchImpl) => ({ fetchImpl: impl, minGapMs: 0, now: () => NOW });

afterEach(() => vi.restoreAllMocks());

describe("pokebeach offline", () => {
  it("parses every fixture and flags the degraded one", () => {
    const r = pokebeachFixtureReport();
    expect(r.homepage).toEqual({ articles: 2, nextPage: "https://www.pokebeach.com/page/2" });
    expect(r.article).toEqual({ canonicalUrl: STORM, publishedAt: "2026-10-02T18:14:10+00:00" });
    expect(r.degradedFixture).toMatch(/^degraded:/);
    expect(r.threads).toBe(2);
  });

  it("accepts only PokéBeach member profile URLs", () => {
    expect(memberProfileUrl("https://pokebeach.com/forums/members/the-kaiser.12345")).toBe(
      "https://www.pokebeach.com/forums/members/the-kaiser.12345/",
    );
    expect(() => memberProfileUrl("https://www.pokebeach.com/forums/whats-new/news-feed")).toThrow();
    expect(() => memberProfileUrl("http://www.pokebeach.com/forums/members/x.1/")).toThrow();
  });
});

async function inTransaction(fn: (db: PoolClient) => Promise<void>) {
  const pool = new Pool({ connectionString: DSN });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

const enable = (db: PoolClient, key: string, endpoint?: string) =>
  db.query(
    `UPDATE vault_core.signals_news_source
        SET adapter_enabled = true, is_active = true, verify_before_first_run = false, blocked_reason = NULL,
            endpoint = coalesce($2, endpoint)
      WHERE source_key = $1`,
    [key, endpoint ?? null],
  );

describe.skipIf(!DSN)("pokebeach connector (IQVAULT_TEST_DSN, rolled back)", () => {
  it("is blocked, with no request, until an operator enables pokebeach_official", async () => {
    await inTransaction(async (db) => {
      const site = fakeSite({});
      const r = await runPokebeachOfficial(db, client(site.impl));
      expect(r.status).toBe("blocked");
      expect(site.calls).toHaveLength(0);
    });
  });

  it("ingests each article once with its UTC time; a degraded page ingests nothing; an unchanged homepage is a 304", async () => {
    await inTransaction(async (db) => {
      await enable(db, "pokebeach_official");
      const site = fakeSite({
        [HOME]: { status: 200, body: fixture("homepage.html"), etag: '"home-1"' },
        [STORM]: { status: 200, body: fixture("article.html") },
        [DECK]: { status: 200, body: fixture("homepage-degraded.html") },
      });
      const first = await runPokebeachOfficial(db, client(site.impl));
      expect(first).toMatchObject({ status: "partial", articlesListed: 2, created: 1, seen: 0 });
      expect(first.articleErrors).toEqual([{ url: DECK, reason: expect.stringMatching(/^PARSER_DEGRADED/) }]);

      const items = await db.query(
        `SELECT external_id, canonical_url, title, author_name, published_at, published_at_source, status, revision_count, discovered_via
           FROM vault_signals.source_item WHERE source_id = 'pokebeach_official'`,
      );
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0]).toMatchObject({
        external_id: "900001",
        canonical_url: STORM,
        title: "“Fixture Storm” Elite Trainer Box Revealed!",
        author_name: "Water Pokémon Master",
        published_at_source: "article:published_time",
        status: "confirmed",
        revision_count: 0,
        discovered_via: ["homepage"],
      });
      expect(new Date(items.rows[0].published_at).toISOString()).toBe("2026-10-02T18:14:10.000Z");
      const degraded = await db.query(
        `SELECT parser_state FROM vault_signals.source_fetch_state WHERE source_id = 'pokebeach_official' AND url = $1`,
        [DECK],
      );
      expect(degraded.rows[0].parser_state).toBe("degraded");

      const second = await runPokebeachOfficial(db, client(site.impl));
      expect(second.status).toBe("not_modified");
      expect(site.calls.at(-1)!.headers["If-None-Match"]).toBe('"home-1"');
      expect(site.calls.every((c) => c.headers["User-Agent"]?.startsWith("IQVault-SIGNALS/"))).toBe(true);
    });
  });

  it("records a material edit as a revision and never overwrites history; a comment-count change is not a revision", async () => {
    await inTransaction(async (db) => {
      await enable(db, "pokebeach_official");
      let article = fixture("article.html");
      let home = fixture("homepage.html");
      const site = fakeSite({
        [HOME]: () => ({ status: 200, body: home }),
        [STORM]: () => ({ status: 200, body: article }),
        [DECK]: { status: 404 },
      });
      await runPokebeachOfficial(db, client(site.impl));
      home = home.replace("1,204 Comments", "1,388 Comments");
      const recount = await runPokebeachOfficial(db, client(site.impl));
      expect(recount).toMatchObject({ created: 0, revised: 0, seen: 1 });

      article = article.replace("releasing January 27th", "now releasing February 10th");
      const r = await runPokebeachReconcile(db, client(site.impl));
      expect(r.revised).toBe(1);
      const revs = await db.query(
        `SELECT r.change_kind, r.excerpt FROM vault_signals.source_item_revision r
           JOIN vault_signals.source_item i ON i.id = r.source_item_id
          WHERE i.canonical_url = $1 ORDER BY r.change_kind = 'material', r.observed_at`,
        [STORM],
      );
      expect(revs.rows.map((x) => x.change_kind)).toEqual(["initial", "material"]);
      expect(revs.rows[0].excerpt).toMatch(/January 27th/);
      expect(revs.rows[1].excerpt).toMatch(/February 10th/);
      const item = await db.query(`SELECT revision_count, excerpt FROM vault_signals.source_item WHERE canonical_url = $1`, [STORM]);
      expect(item.rows[0]).toMatchObject({ revision_count: 1, excerpt: expect.stringMatching(/February 10th/) });
    });
  });

  it("discovery adds a missed article from PokéBeach itself, links forum threads, and never duplicates", async () => {
    await inTransaction(async (db) => {
      await enable(db, "pokebeach_official");
      await enable(db, "pokebeach_frontpage_feed");
      await enable(db, "pokebeach_rss", FORUM);
      const site = fakeSite({
        [HOME]: { status: 200, body: fixture("homepage.html") },
        [STORM]: { status: 200, body: fixture("article.html") },
        [DECK]: { status: 404 },
        [MISSED]: { status: 200, body: missedArticle() },
        [COMMUNITY]: { status: 200, body: fixture("community-feed.xml") },
        [FORUM]: { status: 200, body: fixture("forum.rss") },
      });
      await runPokebeachOfficial(db, client(site.impl));
      const d = await runPokebeachDiscovery(db, client(site.impl));
      expect(d).toMatchObject({ created: 1, seen: 1, threadsLinked: 1 });
      const items = await db.query(
        `SELECT canonical_url, discovered_via, discussion_url, published_at FROM vault_signals.source_item
          WHERE source_id = 'pokebeach_official' ORDER BY canonical_url`,
      );
      expect(items.rows.map((r) => [r.canonical_url, r.discovered_via])).toEqual([
        [MISSED, ["community_feed"]],
        [STORM, ["homepage", "community_feed"]],
      ]);
      expect(items.rows[1].discussion_url).toBe("https://www.pokebeach.com/forums/threads/fixture-storm-elite-trainer-box-revealed.990071/");
      // The community feed said 09:00 GMT; the article page's own time wins.
      expect(new Date(items.rows[0].published_at).toISOString()).toBe("2026-09-30T16:00:00.000Z");
      const again = await runPokebeachDiscovery(db, client(site.impl));
      expect(again.created).toBe(0);
      const count = await db.query(`SELECT count(*)::int AS n FROM vault_signals.source_item WHERE source_id = 'pokebeach_official'`);
      expect(count.rows[0].n).toBe(2);
    });
  });

  it("backs off after a failure, and waits the maximum on a 403 without retrying around it", async () => {
    await inTransaction(async (db) => {
      await enable(db, "pokebeach_official");
      const down = fakeSite({ [HOME]: { status: 503 } });
      const r = await runPokebeachOfficial(db, client(down.impl));
      expect(r.status).toBe("failed");
      const again = await runPokebeachOfficial(db, client(down.impl));
      expect(again.reason).toMatch(/^backing off until 2026-10-03T12:05:00/);
      expect(down.calls).toHaveLength(1);

      const blocked = fakeSite({ "https://www.pokebeach.com/forums/members/x.1/": { status: 403 } });
      const out = await politeGet(db, "pokebeach_members", "https://www.pokebeach.com/forums/members/x.1/", client(blocked.impl));
      expect(out).toMatchObject({ kind: "error", status: 403 });
      const st = await db.query(
        `SELECT next_attempt_at FROM vault_signals.source_fetch_state WHERE source_id = 'pokebeach_members'`,
      );
      expect(new Date(st.rows[0].next_attempt_at).toISOString()).toBe("2026-10-03T18:00:00.000Z");
    });
  });

  it("stops requesting article pages at the first 403 and reports the run as blocked", async () => {
    await inTransaction(async (db) => {
      await enable(db, "pokebeach_official");
      const site = fakeSite({
        [HOME]: { status: 200, body: fixture("homepage.html") },
        [STORM]: { status: 403 },
        [DECK]: { status: 200, body: fixture("article.html") },
      });
      const r = await runPokebeachOfficial(db, client(site.impl));
      expect(r).toMatchObject({ status: "blocked", accessBlocked: true, created: 0, skipped: 1 });
      expect(r.reason).toMatch(/refused an article page/);
      expect(site.calls.map((c) => c.url)).toEqual([HOME, STORM]);
    });
  });

  it("members: configuration only; the access check reports a block and stores nothing from the page", async () => {
    await inTransaction(async (db) => {
      const members = await listTrackedMembers(db);
      expect(members).toHaveLength(8);
      expect(members.find((m) => m.handle === "Water Pokémon Master")?.weights.news).toBe(1);
      await expect(updateTrackedMember(db, "The-Kaiser", { profileUrl: "https://www.pokebeach.com/forums/whats-new/news-feed" })).rejects.toThrow();
      const kaiser = await updateTrackedMember(db, "The-Kaiser", {
        profileUrl: "https://www.pokebeach.com/forums/members/the-kaiser.12345/",
        weights: { competitive: 0.4 },
      });
      expect(kaiser.weights).toEqual({ news: 0.4, sealed: 1, collecting: 0.9, competitive: 0.4, market: 0.8 });
      await expect(updateTrackedMember(db, "The-Kaiser", { weights: { sealed: 1.5 } })).rejects.toThrow();

      const site = fakeSite({ "https://www.pokebeach.com/forums/members/the-kaiser.12345/": { status: 403 } });
      const results = await checkMemberAccess(db, client(site.impl));
      expect(results.find((r) => r.handle === "The-Kaiser")).toMatchObject({ result: "blocked", status: 403 });
      expect(results.filter((r) => r.result === "no_profile_url")).toHaveLength(7);
      expect(site.calls).toHaveLength(1);
      const stored = await db.query(`SELECT count(*)::int AS n FROM vault_signals.source_item WHERE source_id = 'pokebeach_members'`);
      expect(stored.rows[0].n).toBe(0);
    });
  });
});
