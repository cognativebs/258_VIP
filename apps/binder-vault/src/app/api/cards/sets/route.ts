import { NextResponse } from "next/server";
import { listSets } from "@/lib/cards";
import { SEED_SETS } from "@/lib/set-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sets = await listSets(250);
    return NextResponse.json({
      sets: sets.length ? sets : SEED_SETS,
      source: sets.length > SEED_SETS.length ? "live+seed" : "seed-or-cache",
    });
  } catch (e) {
    // Never leave the picker empty — seed catalog is enough to browse.
    return NextResponse.json({
      sets: SEED_SETS,
      source: "seed",
      error: String(e),
    });
  }
}
