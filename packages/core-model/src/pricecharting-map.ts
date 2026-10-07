import {
  PRICECHARTING_PRICE_KEYS,
  type ConditionKey,
  type MappedPriceObservation,
  type PriceChartingPriceKey,
  type PriceChartingProduct,
  type PriceChartingVertical,
  type PriceType,
} from "./pricecharting.js";

export type PriceChartingMapSkip = {
  skipped: true;
  reason: string;
  needsReview: true;
};

export type PriceChartingMapResult = {
  skipped: false;
  observations: MappedPriceObservation[];
  annualUnits: number | null;
};

type KeyMap = Record<
  PriceChartingPriceKey,
  { priceType: PriceType; conditionKey: ConditionKey } | null
>;

function retail(conditionKey: ConditionKey, side: "buy" | "sell") {
  return {
    priceType: (side === "buy" ? "retail_buy" : "retail_sell") as PriceType,
    conditionKey,
  };
}

/**
 * Comics grade ladder. Confirmed 2026-09-20 against official
 * pricecharting.com/api-documentation (Comics row) and public product
 * headers (Ungraded | 4.0/VG | 6.0/Fine | 8.0/VF | 9.2/NM- | 9.8).
 * Graded columns never collapse to raw_ungraded.
 */
export const COMIC_GUIDE_LADDER = [
  { vendorKey: "loose-price" as const, conditionKey: "raw_ungraded" as const, grade: "ungraded / raw" },
  { vendorKey: "cib-price" as const, conditionKey: "graded_4" as const, grade: "4.0 / 4.5" },
  { vendorKey: "new-price" as const, conditionKey: "graded_6" as const, grade: "6.0 / 6.5" },
  { vendorKey: "graded-price" as const, conditionKey: "graded_8" as const, grade: "8.0 / 8.5" },
  { vendorKey: "box-only-price" as const, conditionKey: "graded_9_2" as const, grade: "9.2" },
  { vendorKey: "condition-17-price" as const, conditionKey: "graded_9_4" as const, grade: "9.4" },
  { vendorKey: "manual-only-price" as const, conditionKey: "graded_9_8" as const, grade: "9.8" },
  { vendorKey: "bgs-10-price" as const, conditionKey: "graded_10" as const, grade: "10.0" },
] as const;

/**
 * Official PriceCharting key meanings differ by vertical.
 * Do not default. Unresolved vertical must skip.
 */
