import {
  syncPriceHistory,
  type CardCondition,
  type PriceHistoryRange,
} from "@vip/pricing";
import { NextResponse } from "next/server";
import { query } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A whole-collection backfill can outlive the default serverless budget.
export const maxDuration = 300;

const RANGES: PriceHistoryRange[] = ["daily", "quarter", "annual"];

/**
 * Update TCGplayer price history from the Binder UI.
 *
 * Body: `{ binderId?, range?, condition?, limit?, dryRun? }`
 * Same code path as `npm run job:price-history` and the daily scheduler.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    binderId?: string;
    range?: string;
    condition?: string;
    limit?: number;
    dryRun?: boolean;
  };

  const range: PriceHistoryRange = RANGES.includes(body.range as PriceHistoryRange)
    ? (body.range as PriceHistoryRange)
    : "daily";
  // Only NM writes back to binder values; other grades are history-only.
  const condition = (body.condition?.toUpperCase() ?? "NM") as CardCondition;
  const limit =
    typeof body.limit === "number" && body.limit > 0
      ? Math.min(Math.trunc(body.limit), 2000)
      : undefined;

  try {
    const report = await syncPriceHistory({
      runner: query,
      binderId: body.binderId?.trim() || null,
      range,
      condition,
      limit,
      dryRun: body.dryRun === true,
      concurrency: Number(process.env.VIP_PRICE_CONCURRENCY ?? 4) || 4,
      triggeredBy: "binder-ui",
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
