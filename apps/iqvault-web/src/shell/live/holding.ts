import type { Holding } from "@/lib/api";
import { valueRangeSchema, type ConfidenceWord, type ValueRangeProps, type VerificationState } from "../schemas";

export type LiveChip = {
  status: string;
  low: number | null;
  high: number | null;
  listingCount: number;
  recencyDays: number | null;
};

/** Display band from evidence count and age. Unknown recency cannot be High. */
export function confidenceFromEvidence(count: number, recencyDays: number | null): ConfidenceWord {
  if (count <= 0) return "none";
  if (count < 3 || (recencyDays != null && recencyDays > 45)) return "low";
  if (count < 8 || recencyDays == null || recencyDays > 14) return "medium";
  return "high";
}

const emptyListings = valueRangeSchema.parse({
  low: null,
  high: null,
  compCount: 0,
  recencyDays: null,
  confidence: "none",
  evidenceLabel: "listings",
});

export function rangeFromChip(chip: LiveChip | undefined): ValueRangeProps {
  if (!chip || chip.status !== "range" || chip.low == null || chip.high == null || chip.listingCount <= 0) {
    return emptyListings;
  }
  const recency = chip.recencyDays == null ? null : Math.round(chip.recencyDays);
  return valueRangeSchema.parse({
    low: chip.low,
    high: chip.high,
    compCount: chip.listingCount,
    recencyDays: recency,
    confidence: confidenceFromEvidence(chip.listingCount, recency),
    evidenceLabel: "listings",
  });
}

/** Holding columns only. A snapshot currentPrice is never a range. */
export function rangeFromHoldingFields(holding: {
  liveLow?: number | null;
  liveHigh?: number | null;
  liveListingCount?: number | null;
}): ValueRangeProps {
  const count = holding.liveListingCount ?? 0;
  if (holding.liveLow == null || holding.liveHigh == null || count <= 0) return emptyListings;
  return valueRangeSchema.parse({
    low: holding.liveLow,
    high: holding.liveHigh,
    compCount: count,
    recencyDays: null,
    confidence: confidenceFromEvidence(count, null),
    evidenceLabel: "listings",
  });
}

export function verificationFromHolding(holding: Holding): VerificationState {
  const unverified = holding.needsVerification || (holding.assumedGrade != null && holding.gradeRating == null);
  if (!unverified) return { verified: true };
  const grade = holding.assumedGrade?.trim();
  const noted = holding.verificationNotes?.trim();
  return {
    verified: false,
    label: noted || (grade ? `${grade} assumed · unverified` : "Condition unverified"),
  };
}

export type VaultCategory = "Comics" | "Pokémon" | "Sealed" | "Other";

export function categoryFromHolding(holding: Holding): VaultCategory {
  const blob = `${holding.assetName} ${holding.series} ${holding.pillar ?? ""}`.toLowerCase();
  const sources = new Set((holding.externalIds ?? []).map((row) => row.source));
  if (blob.includes("sealed") || blob.includes("booster")) return "Sealed";
  if (sources.has("scryfall") || blob.includes("magic")) return "Other";
  if (sources.has("pokemontcg") || sources.has("tcgdex") || (holding.pillar ?? "").includes("TCG") || holding.id.startsWith("binder-slot-")) {
    return "Pokémon";
  }
  if ((holding.pillar ?? "").toLowerCase().includes("sport")) return "Other";
  return "Comics";
}

export function detailFromHolding(holding: Holding): string {
  return [holding.publisher, holding.series, holding.issue, holding.assumedGrade ? `grade ${holding.assumedGrade}` : null]
    .filter((part) => part && part.trim())
    .join(" · ");
}

export type VaultAssetModel = {
  id: string;
  name: string;
  detail: string;
  category: VaultCategory;
  needsReview: boolean;
  verification: VerificationState;
  range: ValueRangeProps;
};

export function assetFromHolding(holding: Holding, chip?: LiveChip): VaultAssetModel {
  return {
    id: holding.id,
    name: holding.assetName,
    detail: detailFromHolding(holding),
    category: categoryFromHolding(holding),
    needsReview: holding.needsVerification,
    verification: verificationFromHolding(holding),
    range: chip ? rangeFromChip(chip) : rangeFromHoldingFields(holding),
  };
}

/** Pokémon bridge rows from pokemon-holdings-sample.json. Real Binder rows use binder_vault. */
export function isBridgeSeed(holding: {
  provenance?: { source?: string; ruleOrModelVersion?: string };
}): boolean {
  return (
    holding.provenance?.source === "vip_pokemon_seed" ||
    holding.provenance?.ruleOrModelVersion === "pokemon-seed@0.1.0"
  );
}

export function coverageFromAssets(assets: VaultAssetModel[]): {
  byAssetCovered: number;
  byAssetTotal: number;
  byAssetPercent: number | null;
  byValueNote: string;
} {
  const total = assets.length;
  const covered = assets.filter((asset) => asset.range.confidence !== "none").length;
  return {
    byAssetCovered: covered,
    byAssetTotal: total,
    byAssetPercent: total === 0 ? null : Math.round((100 * covered) / total),
    byValueNote: "By value is not computed. A snapshot total is not a range.",
  };
}
