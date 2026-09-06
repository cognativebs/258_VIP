import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import type { CatalogCard, IdentityCandidate } from "../schemas.js";
import { createFixtureCatalogAdapter } from "./fixture-adapter.js";
import { FIXTURE_CATALOG } from "./fixture-catalog.js";
import { canonicalizeCandidatesJson, createMemoryIdentificationCache } from "./cache.js";
import { mergeCandidatesByExternalId } from "./merge.js";
import { createCatalogResolver } from "./resolver.js";
import { createMemorySnapshotSink } from "./snapshots.js";
import type { CatalogAdapter, CatalogQuery } from "./types.js";

const CHARIZARD = FIXTURE_CATALOG.find((c) => c.catalogKey.includes("charizard"))!;

function countingAdapter(
  id: string,
  cards: CatalogCard[],
  calls: { n: number },
  opts: { delayMs?: number; fail?: boolean; categories?: CatalogAdapter["categories"] } = {},
): CatalogAdapter {
  return {
    id,
    label: id,
    categories: opts.categories,
    async search() {
      calls.n += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new Error(`${id} exploded`);
      return cards;
    },
  };
}

function rawAdapter(
  id: string,
  payload: string,
  cards: CatalogCard[],
  parsedAfter: { snapshots: number },
  sinkSize: () => number,
): CatalogAdapter {
  return {
    id,
    label: id,
    categories: ["pokemon"],
    async fetchRaw() {
      return { payload, contentType: "application/json" };
    },
    parseRaw() {
      parsedAfter.snapshots = sinkSize();
      return cards;
    },
    async search() {
      return cards;
    },
  };
}

