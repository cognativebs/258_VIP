import { describe, expect, it } from "vitest";
import { clusterKeys, evidenceRoleFor, independenceGroupFor, pickCluster, type ExistingCluster } from "./item-clusters.js";

const cluster = (id: string, eventType: string, anchorPublishedAt: string, keys: string[]): ExistingCluster => ({
  eventId: `00000000-0000-4000-8000-00000000000${id}`,
  eventType,
  anchorPublishedAt,
  keys,
});

describe("clusterKeys", () => {
  it("keeps matched sets and cards only, deduplicated", () => {
    expect(
      clusterKeys([
        { kind: "set", entityRef: "vault_pokemon.set:sv10" },
        { kind: "set", entityRef: "vault_pokemon.set:sv10" },
        { kind: "set", entityRef: null },
        { kind: "card", entityRef: "binder_card:charizard-ex" },
        { kind: "pokemon", entityRef: "pokemon:dex:6" },
        { kind: "product", entityRef: "product:etb" },
      ]),
    ).toEqual(["binder_card:charizard-ex", "vault_pokemon.set:sv10"]);
  });
});

describe("pickCluster", () => {
  const item = { signalType: "SET_RELEASE", publishedAt: "2026-10-03T12:00:00.000Z", keys: ["vault_pokemon.set:sv10"] };

  it("joins an event of the same type sharing a key within 72 hours", () => {
    const c = cluster("1", "SET_RELEASE", "2026-10-01T13:00:00.000Z", ["vault_pokemon.set:sv10"]);
    expect(pickCluster(item, [c])).toBe(c);
  });

  it("starts a new event when the type differs, the window is passed, no key is shared, or the item has no keys", () => {
    expect(pickCluster(item, [cluster("1", "RESTOCK", "2026-10-03T00:00:00.000Z", ["vault_pokemon.set:sv10"])])).toBeNull();
    expect(pickCluster(item, [cluster("1", "SET_RELEASE", "2026-09-30T11:59:00.000Z", ["vault_pokemon.set:sv10"])])).toBeNull();
    expect(pickCluster(item, [cluster("1", "SET_RELEASE", "2026-10-03T00:00:00.000Z", ["vault_pokemon.set:sv9"])])).toBeNull();
    expect(pickCluster({ ...item, keys: [] }, [cluster("1", "SET_RELEASE", "2026-10-03T00:00:00.000Z", [])])).toBeNull();
  });

  it("picks the earliest anchor regardless of order", () => {
    const late = cluster("2", "SET_RELEASE", "2026-10-02T00:00:00.000Z", ["vault_pokemon.set:sv10"]);
    const early = cluster("1", "SET_RELEASE", "2026-10-01T00:00:00.000Z", ["vault_pokemon.set:sv10"]);
    expect(pickCluster(item, [late, early])).toBe(early);
  });
});

describe("independence", () => {
  it("is one group per outlet for articles, one per member for posts, and none for threads", () => {
    const base = { sourceId: "pokebeach_official", authorRef: "staff-a", authorName: "Staff A" };
    expect(independenceGroupFor({ ...base, kind: "article" })).toBe("pokebeach_official");
    expect(independenceGroupFor({ ...base, authorRef: "staff-b", kind: "article" })).toBe("pokebeach_official");
    expect(independenceGroupFor({ sourceId: "pokebeach_members", kind: "member_activity", authorRef: null, authorName: "PMJ" })).toBe(
      "pokebeach_members:member:PMJ",
    );
    expect(independenceGroupFor({ ...base, kind: "thread" })).toBeNull();
    expect(() => independenceGroupFor({ sourceId: "pokebeach_members", kind: "forum_post", authorRef: null, authorName: null })).toThrow();
    expect(evidenceRoleFor("thread")).toBe("DISCUSSION");
    expect(evidenceRoleFor("article")).toBe("PRIMARY");
  });
});
