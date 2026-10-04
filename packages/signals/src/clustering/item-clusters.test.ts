import { describe, expect, it } from "vitest";
import { clusterItems, independenceGroup, type ClusterInputItem } from "./item-clusters.js";

const AT = new Date("2026-10-04T12:00:00.000Z");
const set = (key: string, ref: string | null = null) => ({ kind: "set" as const, normalizedKey: key, mention: key, entityRef: ref });
const item = (id: string, url: string, hoursAgo: number, theme: string | null, entities: ClusterInputItem["entities"], sourceKey = "pokebeach_official"): ClusterInputItem => ({
  id,
  sourceKey,
  group: independenceGroup(sourceKey, url),
  title: id,
  url,
  at: new Date(AT.getTime() - hoursAgo * 3600_000).toISOString(),
  theme,
  entities,
});

describe("independence groups", () => {
  it("are outlets by host; a platform channel is its own voice", () => {
    expect(independenceGroup("pokebeach_official", "https://www.pokebeach.com/2026/10/x")).toBe("pokebeach.com");
    expect(independenceGroup("gdelt_doc_v2", "https://www.pokebeach.com/2026/10/x")).toBe("pokebeach.com");
    expect(independenceGroup("gdelt_doc_v2", "https://news.fixture.example/a")).toBe("news.fixture.example");
    expect(independenceGroup("alpha_investments_youtube", "https://www.youtube.com/watch?v=X")).toBe("alpha_investments_youtube");
    expect(independenceGroup("comicsbeat_rss", null)).toBe("comicsbeat_rss");
  });
});

describe("clusterItems", () => {
  it("groups by entity + theme in the window and counts outlets, not mentions", () => {
    const clusters = clusterItems(
      [
        item("pb-1", "https://www.pokebeach.com/a", 10, "RESTOCK", [set("delta-reign")]),
        item("pb-2", "https://www.pokebeach.com/b", 20, "RESTOCK", [set("delta-reign")]),
        item("pb-3", "https://www.pokebeach.com/c", 30, "RESTOCK", [set("delta-reign")]),
        item("gd-1", "https://news.fixture.example/delta", 5, "RESTOCK", [set("delta-reign", "binder_set:delta-reign")], "gdelt_doc_v2"),
        item("pb-old", "https://www.pokebeach.com/old", 100, "RESTOCK", [set("delta-reign")]),
        item("pb-other-theme", "https://www.pokebeach.com/d", 8, "REPRINT", [set("delta-reign")]),
      ],
      { at: AT },
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      entity: { normalizedKey: "delta-reign", entityRef: "binder_set:delta-reign" },
      theme: "RESTOCK",
      mentionCount: 4,
      independentSourceCount: 2,
      groups: ["news.fixture.example", "pokebeach.com"],
      corroboration: "corroborated",
    });
    expect(clusters[0]!.items.map((i) => i.id)).toEqual(["pb-3", "pb-2", "pb-1", "gd-1"]);
  });

  it("five articles from one newsroom are one source; one article is not a cluster", () => {
    const many = Array.from({ length: 5 }, (_, i) => item(`pb-${i}`, `https://www.pokebeach.com/${i}`, i + 1, null, [set("fixture-set")]));
    const [c] = clusterItems(many, { at: AT });
    expect(c).toMatchObject({ theme: "UNCLASSIFIED", mentionCount: 5, independentSourceCount: 1, corroboration: "single_source" });
    expect(clusterItems([many[0]!], { at: AT })).toEqual([]);
  });

  it("ignores generic product entities that would merge unrelated news", () => {
    const promo = { kind: "product" as const, normalizedKey: "promo", mention: "Promos", entityRef: "product:promo" };
    expect(
      clusterItems(
        [item("a", "https://www.pokebeach.com/a", 1, null, [promo]), item("b", "https://www.pokebeach.com/b", 2, null, [promo])],
        { at: AT },
      ),
    ).toEqual([]);
  });

  it("orders corroborated clusters first", () => {
    const clusters = clusterItems(
      [
        item("a1", "https://www.pokebeach.com/a1", 1, null, [set("aaa")]),
        item("a2", "https://www.pokebeach.com/a2", 2, null, [set("aaa")]),
        item("a3", "https://www.pokebeach.com/a3", 3, null, [set("aaa")]),
        item("b1", "https://www.pokebeach.com/b1", 1, null, [set("bbb")]),
        item("b2", "https://other.example/b2", 2, null, [set("bbb")], "gdelt_doc_v2"),
      ],
      { at: AT },
    );
    expect(clusters.map((c) => [c.entity.normalizedKey, c.independentSourceCount, c.mentionCount])).toEqual([
      ["bbb", 2, 2],
      ["aaa", 1, 3],
    ]);
  });
});
