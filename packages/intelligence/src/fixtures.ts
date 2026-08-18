import { addDays } from "./math.js";
import { addBinderSlot, createBinderPage, createCollectionGoal } from "./binder.js";
import { createRecommendation } from "./evidence.js";
import { evaluateGrading } from "./grading.js";
import { recordManualBuyOpportunity, recordManualCycleState } from "./phase2.js";
import { createPrediction } from "./prediction.js";
import { scoreSynergy } from "./synergy.js";
import { underwrite } from "./underwriting.js";

/** Stable fixture IDs — conversation cases from 2026-08-15 plan. */
export const FIXTURE_IDS = {
  assetMegaGreninja: "11111111-1111-4111-8111-111111111111",
  assetCrownZenithEtb: "22222222-2222-4222-8222-222222222222",
  assetDrewBrees: "33333333-3333-4333-8333-333333333333",
  assetBlastoisePiplup: "44444444-4444-4444-8444-444444444444",
  holdingFlareon: "55555555-5555-4555-8555-555555555551",
  holdingJolteon: "55555555-5555-4555-8555-555555555552",
  holdingSnorlax: "55555555-5555-4555-8555-555555555553",
  holdingChansey: "55555555-5555-4555-8555-555555555554",
  holdingBlastoisePiplup: "66666666-6666-4666-8666-666666666666",
  goalBlastoiseMaster: "77777777-7777-4777-8777-777777777771",
  goalTagTeamMaster: "77777777-7777-4777-8777-777777777772",
  pageMuseum: "88888888-8888-4888-8888-888888888881",
  pageCulturalIcons: "88888888-8888-4888-8888-888888888882",
  predictionMegaGreninja: "99999999-9999-4999-8999-999999999991",
  recommendationCrownZenith: "99999999-9999-4999-8999-999999999992",
  underwritingVintageLot: "99999999-9999-4999-8999-999999999993",
} as const;

export const FIXTURE_AS_OF = new Date("2026-08-15T20:00:00.000Z");

const museumSlotAssets = [
  "a1111111-1111-4111-8111-000000000001",
  "a1111111-1111-4111-8111-000000000002",
  "a1111111-1111-4111-8111-000000000003",
  "a1111111-1111-4111-8111-000000000004",
  "a1111111-1111-4111-8111-000000000005",
  "a1111111-1111-4111-8111-000000000006",
  "a1111111-1111-4111-8111-000000000007",
  "a1111111-1111-4111-8111-000000000008",
  "a1111111-1111-4111-8111-000000000009",
] as const;