export function keyMapForVertical(vertical: PriceChartingVertical): KeyMap {
  if (vertical === "comic") {
    return {
      "loose-price": { priceType: "market_value", conditionKey: "raw_ungraded" },
      "cib-price": { priceType: "market_value", conditionKey: "graded_4" },
      "new-price": { priceType: "market_value", conditionKey: "graded_6" },
      "graded-price": { priceType: "market_value", conditionKey: "graded_8" },
      "box-only-price": { priceType: "market_value", conditionKey: "graded_9_2" },
      "manual-only-price": { priceType: "market_value", conditionKey: "graded_9_8" },
      "bgs-10-price": { priceType: "market_value", conditionKey: "graded_10" },
      "condition-17-price": { priceType: "market_value", conditionKey: "graded_9_4" },
      "condition-18-price": null,
      "retail-loose-buy": retail("raw_ungraded", "buy"),
      "retail-loose-sell": retail("raw_ungraded", "sell"),
      "retail-cib-buy": retail("graded_4", "buy"),
      "retail-cib-sell": retail("graded_4", "sell"),
      "retail-new-buy": retail("graded_6", "buy"),
      "retail-new-sell": retail("graded_6", "sell"),
    };
  }

  if (vertical === "pokemon" || vertical === "sports" || vertical === "mtg") {
    return {
      "loose-price": { priceType: "market_value", conditionKey: "raw_ungraded" },
      "cib-price": { priceType: "market_value", conditionKey: "graded_7" },
      "new-price": { priceType: "market_value", conditionKey: "graded_8" },
      "graded-price": { priceType: "market_value", conditionKey: "graded_9" },
      "box-only-price": { priceType: "market_value", conditionKey: "graded_9_5" },
      "manual-only-price": { priceType: "market_value", conditionKey: "graded_psa_10" },
      "bgs-10-price": { priceType: "market_value", conditionKey: "graded_bgs_10" },
      "condition-17-price": { priceType: "market_value", conditionKey: "graded_cgc_10" },
      "condition-18-price": { priceType: "market_value", conditionKey: "graded_sgc_10" },
      "retail-loose-buy": retail("raw_ungraded", "buy"),
      "retail-loose-sell": retail("raw_ungraded", "sell"),
      "retail-cib-buy": retail("graded_7", "buy"),
      "retail-cib-sell": retail("graded_7", "sell"),
      "retail-new-buy": retail("graded_8", "buy"),
      "retail-new-sell": retail("graded_8", "sell"),
    };
  }

  // video_games + other (Lego / coins land here until a dedicated vertical exists)
  return {
    "loose-price": { priceType: "market_value", conditionKey: "raw_ungraded" },
    "cib-price": { priceType: "market_value", conditionKey: "cib" },
    "new-price": { priceType: "market_value", conditionKey: "sealed_new" },
    "graded-price": { priceType: "market_value", conditionKey: "graded_wata" },
    "box-only-price": { priceType: "market_value", conditionKey: "box_only" },
    "manual-only-price": { priceType: "market_value", conditionKey: "manual_only" },
    "bgs-10-price": null,
    "condition-17-price": null,
    "condition-18-price": null,
    "retail-loose-buy": retail("raw_ungraded", "buy"),
    "retail-loose-sell": retail("raw_ungraded", "sell"),
    "retail-cib-buy": retail("cib", "buy"),
    "retail-cib-sell": retail("cib", "sell"),
    "retail-new-buy": retail("sealed_new", "buy"),
    "retail-new-sell": retail("sealed_new", "sell"),
  };
}

export function penniesToUsd(pennies: number): number {
  return Math.round(pennies) / 100;
}

/** CSV cells are dollars. API cells are integer pennies. */
export function csvDollarsToPennies(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const text = String(raw).replace(/[$,]/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function verticalFromConsoleName(
  consoleName: string | null | undefined,
): PriceChartingVertical | null {
  const s = (consoleName ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("comic")) return "comic";
  if (s.includes("pokemon") || s.includes("pokémon")) return "pokemon";
  if (s.includes("magic") || s.includes("mtg")) return "mtg";
  if (s.includes("baseball") || s.includes("basketball") || s.includes("football") || s.includes("hockey") || s.includes("soccer") || s.includes("sport")) {
    return "sports";
  }
  if (s.includes("nintendo") || s.includes("playstation") || s.includes("xbox") || s.includes("sega") || s.includes("game boy") || s.includes("switch")) {
    return "video_games";
  }
  return null;
}

export function mapPriceChartingProduct(
  product: PriceChartingProduct,
  vertical: PriceChartingVertical | null,
): PriceChartingMapResult | PriceChartingMapSkip {
  if (!vertical) {
    return {
      skipped: true,
      reason: "vertical unresolved — do not default PriceCharting key meanings",
      needsReview: true,
    };
  }

  const keymap = keyMapForVertical(vertical);
  const observations: MappedPriceObservation[] = [];

  for (const key of PRICECHARTING_PRICE_KEYS) {
    const spec = keymap[key];
    if (!spec) continue;
    const pennies = product[key];
    if (pennies == null || pennies <= 0) continue;
    observations.push({
      vendorProductId: product.id,
      vendorKey: key,
      priceType: spec.priceType,
      channel: "pricecharting",
      conditionKey: spec.conditionKey,
      priceUsd: penniesToUsd(pennies),
      evidenceClass: "vendor_derived",
    });
  }

  return {
    skipped: false,
    observations,
    annualUnits: product["sales-volume"] ?? null,
  };
}
