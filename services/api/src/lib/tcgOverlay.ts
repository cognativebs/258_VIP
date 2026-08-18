import type { ApiHolding } from "./holdings.js";

export function binderSlotId(holdingId: string): string | null {
  return holdingId.startsWith("binder-slot-")
    ? holdingId.slice("binder-slot-".length)
    : null;
}

/**
 * Durable Binder→VIP rows can lag the live pocket (name/art saved in Binder
 * after Push). Overlay display fields from the live slot — never invent a name.
 */
export function overlayBinderDisplay(
  holding: ApiHolding,
  live: ApiHolding | undefined,
): ApiHolding {
  if (!live) return holding;
  return {
    ...holding,
    cardName: live.cardName ?? holding.cardName,
    coverImageUrl: live.coverImageUrl ?? holding.coverImageUrl,
    series: live.series || holding.series,
    issue: live.issue || holding.issue,
    rarity: live.rarity ?? holding.rarity,
    assetName: live.assetName || holding.assetName,
  };
}

export function liveBinderBySlotId(holdings: ApiHolding[]): Map<string, ApiHolding> {
  const map = new Map<string, ApiHolding>();
  for (const h of holdings) {
    const id = binderSlotId(h.id);
    if (id) map.set(id, h);
  }
  return map;
}
