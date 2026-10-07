import type { ApiHolding } from "./holdings.js";

export type SnapshotHolding = Pick<
  ApiHolding,
  "id" | "currentPrice" | "quantity" | "pillar" | "soldAt" | "salesPathState"
>;

/** Need-Binder / hunt pockets are not owned inventory. */
export function isOwnedForSnapshot(h: SnapshotHolding): boolean {
  if (h.soldAt) return false;
  if (h.salesPathState === "sold") return false;
  const pillar = h.pillar ?? "";
  if (pillar.includes("Need (Binder)") || pillar === "TCG Need (Binder)") return false;
  return true;
}

/**
 * Portfolio Snapshot Sum: each owned holding once.
 * CLZ Current Price is a unit snapshot — multiply by quantity.
 * Need-Binder catalog prices are excluded so the same set price is not
 * added once per empty pocket.
 */
export function ownedSnapshotSum(holdings: SnapshotHolding[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const h of holdings) {
    if (!isOwnedForSnapshot(h)) continue;
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    total += (h.currentPrice ?? 0) * (h.quantity || 1);
  }
  return Number(total.toFixed(2));
}