describe("mergeCandidatesByExternalId", () => {
  it("corroborates the same external_id without boosting confidence", () => {
    const a: IdentityCandidate = {
      catalogKey: "pokemon:base-set:4:charizard",
      category: "pokemon",
      displayName: "Charizard",
      externalIds: [{ source: "tcgdex", value: "base1-4" }],
      adapterId: "fixture-catalog",
      confidence: 0.8,
      matchReasons: ["name:Charizard"],
      provenance: markInferred({
        source: "scan_id_matcher",
        ruleOrModelVersion: "t",
        confidence: 0.8,
      }),
    };
    const b: IdentityCandidate = {
      ...a,
      catalogKey: "pokemon:tcgdex:base1-4",
      adapterId: "tcgdex",
      confidence: 0.82,
      matchReasons: ["collector_number:4"],
    };
    const merged = mergeCandidatesByExternalId([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.confidence).toBe(0.82);
    expect(merged[0]!.matchReasons.some((r) => r.startsWith("corroborated:"))).toBe(
      true,
    );
    expect(merged[0]!.adapterId).toBe("tcgdex");
  });

  it("does not merge on display name alone", () => {
    const a: IdentityCandidate = {
      catalogKey: "pokemon:a",
      category: "pokemon",
      displayName: "Pikachu",
      externalIds: [{ source: "tcgdex", value: "a" }],
      adapterId: "one",
      confidence: 0.7,
      matchReasons: ["token_overlap"],
      provenance: markInferred({
        source: "scan_id_matcher",
        ruleOrModelVersion: "t",
        confidence: 0.7,
      }),
    };
    const b: IdentityCandidate = {
      ...a,
      catalogKey: "pokemon:b",
      externalIds: [{ source: "tcgdex", value: "b" }],
      adapterId: "two",
    };
    expect(mergeCandidatesByExternalId([a, b])).toHaveLength(2);
  });
});

describe("CatalogResolver", () => {
  const unit = {
    ocrText: "Charizard Base Set 4/102 holo",
    frontStorageRef: "char_front.jpg",
    categoryHint: "pokemon" as const,
  };

  it("fans out, isolates a failing adapter, and merges corroboration", async () => {
    const fixtureCalls = { n: 0 };
    const boomCalls = { n: 0 };
    const twinCalls = { n: 0 };
    const resolver = createCatalogResolver({
      adapters: [
        countingAdapter("fixture-catalog", [CHARIZARD], fixtureCalls),
        countingAdapter("dead-provider", [CHARIZARD], boomCalls, { fail: true }),
        countingAdapter(
          "twin",
          [
            {
              ...CHARIZARD,
              catalogKey: "pokemon:twin:charizard",
            },
          ],
          twinCalls,
        ),
      ],
    });

    const result = await resolver.resolve({
      unit,
      contentHash: "hash-charizard-1",
    });

    expect(fixtureCalls.n).toBe(1);
    expect(boomCalls.n).toBe(1);
    expect(twinCalls.n).toBe(1);
    expect(result.providerCalls).toBe(3);
    expect(result.outcomes.find((o) => o.adapterId === "dead-provider")?.status).toBe(
      "error",
    );
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const top = result.candidates[0]!;
    expect(top.externalIds.some((e) => e.value === "base1-4")).toBe(true);
    expect(top.matchReasons.some((r) => r.includes("corroborated"))).toBe(true);
    expect(top.provenance.verificationStatus).toBe("unverified");
    expect(top.provenance.method).toBe("inferred");
  });

  it("replays from the content-hash cache with zero provider calls", async () => {
    const calls = { n: 0 };
    const cache = createMemoryIdentificationCache();
    const resolver = createCatalogResolver({
      cache,
      adapters: [countingAdapter("fixture-catalog", [CHARIZARD], calls)],
    });
    const first = await resolver.resolve({
      unit,
      contentHash: "same-bytes",
    });
    expect(calls.n).toBe(1);
    expect(first.cacheHit).toBe(false);

    const second = await resolver.resolve({
      unit,
      contentHash: "same-bytes",
    });
    expect(calls.n).toBe(1);
    expect(second.cacheHit).toBe(true);
    expect(second.providerCalls).toBe(0);
    expect(second.outcomes.every((o) => o.called === false)).toBe(true);
    expect(canonicalizeCandidatesJson(second.candidates)).toBe(
      canonicalizeCandidatesJson(first.candidates),
    );
  });

  it("snapshots raw provider bytes before parseRaw", async () => {
    const sink = createMemorySnapshotSink();
    const parsedAfter = { snapshots: 0 };
    const payload = JSON.stringify([{ id: "base1-4", name: "Charizard", localId: "4" }]);
    const resolver = createCatalogResolver({
      snapshotSink: sink,
      adapters: [
        rawAdapter("tcgdex", payload, [CHARIZARD], parsedAfter, () => sink.records.length),
      ],
    });
    await resolver.resolve({ unit, contentHash: "snap-1" });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]!.source).toBe("catalog:tcgdex");
    expect(sink.records[0]!.payload).toBe(payload);
    expect(parsedAfter.snapshots).toBe(1);
  });

  it("times out one adapter without failing the batch", async () => {
    const fast = { n: 0 };
    const slow = { n: 0 };
    const resolver = createCatalogResolver({
      timeoutMs: 40,
      adapters: [
        countingAdapter("fast", [CHARIZARD], fast),
        countingAdapter("slow", [CHARIZARD], slow, { delayMs: 200 }),
      ],
    });
    const result = await resolver.resolve({
      unit,
      contentHash: "timeout-1",
    });
    expect(result.outcomes.find((o) => o.adapterId === "slow")?.status).toBe(
      "timeout",
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]!.adapterId).toBe("fast");
  });

  it("skips a category-mismatched adapter without calling it", async () => {
    const sportsCalls = { n: 0 };
    const pokeCalls = { n: 0 };
    const resolver = createCatalogResolver({
      adapters: [
        countingAdapter("sports-only", [FIXTURE_CATALOG[2]!], sportsCalls, {
          categories: ["sports"],
        }),
        countingAdapter("fixture-catalog", [CHARIZARD], pokeCalls),
      ],
    });
    const result = await resolver.resolve({
      unit,
      contentHash: "cat-1",
      opts: { categoryHint: "pokemon" },
    });
    expect(sportsCalls.n).toBe(0);
    expect(pokeCalls.n).toBe(1);
    expect(result.outcomes.find((o) => o.adapterId === "sports-only")?.status).toBe(
      "skipped",
    );
  });

  it("uses the fixture adapter through the resolver without changing scores", async () => {
    const resolver = createCatalogResolver({
      adapters: [createFixtureCatalogAdapter()],
    });
    const result = await resolver.resolve({
      unit,
      contentHash: "fixture-path",
    });
    expect(result.candidates[0]?.catalogKey).toBe("pokemon:base-set:4:charizard");
    expect(result.candidates[0]?.adapterId).toBe("fixture-catalog");
  });
});
