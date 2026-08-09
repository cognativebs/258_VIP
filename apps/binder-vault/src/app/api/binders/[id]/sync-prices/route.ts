import { NextResponse } from "next/server";
import { syncBinderPrices } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Refresh market prices.
 * Body optional: `{ pageId?: string, firstPages?: number, force?: boolean }`
 * Prefer `pageId` (active page). Otherwise syncs the first N pages (default 5).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    firstPages?: number;
    pageId?: string;
    force?: boolean;
  };
  const firstPages = Math.min(Math.max(Number(body.firstPages) || 5, 1), 50);
  const pageId = typeof body.pageId === "string" && body.pageId.trim() ? body.pageId.trim() : null;
  const result = await syncBinderPrices(id, {
    firstPages,
    pageId,
    force: !!body.force,
  });
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result);
}
