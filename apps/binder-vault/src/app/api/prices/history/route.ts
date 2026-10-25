import { NextResponse } from "next/server";
import { backfillBinderGuideHistory } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A large binder backfill writes many rows; keep the old budget.
export const maxDuration = 300;

/**
 * Ledger "Backfill history" (owner decision 2026-10-25, Q8): copies the daily PriceCharting guide VIP has
 * stored into this binder's price history and sets each pocket to the latest guide value. TCGplayer's
 * price-history API now refuses Binder (403), so it is no longer called. Day-to-day prices come from
 * POST /api/binders/:id/sync-prices.
 *
 * Body: `{ binderId, windowDays? }` (windowDays 1–365, default 365).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { binderId?: string; windowDays?: number };
  const binderId = body.binderId?.trim();
  if (!binderId) {
    return NextResponse.json({ error: "binderId is required" }, { status: 400 });
  }
  const windowDays =
    typeof body.windowDays === "number" && body.windowDays >= 1 ? Math.min(Math.trunc(body.windowDays), 365) : 365;
  try {
    const report = await backfillBinderGuideHistory(binderId, { windowDays });
    if (!report) return NextResponse.json({ error: "binder not found" }, { status: 404 });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
