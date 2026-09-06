import { markInferred } from "@vip/evidence";
import { CATALOG_RESOLVER_RULE } from "../constants.js";
import {
  buildCatalogQuery,
  scoreCatalogCards,
  type IdentifyOptions,
} from "../identify.js";
import type {
  CatalogCard,
  IdentityCandidate,
  ScanCategory,
  ScanUnit,
} from "../schemas.js";
import { createMemoryIdentificationCache, type IdentificationCache } from "./cache.js";
import { mergeCandidatesByExternalId } from "./merge.js";
import {
  CatalogResolverResultSchema,
  type CatalogAdapterOutcome,
  type CatalogResolverResult,
} from "./resolver-schemas.js";
import {
  catalogSnapshotSource,
  type SnapshotSink,
} from "./snapshots.js";
import type { CatalogAdapter, CatalogQuery, CatalogRawResponse } from "./types.js";

export type IdentifyInput = Pick<
  ScanUnit,
  "ocrText" | "frontStorageRef" | "categoryHint"
>;

export type CatalogResolverDeps = {
  adapters: CatalogAdapter[];
  cache?: IdentificationCache;
  snapshotSink?: SnapshotSink;
  timeoutMs?: number;
};

export type CatalogResolveInput = {
  unit: IdentifyInput;
  contentHash?: string | null;
  opts?: IdentifyOptions;
};

const DEFAULT_TIMEOUT_MS = 3000;

function adapterApplies(
  adapter: CatalogAdapter,
  category: ScanCategory | null | undefined,
): boolean {
  if (!adapter.categories?.length) return true;
  if (!category) return true;
  return adapter.categories.includes(category);
}

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { timedOut: true }));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function runAdapter(
  adapter: CatalogAdapter,
  query: CatalogQuery,
  timeoutMs: number,
  snapshotSink?: SnapshotSink,
): Promise<{
  cards: CatalogCard[];
  outcome: CatalogAdapterOutcome;
}> {
  const started = Date.now();
  try {
    let cards: CatalogCard[];
    let snapshotId: string | null = null;
    let snapshotHash: string | null = null;

    if (adapter.fetchRaw && adapter.parseRaw) {
      const raw = await withTimeout(
        adapter.fetchRaw(query),
        timeoutMs,
      );
      if (raw && snapshotSink) {
        const snap = await snapshotSink.write({
          source: catalogSnapshotSource(adapter.id),
          payload: raw.payload,
          contentType: raw.contentType,
          recordCount: 0,
        });
        snapshotId = snap?.id ?? null;
        snapshotHash = snap?.contentHash ?? null;
      }
      cards = raw ? adapter.parseRaw(raw, query) : [];
    } else {
      cards = await withTimeout(adapter.search(query), timeoutMs);
    }

    return {
      cards,
      outcome: {
        adapterId: adapter.id,
        status: "ok",
        cardCount: cards.length,
        elapsedMs: Date.now() - started,
        called: true,
        snapshotId,
        snapshotHash,
      },
    };
  } catch (err) {
    const timedOut = Boolean((err as { timedOut?: boolean })?.timedOut);
    return {
      cards: [],
      outcome: {
        adapterId: adapter.id,
        status: timedOut ? "timeout" : "error",
        cardCount: 0,
        elapsedMs: Date.now() - started,
        called: true,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function createCatalogResolver(deps: CatalogResolverDeps) {
  const cache = deps.cache ?? createMemoryIdentificationCache();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    cache,
    async resolve(input: CatalogResolveInput): Promise<CatalogResolverResult> {
      const hash = input.contentHash?.trim() || null;
      if (hash) {
        const hit = cache.get(hash);
        if (hit) {
          return CatalogResolverResultSchema.parse({
            ...hit,
            cacheHit: true,
            providerCalls: 0,
            outcomes: hit.outcomes.map((o) => ({ ...o, called: false })),
          });
        }
      }

      const query = buildCatalogQuery(input.unit, input.opts);
      const category = query.category ?? null;
      const jobs = deps.adapters.map(async (adapter) => {
        if (!adapterApplies(adapter, category)) {
          return {
            outcome: {
              adapterId: adapter.id,
              status: "skipped" as const,
              cardCount: 0,
              elapsedMs: 0,
              called: false,
            },
            ranked: [] as IdentityCandidate[],
            called: false,
          };
        }
        const { cards, outcome } = await runAdapter(
          adapter,
          query,
          adapter.timeoutMs ?? timeoutMs,
          deps.snapshotSink,
        );
        const ranked =
          outcome.status === "ok"
            ? scoreCatalogCards(
                cards,
                query.text,
                query.externalIds ?? [],
                query.limit ?? 5,
                adapter.id,
              )
            : [];
        return { outcome, ranked, called: true };
      });

      const settled = await Promise.all(jobs);
      const outcomes: CatalogAdapterOutcome[] = settled.map((row) => row.outcome);
      const scored = settled.flatMap((row) => row.ranked);
      const providerCalls = settled.filter((row) => row.called).length;

      const merged = mergeCandidatesByExternalId(scored).slice(0, query.limit ?? 5);
      const result = CatalogResolverResultSchema.parse({
        candidates: merged,
        outcomes: outcomes.sort((a, b) => a.adapterId.localeCompare(b.adapterId)),
        cacheHit: false,
        providerCalls,
        contentHash: hash,
        category,
        provenance: markInferred({
          source: "catalog_resolver",
          ruleOrModelVersion: CATALOG_RESOLVER_RULE,
          confidence: merged[0]?.confidence ?? 0,
          notes:
            "Merged catalog candidates · inferred · unverified until operator confirm",
        }),
      });

      if (hash) cache.set(hash, result);
      return result;
    },
  };
}

export type CatalogResolver = ReturnType<typeof createCatalogResolver>;

/** Used by tests that need to snapshot a raw payload type. */
export type { CatalogRawResponse };
