import {
  resolveFmv,
  type CategoryKind,
  type SellingAssetInput,
  type SellingDisposition,
} from "@vip/ebay-sell";
import type { ApiHolding } from "../holdings.js";

export function categoryFromHolding(holding: ApiHolding): CategoryKind {
  if (holding.categoryKind) return holding.categoryKind;
  const sources = new Set((holding.externalIds ?? []).map((e) => e.source.toLowerCase()));
  if (sources.has("pokemontcg") || sources.has("tcgdex") || holding.id.startsWith("binder-slot-")) {
    return "pokemon";
  }
  if (holding.publisher) return "comic";
  return "other";
}

export function holdingToSellingAsset(holding: ApiHolding): SellingAssetInput {
  const fmv = resolveFmv({
    liveLow: holding.liveLow,
    liveHigh: holding.liveHigh,
    liveListingCount: holding.liveListingCount,
    snapshotPrice: holding.currentPrice,
  });
  return {
    inventoryId: holding.id,
    holdingUuid: holding.holdingUuid ?? null,
    sourceRowId: holding.id,
    sku: holding.ebaySku ?? undefined,
    category: categoryFromHolding(holding),
    sport: holding.sport ?? null,
    year: holding.year ?? null,
    manufacturer: holding.manufacturer ?? holding.publisher ?? null,
    setName: holding.setName ?? holding.series ?? null,
    playerSubject: holding.playerSubject ?? holding.cardName ?? holding.series ?? holding.assetName,
    team: holding.team ?? null,
    cardNumber: holding.cardNumber ?? holding.issue ?? null,
    parallel: holding.parallel ?? null,
    serialNumber: holding.serialNumber ?? null,
    rookieFlag: holding.rookieFlag ?? false,
    autographFlag: holding.autographFlag ?? false,
    relicFlag: holding.relicFlag ?? false,
    grader: holding.grader ?? null,
    grade: holding.gradeLabel ?? holding.assumedGrade ?? null,
    gradeNumeric: holding.gradeRating ?? null,
    condition: holding.assumedGrade ?? null,
    costBasis: holding.purchasePrice ?? null,
    fmv,
    frontImageUri: holding.frontImageUri ?? holding.coverImageUrl ?? null,
    backImageUri: holding.backImageUri ?? null,
    storageLocation: holding.location ?? null,
    ownershipBucket: holding.inventoryBucket ?? "dealer_inventory",
    currentDisposition: (holding.currentDisposition as SellingDisposition | null) ?? null,
    salesPathState: holding.salesPathState ?? "available",
    quantity: holding.quantity,
    playerTier: holding.playerTier ?? "unknown",
    parallelScarce: holding.parallelScarce ?? false,
    strongPlayerDemand: Boolean(holding.liquidityScore && holding.liquidityScore >= 70),
    strongSearchability: Boolean(holding.series || holding.cardName),
    saleVelocity: holding.saleVelocity ?? "unknown",
    marketTrend: "unknown",
    pcThesis: holding.inventoryBucket === "personal_collection",
    holdThesis: holding.recommendationLabel?.toLowerCase().includes("hold") ?? false,
    gradeThesis: holding.needsGrading,
    daysInInventory: holding.daysInInventory ?? null,
    relatedLotCount: holding.relatedLotCount ?? 0,
  };
}
