// Tiered buy-side offer engine — store IP, not AI guessing.
// Used by Catalog + Acquire flows.

import { getPricing, mergePricing } from "./pricingService.js";

export const OFFER_CONFIG = {
  tiers: [
    { max: 5, buyPct: 0.30, label: "Bulk" },
    { max: 20, buyPct: 0.45, label: "Low" },
    { max: 75, buyPct: 0.55, label: "Mid" },
    { max: 300, buyPct: 0.62, label: "High" },
    { max: 1000, buyPct: 0.68, label: "Premium" },
    { max: Infinity, buyPct: 0.72, label: "Grail" },
  ],
  demandMultiplier: { hot: 1.08, healthy: 1.0, soft: 0.88, dead: 0.70 },
  velocityHaircut: { fast: 1.0, medium: 0.95, slow: 0.85 },
  maxOfferUplift: 1.10,
};

export function tierFor(price) {
  return OFFER_CONFIG.tiers.find((t) => price <= t.max);
}

/** @typedef {'hot'|'healthy'|'soft'|'dead'} Demand */
/** @typedef {'fast'|'medium'|'slow'} Velocity */

export function liquidityToDemand(liquidity, trend30d = 0) {
  if (liquidity >= 85 && trend30d > 5) return "hot";
  if (liquidity >= 65) return "healthy";
  if (liquidity >= 40) return "soft";
  return "dead";
}

/**
 * Map IQVault catalog asset + grade to acquisition card signals.
 */
export function assetToCardSignals(asset, gradeKey = "raw") {
  const m = asset.market?.[gradeKey] || asset.market?.raw;
  if (!m) return null;

  const demand = liquidityToDemand(m.liquidity ?? 50, m.trend_30d ?? 0);
  const velocity = m.velocity || "medium";
  const isGraded = gradeKey !== "raw";
  const gradeLabel =
    gradeKey === "raw"
      ? null
      : gradeKey === "psa10"
        ? "PSA 10"
        : gradeKey === "psa9"
          ? "PSA 9"
          : gradeKey === "cgc98"
            ? "CGC 9.8"
            : gradeKey.toUpperCase();

  return {
    assetId: asset.id,
    name: asset.canonical_name,
    category: asset.category,
    condition: asset.format === "sealed_product" ? "sealed" : isGraded ? "graded" : "raw",
    grade: gradeLabel,
    marketValue: m.price,
    demand,
    velocity,
    confidence: 92,
    notes: asset.slug ? `Catalog: ${asset.slug}` : undefined,
    image: asset.image,
  };
}

/**
 * Compute buy offer for a single identified item.
 */
export function computeCardOffer(card) {
  const mv = card.marketValue || 0;
  const tier = tierFor(mv);
  const demandMult = OFFER_CONFIG.demandMultiplier[card.demand] ?? 1.0;
  const velocityMult = OFFER_CONFIG.velocityHaircut[card.velocity] ?? 0.95;

  const baseOffer = mv * tier.buyPct * demandMult * velocityMult;
  const recommended = Math.max(0, baseOffer);
  const maximum = recommended * OFFER_CONFIG.maxOfferUplift;

  let avoid = false;
  let avoidReason = "";
  if (mv < 1.5) {
    avoid = true;
    avoidReason = "Bulk — not worth handling";
  } else if (card.demand === "dead") {
    avoid = true;
    avoidReason = "No local demand";
  } else if (card.velocity === "slow" && mv < 10) {
    avoid = true;
    avoidReason = "Slow mover, low value";
  }

  return {
    recommended: Math.round(recommended * 100) / 100,
    maximum: Math.round(maximum * 100) / 100,
    buyPct: tier.buyPct,
    tier: tier.label,
    avoid,
    avoidReason,
    demandMult,
    velocityMult,
  };
}

export function attachOffer(card) {
  return { ...card, offer: computeCardOffer(card) };
}

export function estimateSellThrough(cards) {
  const keep = cards.filter((c) => !c.offer?.avoid);
  if (keep.length === 0) return { sellThrough: 0, daysToSell: 0 };

  const demandScore = { hot: 95, healthy: 80, soft: 60, dead: 30 };
  const velocityDays = { fast: 21, medium: 45, slow: 90 };
  const avgSell =
    keep.reduce((s, c) => s + (demandScore[c.demand] ?? 65), 0) / keep.length;
  const avgDays =
    keep.reduce((s, c) => s + (velocityDays[c.velocity] ?? 45), 0) / keep.length;

  return { sellThrough: Math.round(avgSell), daysToSell: Math.round(avgDays) };
}

