import { NextResponse } from "next/server";
import { searchCards, type CardSource } from "@/lib/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const sourceParam = (searchParams.get("source") ?? "all") as CardSource;
  const source: CardSource = ["all", "tcgdex", "pokemontcg"].includes(sourceParam)
    ? sourceParam
    : "all";
  const setId = searchParams.get("set") || null;
  // Multi-select: ?rarity=ir,sir or repeated ?rarity=ir&rarity=sir
  const rarityKeys = searchParams
    .getAll("rarity")
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  // Set browse needs room for full promo sets (smp ≈ 251). Name search stays tight.
  const maxLimit = setId ? 500 : 60;
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 24, 1), maxLimit);

  try {
    const { results, errors, queryUsed } = await searchCards(q, {
      source,
      limit,
      setId,
      rarityKeys,
    });
    return NextResponse.json({
      query: q,
      source,
      set: setId,
      rarity: rarityKeys,
      queryUsed,
      results,
      errors,
    });
  } catch (e) {
    return NextResponse.json({
      query: q,
      source,
      set: setId,
      rarity: rarityKeys,
      queryUsed: "",
      results: [],
      errors: [e instanceof Error ? e.message : String(e)],
    });
  }
}
