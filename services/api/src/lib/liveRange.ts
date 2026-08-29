/**
 * Read cached Browse listing observations as a LIVE range chip.
 * Never writes vault_market.sale or current_price_snapshot.
 */
import { sql } from "drizzle-orm";
import { liveRangeChip, type LiveRangeChip } from "@vip/core-model";
import { getDb } from "../db/client.js";

export const LIVE_RANGE_COPY =
  "eBay Browse listings · unverified — not a sold ledger. VALUE stays the CLZ catalog snapshot.";

export type LiveRangeRow = {
  holding_source_row_id: string;
  listing_count: unknown;
  live_low: unknown;
  live_high: unknown;
  latest_observed: unknown;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function recencyDays(observedAt: Date | null, asOf = new Date()): number | null {
  if (!observedAt) return null;
  return Math.abs(asOf.getTime() - observedAt.getTime()) / 86_400_000;
}

export function chipFromObservationAgg(
  holdingSourceRowId: string,
  row: LiveRangeRow | undefined,
  asOf = new Date(),
): LiveRangeChip {
  if (!row) {
    return liveRangeChip({
      holdingSourceRowId,
      fetched: false,
      listingCount: 0,
      low: null,
      high: null,
      recencyDays: null,
      observedAt: null,
    });
  }
  const observed = row.latest_observed ? new Date(String(row.latest_observed)) : null;
  const observedOk = observed && !Number.isNaN(observed.getTime()) ? observed : null;
  return liveRangeChip({
    holdingSourceRowId,
    fetched: true,
    listingCount: num(row.listing_count) ?? 0,
    low: num(row.live_low),
    high: num(row.live_high),
    recencyDays: recencyDays(observedOk, asOf),
    observedAt: observedOk ? observedOk.toISOString() : null,
  });
}

export async function loadLiveRangeMap(
  holdingSourceRowIds: string[],
): Promise<Map<string, LiveRangeChip>> {
  const out = new Map<string, LiveRangeChip>();
  for (const id of holdingSourceRowIds) {
    out.set(id, chipFromObservationAgg(id, undefined));
  }
  if (holdingSourceRowIds.length === 0) return out;

  const db = getDb();
  const idList = sql.join(
    holdingSourceRowIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT
      holding_source_row_id,
      COUNT(*) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS listing_count,
      MIN(ask_price) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS live_low,
      MAX(ask_price) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS live_high,
      MAX(observed_at) AS latest_observed
    FROM vault_market.listing_observation
    WHERE holding_source_row_id IN (${idList})
    GROUP BY holding_source_row_id
  `);

  for (const raw of result.rows as LiveRangeRow[]) {
    const id = String(raw.holding_source_row_id);
    out.set(id, chipFromObservationAgg(id, raw));
  }
  return out;
}

export async function loadAllLiveRanges(): Promise<Map<string, LiveRangeChip>> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      holding_source_row_id,
      COUNT(*) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS listing_count,
      MIN(ask_price) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS live_low,
      MAX(ask_price) FILTER (
        WHERE observation_kind = 'browse_listing' AND ask_price IS NOT NULL
      ) AS live_high,
      MAX(observed_at) AS latest_observed
    FROM vault_market.listing_observation
    GROUP BY holding_source_row_id
  `);
  const out = new Map<string, LiveRangeChip>();
  for (const raw of result.rows as LiveRangeRow[]) {
    const id = String(raw.holding_source_row_id);
    out.set(id, chipFromObservationAgg(id, raw));
  }
  return out;
}