export function gradeCollection(totalMV, totalOffer, sellThrough) {
  const margin = totalMV > 0 ? (totalMV - totalOffer) / totalMV : 0;
  const score = margin * 60 + (sellThrough / 100) * 40;
  if (score >= 50) return "A";
  if (score >= 44) return "A-";
  if (score >= 38) return "B+";
  if (score >= 32) return "B";
  if (score >= 26) return "C+";
  return "C";
}

export function gradeColor(grade) {
  if (grade.startsWith("A")) return "var(--green)";
  if (grade.startsWith("B")) return "var(--blue)";
  return "var(--gold)";
}

export function aggregateIntake(cards) {
  const keep = cards.filter((c) => !c.offer?.avoid);
  const avoid = cards.filter((c) => c.offer?.avoid);
  const totalRetail = keep.reduce((s, c) => s + (c.marketValue || 0), 0);
  const totalRecommended = keep.reduce((s, c) => s + (c.offer?.recommended || 0), 0);
  const totalMax = keep.reduce((s, c) => s + (c.offer?.maximum || 0), 0);
  const { sellThrough, daysToSell } = estimateSellThrough(cards);
  const dealGrade = gradeCollection(totalRetail, totalRecommended, sellThrough);
  const avgPriceConfidence = keep.length
    ? Math.round(keep.reduce((s, c) => s + (c.priceConfidence ?? 0), 0) / keep.length)
    : 0;

  return {
    keep,
    avoid,
    totalRetail,
    totalEbay: totalRetail * 0.9,
    totalRecommended,
    totalMax,
    sellThrough,
    daysToSell,
    dealGrade,
    avgPriceConfidence,
    projectedProfit: totalRetail - totalRecommended,
  };
}

// Demo intake: each photo "surfaces" cards from IQVault catalog (mock ID path).
export const INTAKE_PHOTO_CARDS = [
  ["a2-sports-mclaurin-silver", "a2-sports-mclaurin-base"],
  ["a1-pkmn-charizard-sar"],
  ["a5-comic-batman-1a", "a5-comic-batman-1a-p3"],
  ["a6-sealed-etb"],
  ["a3-sports-mclaurin-ruby"],
];

/**
 * Mock identify: maps uploaded photos → catalog assets (stage 1 only — no pricing).
 */
export function mockIdentifyPhotos(photoCount, getAsset) {
  const seen = new Set();
  const cards = [];

  for (let p = 0; p < photoCount; p++) {
    const bundle = INTAKE_PHOTO_CARDS[p % INTAKE_PHOTO_CARDS.length];
    for (const assetId of bundle) {
      if (seen.has(assetId)) continue;
      seen.add(assetId);
      const asset = getAsset(assetId);
      if (!asset) continue;
      const signals = assetToCardSignals(asset);
      if (!signals) continue;
      cards.push({
        ...signals,
        sourceImage: p,
        idConfidence: 78 + (p * 3) % 18,
      });
    }
  }

  return cards;
}

/** @deprecated Use mockIdentifyPhotos + getPricing pipeline */
export function mockAnalyzePhotos(photoCount, getAsset) {
  return mockIdentifyPhotos(photoCount, getAsset).map((c) => attachOffer(c));
}

/**
 * Two-stage intake: Identify → Price (comps) → Offer.
 */
export async function runIntakePipeline(photoCount, getAsset, onProgress) {
  const identified = mockIdentifyPhotos(photoCount, getAsset);

  for (let i = 0; i < photoCount; i++) {
    onProgress?.(`Identifying cards — photo ${i + 1} of ${photoCount}…`);
    await new Promise((r) => setTimeout(r, 650));
  }

  if (identified.length === 0) return [];

  const priced = [];

  for (let j = 0; j < identified.length; j++) {
    const card = identified[j];
    onProgress?.(`Pricing ${j + 1} of ${identified.length}: ${card.name.slice(0, 40)}…`);
    const pricing = await getPricing(card, getAsset);
    const merged = mergePricing(card, pricing);
    priced.push({ ...merged, offer: computeCardOffer(merged) });
  }

  return priced;
}
