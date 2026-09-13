import { markInferred } from "@vip/evidence";
import {
  StoreSkuSchema,
  type StoreCategory,
  type StoreSku,
  type StoreSkuStatus,
} from "./schemas.js";
import { STORE_INVENTORY_VERSION } from "./version.js";

export const CATEGORY_MARGIN_TARGETS: Record<StoreCategory, { min: number; target: number; note: string }> = {
  sealed: {
    min: 0.18,
    target: 0.28,
    note: "Price off invoice + freight, then glance secondary. Never mark sealed at secondary mid on day one.",
  },
  singles: {
    min: 0.35,
    target: 0.5,
    note: "Singles pay rent. If it cannot clear 35% after fees, it is a binder Queen, not case product.",
  },
  graded: {
    min: 0.18,
    target: 0.25,
    note: "Slabs move slower. Tighter margin, tighter buy. Dead slabs become cash via auction, not a 40% sticker.",
  },
  accessories: {
    min: 0.4,
    target: 0.55,
    note: "Sleeves/toploaders are grocery. High margin, never discount except to close a card sale.",
  },
};

export const SEASONAL_NOTES: { match: (sku: StoreSku) => boolean; note: string }[] = [
  {
    match: (s) => /pokemon|prismatic|evolut|surging|destined|ascended/i.test(`${s.name} ${s.sku}`),
    note: "TCG: 6–8 week chase after a set drop, then singles dump. Reorder sealed only while allocation is tight.",
  },
  {
    match: (s) => /bowman|topps chrome|prizm|optic|select/i.test(s.name),
    note: "Sports: in-season + draft/rookie windows. Off-season is when you liquidate last year's hobby boxes.",
  },
  {
    match: (s) => s.category === "sealed" && /football|nfl/i.test(s.name),
    note: "Football sealed peaks Aug–Jan. March leftovers are dead weight.",
  },
  {
    match: (s) => s.category === "sealed" && /baseball|mlb|bowman/i.test(s.name),
    note: "Baseball sealed peaks Feb–July (Bowman + season). Autumn is liquidation.",
  },
  {
    match: (s) => /batman|spider-man|x-men|absolute/i.test(s.name),
    note: "Comics: movie/show windows + first arcs. After issue 6 of a new #1, leftover cases are discount bins.",
  },
  {
    match: (s) => s.category === "graded",
    note: "Graded: tax-refund + holiday gift weeks. Summer show season is for buying, not sitting on slabs.",
  },
];

export const DEAD_STOCK_WORKFLOW = [
  {
    day: 90,
    label: "Watch",
    action: "Move to the front counter or a $5/10/20 bin. Cut list 15%. Stop reordering.",
  },
  {
    day: 120,
    label: "Show lot",
    action: "Bundle with a mover (etb + dead sleeper, or 3 singles). Take it to the next show.",
  },
  {
    day: 180,
    label: "Liquidate",
    action: "Auction / group break / staff sale at cost. Do not 'wait for the next set'. That is how rooms fill.",
  },
] as const;

export function scoreStoreSku(raw: StoreSku): StoreSkuStatus {
  const sku = StoreSkuSchema.parse(raw);
  const target = CATEGORY_MARGIN_TARGETS[sku.category];
  const marginPct = sku.listPrice > 0 ? (sku.listPrice - sku.unitCost) / sku.listPrice : null;
  const vsTarget =
    marginPct == null
      ? "unknown"
      : marginPct >= target.target
        ? "above"
        : marginPct >= target.min
          ? "on"
          : "below";

  const daily = sku.unitsSold90d / 90;
  const daysOfSupply = daily > 0 ? sku.qtyOnHand / daily : sku.qtyOnHand > 0 ? 999 : 0;
  const reorder = sku.qtyOnHand <= sku.reorderPointQty && daysOfSupply < 45 && sku.unitsSold90d > 0;

  let deadStock: StoreSkuStatus["deadStock"] = "none";
  if ((sku.daysSinceLastSale ?? 0) >= 180 || (sku.unitsSold90d === 0 && sku.qtyOnHand > 0)) {
    deadStock = "liquidate";
  } else if ((sku.daysSinceLastSale ?? 0) >= 90 || daysOfSupply > 180) {
    deadStock = "watch";
  }

  let listVsSecondary: StoreSkuStatus["listVsSecondary"] = "no_secondary";
  if (sku.secondaryLow != null && sku.secondaryHigh != null) {
    if (sku.listPrice < sku.secondaryLow) listVsSecondary = "under";
    else if (sku.listPrice > sku.secondaryHigh) listVsSecondary = "over";
    else listVsSecondary = "in_band";
  }

  const seasonal =
    SEASONAL_NOTES.find((s) => s.match(sku))?.note ??
    (sku.category === "sealed"
      ? "Sealed: track allocation week-by-week. Secondary is a ceiling, not a cost-plus target."
      : target.note);

  let nextAction = "Hold and restock on trigger.";
  if (deadStock === "liquidate") nextAction = DEAD_STOCK_WORKFLOW[2].action;
  else if (deadStock === "watch") nextAction = DEAD_STOCK_WORKFLOW[0].action;
  else if (vsTarget === "below") nextAction = "Raise list or stop buying this SKU — margin is under category floor.";
  else if (listVsSecondary === "over" && sku.category === "sealed") {
    nextAction = "You are above secondary. Match the high or you will watch it sit.";
  } else if (reorder) nextAction = "Reorder — days of supply under 45 and on-hand at/under trigger.";

  return {
    sku: sku.sku,
    name: sku.name,
    category: sku.category,
    marginPct,
    vsTarget,
    daysOfSupply: Number.isFinite(daysOfSupply) ? Math.round(daysOfSupply) : null,
    reorder,
    deadStock,
    listVsSecondary,
    seasonalNote: seasonal,
    nextAction,
  };
}

