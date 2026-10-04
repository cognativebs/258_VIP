import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POKEBEACH_TRACKED_MEMBERS_SEED, MemberWeightsSchema } from "./members-seed.js";
import {
  articleContentHash,
  canonicalArticleUrl,
  parseArticlePage,
  parseDiscoveryFeedUrls,
  parseForumThreads,
  parseHomepage,
  titleKey,
} from "./parser.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const MIGRATION = readFileSync(
  new URL("../../../../../infra/db/migrations/20261003_01_signals_pokebeach_sources.sql", import.meta.url),
  "utf8",
);

describe("homepage", () => {
  it("reads post id, canonical URL, decoded title, author, comment count and the next page", () => {
    const r = parseHomepage(fixture("homepage.html"));
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.nextPageUrl).toBe("https://www.pokebeach.com/page/2");
    expect(r.value.articles).toEqual([
      {
        postId: "900001",
        canonicalUrl: "https://www.pokebeach.com/2026/10/fixture-storm-elite-trainer-box-revealed",
        title: "“Fixture Storm” Elite Trainer Box Revealed!",
        author: "Water Pokémon Master",
        authorSlug: "admin",
        displayedTime: "Oct 2, 2026 at 11:14 AM",
        commentCount: 1204,
      },
      {
        postId: "900002",
        // Tracking parameters never become part of an identity.
        canonicalUrl: "https://www.pokebeach.com/2026/10/fixture-deck-strategy",
        title: "Fixture Deck Strategy – Week 1",
        author: "Fixture Writer",
        authorSlug: "fixture-writer",
        displayedTime: "Oct 1, 2026 at 10:00 AM",
        commentCount: 0,
      },
    ]);
  });

  it("reports a markup change as degraded instead of returning partial articles", () => {
    const r = parseHomepage(fixture("homepage-degraded.html"));
    expect(r).toMatchObject({ ok: false, degraded: true });
    expect(r.ok ? "" : r.reason).toMatch(/post-900003: .*author/);
    expect(parseHomepage("<html><body>maintenance</body></html>")).toMatchObject({ ok: false });
  });
});

describe("article page", () => {
  it("takes identity and UTC time from the page's own metadata", () => {
    const r = parseArticlePage(fixture("article.html"));
    if (!r.ok) throw new Error(r.reason);
    expect(r.value).toEqual({
      postId: "900001",
      canonicalUrl: "https://www.pokebeach.com/2026/10/fixture-storm-elite-trainer-box-revealed",
      title: "“Fixture Storm” Elite Trainer Box Revealed!",
      author: "Water Pokémon Master",
      authorSlug: "admin",
      publishedAt: "2026-10-02T18:14:10+00:00",
      modifiedAt: "2026-10-02T18:21:00+00:00",
      description: 'We can reveal the "Fixture Storm" Elite Trainer Box, releasing January 27th with nine booster packs.',
    });
  });

  it("is degraded without a publish time or canonical URL", () => {
    const noTime = fixture("article.html").replace(/<meta property="article:published_time"[^>]*>/, "");
    expect(parseArticlePage(noTime)).toMatchObject({ ok: false });
    const noCanonical = fixture("article.html").replace(/<link rel="canonical"[^>]*>/, "");
    expect(parseArticlePage(noCanonical)).toMatchObject({ ok: false });
  });

  it("hashes material content only: modified time and comments never make a revision", () => {
    const r = parseArticlePage(fixture("article.html"));
    if (!r.ok) throw new Error(r.reason);
    const base = articleContentHash(r.value);
    expect(articleContentHash({ ...r.value, title: `  ${r.value.title.toUpperCase()} ` })).toBe(base);
    expect(articleContentHash({ ...r.value, publishedAt: "2026-10-02T11:14:10-07:00" })).toBe(base);
    expect(articleContentHash({ ...r.value, description: "Release moved to February." })).not.toBe(base);
  });
});

describe("canonical URLs and discovery feeds", () => {
  it("accepts only pokebeach.com/YYYY/MM/slug articles, normalized", () => {
    expect(canonicalArticleUrl("http://pokebeach.com/2026/10/Fixture-Slug/?utm_source=rss#comments")).toBe(
      "https://www.pokebeach.com/2026/10/fixture-slug",
    );
    expect(canonicalArticleUrl("https://www.pokebeach.com/forums/threads/x.1/")).toBeNull();
    expect(canonicalArticleUrl("https://evil.example/2026/10/fixture-slug")).toBeNull();
    expect(canonicalArticleUrl("https://www.pokebeach.com/page/2")).toBeNull();
  });

  it("community feed yields article URLs only, deduplicated, and no times", () => {
    expect(parseDiscoveryFeedUrls(fixture("community-feed.xml"))).toEqual([
      "https://www.pokebeach.com/2026/10/fixture-storm-elite-trainer-box-revealed",
      "https://www.pokebeach.com/2026/09/fixture-missed-article",
    ]);
  });

  it("forum RSS threads match their article by title despite quote style", () => {
    const threads = parseForumThreads(fixture("forum.rss"));
    expect(threads.map((t) => t.threadId)).toEqual(["990071", "116208"]);
    expect(titleKey(threads[0]!.title)).toBe(titleKey("&#8220;Fixture Storm&#8221; Elite Trainer Box Revealed!"));
  });
});

describe("tracked members seed", () => {
  it("is the operator's eight members with per-specialty weights, seeded exactly by the migration", () => {
    expect(POKEBEACH_TRACKED_MEMBERS_SEED.map((m) => m.handle)).toEqual([
      "Water Pokémon Master",
      "The-Kaiser",
      "oklandon",
      "PMJ",
      "Travinking0927",
      "ztnoob",
      "NovaAcerola",
      "Hollow Foil",
    ]);
    for (const m of POKEBEACH_TRACKED_MEMBERS_SEED) {
      MemberWeightsSchema.parse(m.weights);
      expect(MIGRATION).toContain(`('pokebeach_members', '${m.handle}', NULL, true, '${JSON.stringify(m.weights)}'::jsonb, '${m.weightsFrom}')`);
    }
    expect(POKEBEACH_TRACKED_MEMBERS_SEED.find((m) => m.handle === "The-Kaiser")?.weights.sealed).toBe(1);
  });

  it("the migration enables nothing and adds no scoring columns", () => {
    expect(MIGRATION).not.toMatch(/adapter_enabled\s*=\s*true|is_active\s*=\s*true/i);
    expect(MIGRATION).not.toMatch(/\b(signal_strength|sentiment|\w*relevance)\s+(NUMERIC|INTEGER|REAL|DOUBLE)/i);
    expect(MIGRATION).not.toMatch(/INSERT INTO vault_market/i);
  });
});
