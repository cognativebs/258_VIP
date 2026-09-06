import { sql } from "drizzle-orm";
import {
  CATALOG_RESOLVER_RULE,
  CATALOG_SNAPSHOT_RULE,
  CatalogResolverResultSchema,
  createCatalogResolver,
  createFixtureCatalogAdapter,
  createMemoryIdentificationCache,
  createTcgdexCatalogAdapter,
  hashProviderPayload,
  type CatalogAdapter,
  type CatalogResolver,
  type CatalogResolverResult,
  type IdentificationCache,
  type SnapshotSink,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";

export function catalogResolverEnabled(
  category: "sports" | "pokemon" | "mtg" | null | undefined,
): boolean {
  return category === "pokemon" || category === "mtg";
}

export function tcgdexEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VIP_CATALOG_TCGDEX !== "0";
}

export function createPostgresSnapshotSink(): SnapshotSink {
  return {
    async write(input) {
      try {
        const db = getDb();
        const hash = hashProviderPayload(input.payload);
        const existing = await db.execute(sql`
          SELECT id FROM vault_evidence.raw_snapshots
          WHERE content_hash = ${hash}
          LIMIT 1
        `);
        const found = (existing.rows as Array<Record<string, unknown>>)[0];
        if (found) return { id: String(found.id), contentHash: hash };

        const inserted = await db.execute(sql`
          INSERT INTO vault_evidence.raw_snapshots
            (source, content_hash, content_type, payload, byte_length, record_count,
             prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
          VALUES (
            ${input.source}, ${hash}, ${input.contentType}, ${input.payload},
            ${Buffer.byteLength(input.payload)}, ${input.recordCount ?? 0},
            ${input.source}, 'observed', ${CATALOG_SNAPSHOT_RULE}, 1.0, 'verified'
          )
          ON CONFLICT (content_hash) DO NOTHING
          RETURNING id
        `);
        const row = (inserted.rows as Array<Record<string, unknown>>)[0];
        if (row) return { id: String(row.id), contentHash: hash };
        const again = await db.execute(sql`
          SELECT id FROM vault_evidence.raw_snapshots
          WHERE content_hash = ${hash}
          LIMIT 1
        `);
        const reused = (again.rows as Array<Record<string, unknown>>)[0];
        return reused ? { id: String(reused.id), contentHash: hash } : null;
      } catch {
        return null;
      }
    },
  };
}

export function createPostgresIdentificationCache(): IdentificationCache {
  const memory = createMemoryIdentificationCache();
  return {
    async get(contentHash) {
      const local = await memory.get(contentHash);
      if (local) return local;
      try {
        const db = getDb();
        const res = await db.execute(sql`
          SELECT payload FROM vault_media.identification_cache
          WHERE content_hash = ${contentHash}
            AND resolver_version = ${CATALOG_RESOLVER_RULE}
          LIMIT 1
        `);
        const row = (res.rows as Array<Record<string, unknown>>)[0];
        if (!row?.payload) return undefined;
        const parsed = CatalogResolverResultSchema.parse(row.payload);
        await memory.set(contentHash, parsed);
        return parsed;
      } catch {
        return undefined;
      }
    },
    async set(contentHash, result) {
      await memory.set(contentHash, result);
      try {
        const db = getDb();
        await db.execute(sql`
          INSERT INTO vault_media.identification_cache
            (content_hash, resolver_version, payload, provider_calls)
          VALUES (
            ${contentHash}, ${CATALOG_RESOLVER_RULE},
            ${JSON.stringify(result)}::jsonb, ${result.providerCalls}
          )
          ON CONFLICT (content_hash, resolver_version) DO NOTHING
        `);
      } catch {
        // Process-local cache still satisfies same-process replay.
      }
    },
    size: () => memory.size?.() ?? 0,
  };
}

/** Test seam — do not use in production paths. */
let resolverOverride: CatalogResolver | null = null;
let cachedResolver: CatalogResolver | null = null;

export function setCatalogResolverForTests(resolver: CatalogResolver | null): void {
  resolverOverride = resolver;
  cachedResolver = null;
}

export function resetCatalogResolver(): void {
  resolverOverride = null;
  cachedResolver = null;
}

export function defaultCatalogAdapters(
  env: NodeJS.ProcessEnv = process.env,
): CatalogAdapter[] {
  const adapters: CatalogAdapter[] = [createFixtureCatalogAdapter()];
  if (tcgdexEnabled(env)) {
    adapters.push(createTcgdexCatalogAdapter());
  }
  return adapters;
}

export function getCatalogResolver(): CatalogResolver {
  if (resolverOverride) return resolverOverride;
  if (!cachedResolver) {
    cachedResolver = createCatalogResolver({
      adapters: defaultCatalogAdapters(),
      cache: createPostgresIdentificationCache(),
      snapshotSink: createPostgresSnapshotSink(),
    });
  }
  return cachedResolver;
}

export type { CatalogResolverResult };
