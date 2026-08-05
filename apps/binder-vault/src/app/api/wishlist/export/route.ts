import { NextResponse } from "next/server";
import { wishlistExportSchema, type WishlistItem } from "@/lib/contracts";
import { collectWishlistItems } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = wishlistExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { binderId, starredOnly, includeImages, includePrices, note, contactName } =
    parsed.data;

  const rows = await collectWishlistItems({
    binderId: binderId ?? null,
    starredOnly,
  });

  const items: WishlistItem[] = rows.map((r) => ({
    ...r,
    // Strip image URLs when caller opts out (smaller payload + no broken imgs in print).
    imageUrl: includeImages ? r.imageUrl : null,
    imageLocal: includeImages ? r.imageLocal : null,
    priceMarket: includePrices ? r.priceMarket : null,
    priceCurrency: includePrices ? r.priceCurrency : null,
  }));

  return NextResponse.json({
    generatedAt: Date.now(),
    options: { binderId: binderId ?? null, starredOnly, includeImages, includePrices, note, contactName },
    items,
    count: items.length,
  });
}
