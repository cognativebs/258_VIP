import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CATALOG_RESOLVER_RULE,
  createCatalogResolver,
  createFixtureCatalogAdapter,
  createTcgdexCatalogAdapter,
  type CatalogCard,
} from "@vip/scan-ingest";
import { closeDb, getDb } from "../db/client.js";
import {
  catalogResolverEnabled,
  createPostgresIdentificationCache,
  createPostgresSnapshotSink,
  defaultCatalogAdapters,
  tcgdexEnabled,
} from "./catalogLive.js";

async function dbAvailable(): Promise<boolean> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  await closeDb();
});

describe("catalog live wiring", () => {
  it("enables the resolver for Pokémon and Magic only", () => {
    expect(catalogResolverEnabled("pokemon")).toBe(true);
    expect(catalogResolverEnabled("mtg")).toBe(true);
    expect(catalogResolverEnabled("sports")).toBe(false);
    expect(catalogResolverEnabled(null)).toBe(false);
  });

  it("includes TCGdex unless VIP_CATALOG_TCGDEX=0", () => {
    expect(defaultCatalogAdapters({}).some((a) => a.id === "tcgdex")).toBe(true);
    expect(
      defaultCatalogAdapters({ VIP_CATALOG_TCGDEX: "0" }).some((a) => a.id === "tcgdex"),
    ).toBe(false);
    expect(tcgdexEnabled({ VIP_CATALOG_TCGDEX: "0" })).toBe(false);
  });

  it("snapshots TCGdex bytes before parse and replays from Postgres cache", async () => {
    if (!(await dbAvailable())) {
      console.warn("skipping catalog live PG test: no Postgres");
      return;
    }
    const payload = JSON.stringify([
      { id: "base1-4", name: "Charizard", localId: "4" },
    ]);
    const fetchImpl = async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => payload,
    });
    const cache = createPostgresIdentificationCache();
    const sink = createPostgresSnapshotSink();
    const resolver = createCatalogResolver({
      cache,
      snapshotSink: sink,
      adapters: [
        createFixtureCatalogAdapter(),
        createTcgdexCatalogAdapter({ fetch: fetchImpl }),
      ],
    });
    const unit = {
      ocrText: "Charizard Base Set 4/102 holo",
      frontStorageRef: "char_front.jpg",
      categoryHint: "pokemon" as const,
    };
    const hash = `live-cache-${Date.now()}`;
    const first = await resolver.resolve({ unit, contentHash: hash });
    expect(first.cacheHit).toBe(false);
    expect(first.candidates.some((c) => c.adapterId === "tcgdex")).toBe(true);
    expect(first.candidates.every((c) => c.provenance.verificationStatus === "unverified")).toBe(
      true,
    );
    const snaps = await getDb().execute(sql`
      SELECT source, payload FROM vault_evidence.raw_snapshots
      WHERE source = 'catalog:tcgdex' AND payload = ${payload}
      LIMIT 1
    `);
    expect(snaps.rows.length).toBe(1);

    const cached = await getDb().execute(sql`
      SELECT provider_calls FROM vault_media.identification_cache
      WHERE content_hash = ${hash} AND resolver_version = ${CATALOG_RESOLVER_RULE}
    `);
    expect(cached.rows.length).toBe(1);

    const second = await resolver.resolve({ unit, contentHash: hash });
    expect(second.cacheHit).toBe(true);
    expect(second.providerCalls).toBe(0);
    expect(second.candidates[0]?.catalogKey).toBe(first.candidates[0]?.catalogKey);
    void ([] as CatalogCard[]);
  });
});
