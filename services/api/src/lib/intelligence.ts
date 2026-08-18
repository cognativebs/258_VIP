import { PredictionLedger } from "@vip/signals";
import {
  INTELLIGENCE_VERSION,
  binderPageCompletion,
  calibrate,
  collectionQualityDensity,
  createPrediction,
  needsScoring,
  resolvePrediction,
  scoreSynergy,
  seedIntelligenceFixtures,
  uuidFromKey,
} from "@vip/intelligence";
import type { ApiHolding } from "./holdings.js";
import { loadIntelligenceDoc } from "./intelligenceStore.js";

/** Job-feed JSON + RSS exist. Postgres signals_raw / signals_normalized are not live. */
export const SIGNALS_INGESTION = {
  live: false,
  confirmed: false,
  mode: "job_feed_json",
  missing: [
    "signals_raw",
    "signals_normalized",
    "population_growth",
    "sales_velocity",
    "listing_supply",
    "social_intensity",
  ],
  blocks: ["market_cycle_detector", "buy_opportunity_scanner"],
  note: "Signals job feed and RSS adapter are wired. Phase 2 scoring stays blocked until signals_raw / signals_normalized are confirmed live — do not assume they are.",
} as const;

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function calibrationSamples() {
  const resolvedAt = new Date("2026-07-15T00:00:00.000Z");
  const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const mk = (id: string, predictedAt: string, actual: number) => {
    const row = createPrediction({
      id,
      assetId,
      predictedAt: new Date(predictedAt),
      priceAtPrediction: 100,
      horizonDays: 30,
      probabilityDown: 0.6,
      probabilitySideways: 0.25,
      probabilityUp: 0.15,
      modelVersion: "manual",
      assumptions: "Resolved SIR-style sample for calibration UI — not a live forecast",
    });
    return resolvePrediction(row, actual, resolvedAt, {
      explanation: "Manual resolution for calibration surface",
    });
  };
  return [
    mk("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "2026-05-01T00:00:00.000Z", 78),
    mk("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "2026-05-02T00:00:00.000Z", 72),
    mk("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", "2026-05-03T00:00:00.000Z", 81),
  ];
}

const fixtures = seedIntelligenceFixtures();
const claimLedger = new PredictionLedger();
claimLedger.add({
  claim: "Mega Greninja ex SIR compresses from $230 within 90 days",
  probability: 0.55,
  action: "Hold",
  createdAt: fixtures.asOf,
  expiresAt: new Date(fixtures.asOf.getTime() + 90 * 86_400_000),
  evidenceRefs: [fixtures.crownZenith.id],
});

export function scoreHoldingsSynergy(holdings: ApiHolding[], asOf = new Date()) {
  return holdings
    .filter(
      (h) =>
        h.museumScore != null || h.investmentScore != null || h.liquidityScore != null,
    )
    .slice(0, 40)
    .map((h) => {
      const museum = h.museumScore ?? 0;
      const invest = h.investmentScore ?? 0;
      const liq = h.liquidityScore ?? 0;
      const market = Math.min(100, (h.currentPrice ?? 0) > 0 ? 55 : 35);
      const goals = h.pillar
        ? [uuidFromKey(`goal:${h.pillar.toLowerCase()}`)]
        : [];
      const scored = scoreSynergy({
        holdingId: uuidFromKey(h.id),
        evaluatedAt: asOf,
        marketAttractiveness: market,
        museumImportance: museum,
        investmentScore: invest,
        liquidityScore: liq,
        contributingGoalIds: goals,
        notes: `${h.assetName} · pillar ${h.pillar ?? "none"} · inferred scores`,
      });
      const density = collectionQualityDensity({
        museumImportance: museum,
        investmentScore: invest,
        liquidityScore: liq,
        collectionSynergyScore: scored.collectionSynergyScore,
        capitalDeployed: h.currentPrice ?? 1,
      });
      return {
        ...scored,
        holdingId: h.id,
        assetName: h.assetName,
        density,
      };
    });
}

export function intelligenceSnapshot(
  asOf = new Date(),
  extras?: {
    holdings?: ApiHolding[];
    binderPages?: Awaited<ReturnType<typeof import("./binderHoldings.js").loadBinderTcg>>["pages"];
  },
) {
  const doc = loadIntelligenceDoc();
  const predictions = [...doc.predictions, ...calibrationSamples()];
  const museum = binderPageCompletion(fixtures.museumPage, fixtures.museumOwned);
  const liveSynergy = extras?.holdings ? scoreHoldingsSynergy(extras.holdings, asOf) : [];
  const gradingNamed = {
    flareon: doc.grading.find((g) => g.notes?.includes("Flareon")) ?? fixtures.grading.flareon,
    jolteon: doc.grading.find((g) => g.notes?.includes("Jolteon")) ?? fixtures.grading.jolteon,
    snorlax: doc.grading.find((g) => g.notes?.includes("Snorlax")) ?? fixtures.grading.snorlax,
    chansey: doc.grading.find((g) => g.notes?.includes("Chansey")) ?? fixtures.grading.chansey,
  };
  const gradingQueue = [...doc.grading].sort(
    (a, b) => (b.gradingOpportunityScore ?? 0) - (a.gradingOpportunityScore ?? 0),
  );

  return jsonSafe({
    version: INTELLIGENCE_VERSION,
    asOf: asOf.toISOString(),
    signalsIngestion: SIGNALS_INGESTION,
    predictions: {
      open: predictions.filter((p) => !p.resolvedAt),
      needsScoring: needsScoring(predictions, asOf),
      calibration: calibrate(predictions),
      claimLedger: claimLedger.calibrationSummary(),
      claims: claimLedger.list(),
      all: doc.predictions,
    },
    recommendations: doc.recommendations,
    underwriting: doc.underwriting,
    grading: gradingNamed,
    gradingQueue,
    collection: {
      goals: fixtures.goals,
      synergy: [fixtures.blastoisePiplup, ...liveSynergy],
      binder: {
        museumPage: fixtures.museumPage,
        museumCompletion: museum,
        culturalIconsPageType: fixtures.culturalIcons.pageType,
        livePages: extras?.binderPages ?? [],
      },
    },
    phase2: {
      scoringEnabled: false,
      manualCycle: doc.cycleStates,
      manualScans: doc.buyScans,
    },
    field: {
      sessions: doc.fieldSessions,
      captures: doc.captures,
    },
    identification: {
      goldenCases: doc.goldenCases,
      goldenCount: doc.goldenCases.length,
      target: 250,
      cardScans: doc.cardScans.length,
    },
  });
}