export function scoreStoreBook(skus: StoreSku[]): {
  rows: StoreSkuStatus[];
  reorderCount: number;
  liquidateCount: number;
  belowMarginCount: number;
  provenance: ReturnType<typeof markInferred>;
} {
  const rows = skus.map(scoreStoreSku);
  return {
    rows,
    reorderCount: rows.filter((r) => r.reorder).length,
    liquidateCount: rows.filter((r) => r.deadStock === "liquidate").length,
    belowMarginCount: rows.filter((r) => r.vsTarget === "below").length,
    provenance: markInferred({
      source: "store_inventory_margin",
      ruleOrModelVersion: STORE_INVENTORY_VERSION,
      confidence: 0.55,
      notes: "Days-of-supply and dead-stock bands are rules, not POS truth. Secondary bands stay unverified unless a comps adapter filled them.",
    }),
  };
}

export const SEALED_PRICING_RULES = [
  "Invoice + freight + shrink is the floor. Secondary mid is not a cost.",
  "If secondary high < floor, you do not have a product — you have a lot. Liquidate or do not buy the case.",
  "Allocation week: price at secondary low + 5–10%, not MSRP, not eBay sold outliers.",
  "After week 6 of a TCG set, sealed that is still on the wall is inventory risk. Cut before the reprint rumor.",
  "Never use PriceCharting 'new' as a sealed sticker without checking eBay sold that morning.",
] as const;

export const SAMPLE_STORE_SKUS: StoreSku[] = [
  {
    sku: "PKM-PE-ETB",
    name: "Pokémon Prismatic Evolutions ETB",
    category: "sealed",
    qtyOnHand: 18,
    unitCost: 48,
    listPrice: 64,
    secondaryLow: 52,
    secondaryHigh: 68,
    unitsSold90d: 42,
    daysSinceLastSale: 2,
    reorderPointQty: 8,
    targetMarginPct: 0.28,
  },
  {
    sku: "BB-26-CHROME-HBY",
    name: "2026 Bowman Chrome Hobby",
    category: "sealed",
    qtyOnHand: 6,
    unitCost: 210,
    listPrice: 279,
    secondaryLow: 240,
    secondaryHigh: 290,
    unitsSold90d: 9,
    daysSinceLastSale: 6,
    reorderPointQty: 2,
    targetMarginPct: 0.28,
  },
  {
    sku: "ABS-BAT-001",
    name: "Absolute Batman #1",
    category: "singles",
    qtyOnHand: 24,
    unitCost: 4.5,
    listPrice: 12,
    secondaryLow: 8,
    secondaryHigh: 14,
    unitsSold90d: 31,
    daysSinceLastSale: 1,
    reorderPointQty: 10,
    targetMarginPct: 0.5,
  },
  {
    sku: "CHAR-UNL-RAW",
    name: "Base Set Charizard #4 raw bin",
    category: "singles",
    qtyOnHand: 3,
    unitCost: 190,
    listPrice: 275,
    secondaryLow: 220,
    secondaryHigh: 280,
    unitsSold90d: 2,
    daysSinceLastSale: 18,
    reorderPointQty: 1,
    targetMarginPct: 0.5,
  },
  {
    sku: "PSA10-MODERN-RB",
    name: "PSA 10 modern football random",
    category: "graded",
    qtyOnHand: 11,
    unitCost: 85,
    listPrice: 99,
    secondaryLow: 70,
    secondaryHigh: 110,
    unitsSold90d: 1,
    daysSinceLastSale: 54,
    reorderPointQty: 0,
    targetMarginPct: 0.25,
  },
  {
    sku: "CZ-ETB-DEAD",
    name: "Crown Zenith ETB (leftover)",
    category: "sealed",
    qtyOnHand: 14,
    unitCost: 44,
    listPrice: 59,
    secondaryLow: 36,
    secondaryHigh: 44,
    unitsSold90d: 0,
    daysSinceLastSale: 210,
    reorderPointQty: 0,
    targetMarginPct: 0.28,
  },
  {
    sku: "SLV-TOPE-100",
    name: "Ultra Pro toploaders 25ct",
    category: "accessories",
    qtyOnHand: 40,
    unitCost: 2.1,
    listPrice: 5.99,
    secondaryLow: null,
    secondaryHigh: null,
    unitsSold90d: 90,
    daysSinceLastSale: 0,
    reorderPointQty: 16,
    targetMarginPct: 0.55,
  },
];
