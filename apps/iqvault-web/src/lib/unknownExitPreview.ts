import type { ComicsMeta, UnknownExitImpact } from "./comicTypes";

/** Keep in sync with @vip/core-model evaluateUnknownExitImpact. */
export function previewUnknownExit(meta: ComicsMeta | null, estimatedQty: number): UnknownExitImpact | null {
  if (!meta) return null;
  const catalogHoldings = meta.recordCount ?? 0;
  const catalogValue = meta.totalValue ?? 0;
  const pillar = (meta.pillars ?? []).find((p) => p.name === "General Inventory");
  const scopeHoldings = pillar?.count ?? 0;
  const scopeValue = pillar?.value ?? 0;
  const qty = Math.max(0, Math.floor(estimatedQty));
  const share = scopeHoldings <= 0 || qty <= 0 ? 0 : Math.min(1, qty / scopeHoldings);
  const unaccounted = Math.round(scopeValue * share * 100) / 100;
  const giftedHoldings = Math.min(qty, scopeHoldings);
  return {
    catalogHoldings,
    catalogValue: Math.round(catalogValue * 100) / 100,
    scopeName: "General Inventory",
    scopeHoldings,
    scopeValue: Math.round(scopeValue * 100) / 100,
    estimatedQty: qty,
    giftedShare: share,
    unaccountedValueHigh: unaccounted,
    physicalHoldingsLow: Math.max(0, catalogHoldings - giftedHoldings),
    physicalHoldingsHigh: catalogHoldings,
    physicalValueLow: Math.round(Math.max(0, catalogValue - unaccounted) * 100) / 100,
    physicalValueHigh: Math.round(catalogValue * 100) / 100,
    holdingsTouched: false,
    titlesInvented: false,
    verificationStatus: "unverified",
    method: "inferred",
    ruleOrModelVersion: "unknown-exit@0.1.0",
    recommendations: [
      {
        action: "Pass",
        appliesTo: "general_inventory_bulk",
        reasonCodes: ["UNRECORDED_BULK_EXIT", "TITLES_UNKNOWN", "DO_NOT_DELETE_HOLDINGS"],
        confidence: 0.4,
        notes: "Pass on treating General Inventory as physically confirmed stock.",
      },
      {
        action: "Hold",
        appliesTo: "keys_and_themed_pillars",
        reasonCodes: ["BULK_GIFT_OUTSIDE_KEYS", "STALE_CLZ_SNAPSHOT"],
        confidence: 0.55,
        notes: "Hold keys and themed pillars.",
      },
    ],
  };
}

export function moneyRange(low: number, high: number): string {
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  if (low === high) return `${fmt(low)} inferred · unverified`;
  return `${fmt(low)}–${fmt(high)} inferred · unverified`;
}
