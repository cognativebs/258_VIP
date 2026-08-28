/**
 * Batched comics comps walk (plan 0003 Track A).
 * Writes listing_observation + raw_snapshots. Never sale. Never CLZ VALUE.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import {
  ComicsCompsWalkCursorSchema,
  type ComicsCompsWalkCursor,
} from "@vip/core-model";
import { getDb } from "../../db/client.js";
import { COMPS_HOLDING_CAP } from "../recommendations.js";
import { mapInventoryRow, type ApiHolding } from "../holdings.js";
import { fetchCompsForHolding } from "./index.js";
import type { CompsAdapter, CompsAdapterResult } from "./types.js";
import {
  LISTING_OBSERVATION_RULE,
  LISTING_OBSERVATION_SOURCE,
  observationsFromAdapterResult,
  type ListingObservationStore,
} from "./listingObservation.js";

export const COMICS_COMPS_WALK_JOB = "comics-comps-walk" as const;
export const DEFAULT_WALK_PUBLISHERS = ["Marvel", "DC"] as const;

const FATAL_EMPTY = /HTTP 401|HTTP 403|HTTP 429|OAuth|invalid_client|invalid_scope/i;

export type WalkHolding = {
  holdingUuid: string;
  assetId: string;
  holding: ApiHolding;
};

export type ComicsCompsWalkOptions = {
  publishers?: string[];
  batchSize?: number;
  staleAfterHours?: number;
  maxHoldings?: number;
  dryRun?: boolean;
  resume?: boolean;
  cursorPath: string;
  store: ListingObservationStore;
  loadHoldings?: () => Promise<WalkHolding[]>;
  fetchHolding?: (holding: ApiHolding) => Promise<{
    adapters: CompsAdapterResult[];
  }>;
  adapters?: CompsAdapter[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rateLimitMs?: number;
  shouldStop?: () => boolean;
  triggeredBy?: string;
};

export type ComicsCompsWalkResult = {
  cursor: ComicsCompsWalkCursor;
  stoppedReason: string | null;
  batches: number;
};

export function emptyCursor(publishers: string[], now: Date): ComicsCompsWalkCursor {
  return ComicsCompsWalkCursorSchema.parse({
    job: COMICS_COMPS_WALK_JOB,
    lastHoldingSourceRowId: null,
    processed: 0,
    skippedFresh: 0,
    unmatched: 0,
    wrote: 0,
    errors: [],
    paused: false,
    publishers,
    updatedAt: now.toISOString(),
  });
}

export function readWalkCursor(path: string, publishers: string[], now: Date): ComicsCompsWalkCursor {
  if (!existsSync(path)) return emptyCursor(publishers, now);
  try {
    return ComicsCompsWalkCursorSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptyCursor(publishers, now);
  }
}

export function writeWalkCursor(path: string, cursor: ComicsCompsWalkCursor): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cursor, null, 2), "utf8");
}

export function publisherMatches(publisher: string, filters: string[]): boolean {
  if (!filters.length || filters.includes("all")) return true;
  const hay = publisher.toLowerCase();
  return filters.some((f) => hay.includes(f.toLowerCase()));
}

export function parsePublishers(raw: string | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text || text.toLowerCase() === "marvel,dc") return [...DEFAULT_WALK_PUBLISHERS];
  if (text.toLowerCase() === "all") return ["all"];
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isFatal(reason: string | undefined): boolean {
  return Boolean(reason && FATAL_EMPTY.test(reason));
}

export async function loadWalkHoldings(): Promise<WalkHolding[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      h.id AS holding_uuid,
      h.source_row_id,
      h.quantity,
      h.purchase_price,
      h.location,
      h.slab_status,
      h.assumed_grade,
      h.grade_rating,
      h.collection_pillar,
      h.museum_score,
      h.investment_score,
      h.liquidity_score,
      h.recommendation,
      h.sell_priority,
      h.upgrade_candidate,
      h.needs_grading,
      h.needs_photo,
      h.needs_verification,
      h.verification_notes,
      h.current_price_snapshot,
      h.clz_metadata,
      a.id AS asset_id,
      a.canonical_name,
      a.primary_image_url,
      s.title AS series_title,
      s.publisher,
      i.issue_number,
      i.is_key_issue,
      i.key_reason,
      v.cover_label
    FROM vault_collection.holding h
    JOIN vault_core.asset a ON a.id = h.asset_id
    JOIN vault_comic.variant v ON v.asset_id = a.id
    JOIN vault_comic.issue i ON i.id = v.issue_id
    JOIN vault_comic.series s ON s.id = i.series_id
    WHERE h.source = 'clz_import'
      AND (h.dropped_at IS NULL)
    ORDER BY h.source_row_id
  `);

  return (result.rows as Record<string, unknown>[]).map((row, index) => {
    const stored = (row.clz_metadata ?? {}) as Record<string, unknown>;
    const clz: Record<string, unknown> = {
      ...stored,
      Series: row.series_title ?? stored["Series"] ?? "",
      Publisher: row.publisher ?? stored["Publisher"] ?? "",
      "Issue Full": stored["Issue Full"] ?? row.issue_number ?? "",
      Issue: row.issue_number ?? stored["Issue"] ?? "",
      "Edition / Variant": row.cover_label ?? stored["Edition / Variant"] ?? "",
      "CLZ Hash": row.source_row_id ?? stored["CLZ Hash"] ?? "",
      "Current Price": row.current_price_snapshot ?? stored["Current Price"] ?? 0,
      "Assumed Grade": row.assumed_grade ?? stored["Assumed Grade"] ?? "",
      Quantity: row.quantity ?? 1,
    };
    return {
      holdingUuid: String(row.holding_uuid),
      assetId: String(row.asset_id),
      holding: mapInventoryRow(clz, index),
    };
  });
}

export async function runComicsCompsWalk(
  opts: ComicsCompsWalkOptions,
): Promise<ComicsCompsWalkResult> {
  const nowFn = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const publishers = opts.publishers?.length ? opts.publishers : [...DEFAULT_WALK_PUBLISHERS];
  const batchSize = opts.batchSize ?? COMPS_HOLDING_CAP;
  const staleMs = (opts.staleAfterHours ?? 24) * 3600_000;
  const rateLimitMs = opts.rateLimitMs ?? Number(process.env.VIP_EBAY_RATE_LIMIT_MS ?? 1000);
  const started = nowFn();

  let cursor = opts.resume
    ? readWalkCursor(opts.cursorPath, publishers, started)
    : emptyCursor(publishers, started);
  cursor = { ...cursor, publishers, paused: false, errors: opts.resume ? cursor.errors : [] };

  const all = await (opts.loadHoldings ?? loadWalkHoldings)();
  const filtered = all
    .filter((h) => publisherMatches(h.holding.publisher, publishers))
    .sort((a, b) => a.holding.id.localeCompare(b.holding.id));

  let start = 0;
  if (opts.resume && cursor.lastHoldingSourceRowId) {
    const idx = filtered.findIndex((h) => h.holding.id === cursor.lastHoldingSourceRowId);
    start = idx >= 0 ? idx + 1 : 0;
  }

  const fetchHolding =
    opts.fetchHolding ??
    (async (holding: ApiHolding) => {
      const result = await fetchCompsForHolding(holding, opts.adapters);
      return { adapters: result.adapters };
    });

  let batches = 0;
  let stoppedReason: string | null = null;
  let fetchedThisRun = 0;

  for (let i = start; i < filtered.length; ) {
    if (opts.shouldStop?.()) {
      cursor = { ...cursor, paused: true, updatedAt: nowFn().toISOString() };
      stoppedReason = "paused";
      break;
    }
    if (opts.maxHoldings != null && fetchedThisRun >= opts.maxHoldings) {
      stoppedReason = "max-holdings";
      break;
    }

    const batch = filtered.slice(i, i + batchSize);
    batches += 1;

    for (const row of batch) {
      if (opts.shouldStop?.()) {
        cursor = { ...cursor, paused: true, updatedAt: nowFn().toISOString() };
        stoppedReason = "paused";
        break;
      }
      if (opts.maxHoldings != null && fetchedThisRun >= opts.maxHoldings) {
        stoppedReason = "max-holdings";
        break;
      }

      const latest = await opts.store.latestObservedAt(row.holding.id);
      if (latest && nowFn().getTime() - latest.getTime() < staleMs) {
        cursor = {
          ...cursor,
          skippedFresh: cursor.skippedFresh + 1,
          lastHoldingSourceRowId: row.holding.id,
          updatedAt: nowFn().toISOString(),
        };
        i += 1;
        continue;
      }

      const { adapters } = await fetchHolding(row.holding);
      fetchedThisRun += 1;
      const browse =
        adapters.find((a) => a.adapterId === "ebay-sold" || a.adapterId === "fixture") ?? adapters[0];
      const fatal = adapters.map((a) => a.emptyReason).find(isFatal);
      if (fatal) {
        cursor = {
          ...cursor,
          paused: true,
          lastHoldingSourceRowId: row.holding.id,
          errors: [...cursor.errors, { holdingSourceRowId: row.holding.id, reason: fatal }],
          updatedAt: nowFn().toISOString(),
        };
        stoppedReason = fatal;
        writeWalkCursor(opts.cursorPath, cursor);
        return { cursor, stoppedReason, batches };
      }

      const observedAt = nowFn();
      let rawSnapshotId: string | null = null;
      if (!opts.dryRun && browse?.rawJson) {
        rawSnapshotId = await opts.store.insertSnapshot({
          source: LISTING_OBSERVATION_SOURCE,
          contentType: "application/json",
          payload: browse.rawJson,
          recordCount: browse.sales.length,
          ruleVersion: LISTING_OBSERVATION_RULE,
        });
      }

      const observations = observationsFromAdapterResult({
        assetId: row.assetId,
        holdingId: row.holdingUuid,
        holdingSourceRowId: row.holding.id,
        adapter: browse ?? { adapterId: "none", sales: [], emptyReason: "no adapter result" },
        observedAt,
        rawSnapshotId,
      });

      let wrote = 0;
      if (!opts.dryRun) {
        wrote = await opts.store.insertObservations(observations);
      }

      const unmatched = observations.every((o) => o.observationKind === "browse_empty") ? 1 : 0;
      cursor = {
        ...cursor,
        processed: cursor.processed + 1,
        unmatched: cursor.unmatched + unmatched,
        wrote: cursor.wrote + wrote,
        lastHoldingSourceRowId: row.holding.id,
        updatedAt: nowFn().toISOString(),
      };
      i += 1;
      if (rateLimitMs > 0) await sleep(rateLimitMs);
    }

    writeWalkCursor(opts.cursorPath, cursor);
    if (stoppedReason) break;
  }

  if (!filtered.length) stoppedReason = stoppedReason ?? "no-holdings";
  else if (!stoppedReason) {
    const lastIdx = filtered.findIndex((h) => h.holding.id === cursor.lastHoldingSourceRowId);
    if (lastIdx === filtered.length - 1 || start >= filtered.length) stoppedReason = "complete";
  }

  cursor = { ...cursor, updatedAt: nowFn().toISOString() };
  writeWalkCursor(opts.cursorPath, cursor);
  return { cursor, stoppedReason, batches };
}

export function formatComicsCompsWalkReport(result: ComicsCompsWalkResult): string {
  const { cursor } = result;
  return [
    `comics-comps-walk ${result.stoppedReason ?? "running"}`,
    `  publishers: ${cursor.publishers.join(",")}`,
    `  processed: ${cursor.processed} · wrote ${cursor.wrote} · unmatched ${cursor.unmatched} · skippedFresh ${cursor.skippedFresh}`,
    `  last: ${cursor.lastHoldingSourceRowId ?? "—"}`,
    `  batches: ${result.batches} · paused=${cursor.paused}`,
    cursor.errors.length ? `  errors: ${cursor.errors.map((e) => e.reason).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