export function seedIntelligenceFixtures(asOf = FIXTURE_AS_OF) {
  const megaGreninja = createPrediction({
    id: FIXTURE_IDS.predictionMegaGreninja,
    assetId: FIXTURE_IDS.assetMegaGreninja,
    predictedAt: asOf,
    priceAtPrediction: 230,
    horizonDays: 90,
    probabilityDown: 0.55,
    probabilitySideways: 0.3,
    probabilityUp: 0.15,
    assumptions: "Post-release SIR compression still more likely than a hold at $230",
    confidence: 0.62,
    modelVersion: "manual",
  });

  const crownZenith = createRecommendation({
    id: FIXTURE_IDS.recommendationCrownZenith,
    assetId: FIXTURE_IDS.assetCrownZenithEtb,
    action: "buy",
    confidence: 0.94,
    rationale: "Crown Zenith PC ETB — shelf + comps still support BUY; expires 48h",
    createdAt: asOf,
    expiresAt: addDays(asOf, 2),
    sourceSystem: "recommendation_evidence_engine",
    evidence: [
      {
        evidenceSource: "shelf_observation",
        evidenceTimestamp: new Date(asOf.getTime() - 2 * 3_600_000),
        supportingEvidence: "PC ETB on shelf at observed ask",
        confidence: 0.9,
      },
      {
        evidenceSource: "sold_comp",
        evidenceTimestamp: new Date(asOf.getTime() - 14 * 3_600_000),
        supportingEvidence: "Market comps 14h old",
        confidence: 0.85,
      },
      {
        evidenceSource: "ownership_record",
        evidenceTimestamp: asOf,
        supportingEvidence: "IQVault ownership live",
        confidence: 1,
      },
      {
        evidenceSource: "collection_fit_score",
        evidenceTimestamp: asOf,
        supportingEvidence: "Collection fit 97",
        confidence: 0.97,
      },
    ],
  });

  const vintageLot = underwrite({
    id: FIXTURE_IDS.underwritingVintageLot,
    lotDescription: "Vintage Pokémon lot",
    evaluatedAt: asOf,
    askingPrice: 750,
    offerPrice: 700,
    conservativeRawValue: 1045,
    coverageRatioMinimumThreshold: 1.3,
    confidence: 0.7,
    notes: "Uncertain vintage lot — 1.30× minimum threshold",
  });

  const flareon = evaluateGrading({
    holdingId: FIXTURE_IDS.holdingFlareon,
    evaluatedAt: asOf,
    rawValue: 80,
    psa7: { probability: 0.05, value: 90 },
    psa8: { probability: 0.2, value: 120 },
    psa9: { probability: 0.5, value: 180 },
    psa10: { probability: 0.25, value: 400 },
    gradingCost: 25,
    shippingCost: 8,
    insuranceCost: 2,
    notes: "Flareon — manual PSA-tier case · unverified",
  });
  const jolteon = evaluateGrading({
    holdingId: FIXTURE_IDS.holdingJolteon,
    evaluatedAt: asOf,
    rawValue: 70,
    psa7: { probability: 0.1, value: 80 },
    psa8: { probability: 0.3, value: 100 },
    psa9: { probability: 0.45, value: 140 },
    psa10: { probability: 0.15, value: 220 },
    gradingCost: 25,
    shippingCost: 8,
    insuranceCost: 2,
    notes: "Jolteon — manual PSA-tier case · unverified",
  });
  const snorlax = evaluateGrading({
    holdingId: FIXTURE_IDS.holdingSnorlax,
    evaluatedAt: asOf,
    rawValue: 200,
    psa7: { probability: 0.15, value: 180 },
    psa8: { probability: 0.4, value: 200 },
    psa9: { probability: 0.35, value: 230 },
    psa10: { probability: 0.1, value: 280 },
    gradingCost: 25,
    shippingCost: 8,
    insuranceCost: 2,
    notes: "Snorlax — manual PSA-tier case · unverified",
  });
  const chansey = evaluateGrading({
    holdingId: FIXTURE_IDS.holdingChansey,
    evaluatedAt: asOf,
    rawValue: 60,
    psa7: { probability: 0.2, value: 55 },
    psa8: { probability: 0.4, value: 70 },
    gradingCost: 25,
    shippingCost: 8,
    notes: "Chansey — PSA 9/10 inputs missing → inspect further",
  });

  const goalBlastoise = createCollectionGoal({
    id: FIXTURE_IDS.goalBlastoiseMaster,
    name: "Blastoise Master Collection",
    goalType: "master_collection",
    createdAt: asOf,
  });
  const goalTagTeam = createCollectionGoal({
    id: FIXTURE_IDS.goalTagTeamMaster,
    name: "Tag Team Era Master Collection",
    goalType: "master_collection",
    createdAt: asOf,
  });

  const blastoisePiplup = scoreSynergy({
    holdingId: FIXTURE_IDS.holdingBlastoisePiplup,
    evaluatedAt: asOf,
    marketAttractiveness: 78,
    museumImportance: 92,
    investmentScore: 70,
    liquidityScore: 65,
    contributingGoalIds: [goalBlastoise.id, goalTagTeam.id],
    notes: "Blastoise & Piplup dual-goal contribution",
  });

  let museumPage = createBinderPage({
    id: FIXTURE_IDS.pageMuseum,
    pageType: "museum_page",
    collectionGoalId: goalBlastoise.id,
  });
  const museumTiers = [
    "museum_anchor",
    "binder_core",
    "binder_core",
    "binder_core",
    "binder_core",
    "completion",
    "completion",
    "completion",
    "filler",
  ] as const;
  museumTiers.forEach((tier, i) => {
    museumPage = addBinderSlot(museumPage, {
      slotNumber: i + 1,
      assetId: museumSlotAssets[i]!,
      tier,
      isMuseumAnchor: tier === "museum_anchor",
    });
  });
  const museumOwned = new Set(museumSlotAssets.filter((_, i) => i !== 7));

  const culturalIcons = createBinderPage({
    id: FIXTURE_IDS.pageCulturalIcons,
    pageType: "cultural_icons",
  });

  const drewBreesCycle = recordManualCycleState({
    assetId: FIXTURE_IDS.assetDrewBrees,
    evaluatedAt: asOf,
    cycleState: "accumulation",
    notes:
      "Drew Brees post-HOF — catalyst occurred, attention peaked, event passed, commodity cards soften, evaluate accumulation window",
  });
  const drewBreesWatch = recordManualBuyOpportunity({
    assetId: FIXTURE_IDS.assetDrewBrees,
    marketCycleStateId: drewBreesCycle.id,
    scannedAt: asOf,
    watchNote: "Drew Brees entered Accumulation Watch",
  });

  return {
    asOf,
    megaGreninja,
    crownZenith,
    vintageLot,
    grading: { flareon, jolteon, snorlax, chansey },
    goals: { blastoise: goalBlastoise, tagTeam: goalTagTeam },
    blastoisePiplup,
    museumPage,
    museumOwned,
    culturalIcons,
    drewBreesCycle,
    drewBreesWatch,
  };
}
