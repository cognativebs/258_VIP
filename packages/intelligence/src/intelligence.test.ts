import { describe, expect, it } from "vitest";
import { addDays } from "./math.js";
import {
  ALLOWED_IDENTIFICATION_PROVIDERS,
  FORBIDDEN_IDENTIFICATION_PROVIDERS,
  INTELLIGENCE_VERSION,
  PredictionLedgerError,
  UnderwritingError,
  assertAllowedProvider,
  assertForecastImmutable,
  auctionMaxBid,
  binderPageCompletion,
  calibrate,
  classifyMarketCycle,
  collectionQualityDensity,
  coverageRatio,
  createPrediction,
  createRecommendation,
  directionFromPrices,
  expectedIncrementalProfit,
  impliedDirection,
  lockUnderwriting,
  needsScoring,
  openIdentification,
  readRecommendation,
  recordCardScan,
  resolvePrediction,
  seedIntelligenceFixtures,
  supersedeIdentification,
  tradeBasketEquality,
  underwrite,
  wrapEngineRecommendation,
  scoreCohenCover,
  COHEN_IVY9_FIXTURE,
  COHEN_DIENAMITE_FIXTURE,
  classifyPrintLife,
} from "./index.js";

const fixtures = seedIntelligenceFixtures();

describe("Prediction Ledger", () => {
  it("freezes the Mega Greninja ex SIR fixture", () => {
    const p = fixtures.megaGreninja;
    expect(p.priceAtPrediction).toBe(230);
    expect(p.horizonDays).toBe(90);
    expect(p.probabilityDown).toBe(0.55);
    expect(p.probabilitySideways).toBe(0.3);
    expect(p.probabilityUp).toBe(0.15);
    expect(impliedDirection(p)).toBe("down");
    expect(p.resolvedAt).toBeNull();
  });

  it("never mutates forecast fields except to add resolution after resolvesAt", () => {
    const early = fixtures.asOf;
    expect(() =>
      resolvePrediction(fixtures.megaGreninja, 180, early),
    ).toThrow(PredictionLedgerError);

    const afterHorizon = addDays(fixtures.asOf, 91);
    const resolved = resolvePrediction(fixtures.megaGreninja, 180, afterHorizon, {
      explanation: "Post-release compression realized",
    });
    expect(resolved.actualDirection).toBe("down");
    expect(resolved.forecastError).toBe(-50);
    assertForecastImmutable(fixtures.megaGreninja, {
      ...resolved,
      actualPrice: fixtures.megaGreninja.actualPrice,
      actualDirection: fixtures.megaGreninja.actualDirection,
      forecastError: fixtures.megaGreninja.forecastError,
      explanation: fixtures.megaGreninja.explanation,
      modelAdjustment: fixtures.megaGreninja.modelAdjustment,
      resolvedAt: fixtures.megaGreninja.resolvedAt,
      provenance: fixtures.megaGreninja.provenance,
    });
    expect(() => resolvePrediction(resolved, 190, addDays(afterHorizon, 1))).toThrow(
      /never mutated/,
    );
  });

  it("surfaces unresolved predictions past resolvesAt in needs scoring", () => {
    const due = needsScoring([fixtures.megaGreninja], addDays(fixtures.asOf, 91));
    expect(due).toHaveLength(1);
    expect(needsScoring([fixtures.megaGreninja], fixtures.asOf)).toHaveLength(0);
  });

  it("returns directional accuracy and a systematic-bias note", () => {
    const base = createPrediction({
      assetId: fixtures.megaGreninja.assetId,
      predictedAt: new Date("2026-01-01T00:00:00Z"),
      priceAtPrediction: 100,
      horizonDays: 30,
      probabilityDown: 0.6,
      probabilitySideways: 0.3,
      probabilityUp: 0.1,
      modelVersion: "manual",
    });
    const asOf = new Date("2026-02-15T00:00:00Z");
    const resolved = [
      resolvePrediction(base, 80, asOf),
      resolvePrediction(
        createPrediction({
          assetId: fixtures.megaGreninja.assetId,
          predictedAt: new Date("2026-01-02T00:00:00Z"),
          priceAtPrediction: 100,
          horizonDays: 30,
          probabilityDown: 0.6,
          probabilitySideways: 0.3,
          probabilityUp: 0.1,
          modelVersion: "manual",
        }),
        70,
        asOf,
      ),
      resolvePrediction(
        createPrediction({
          assetId: fixtures.megaGreninja.assetId,
          predictedAt: new Date("2026-01-03T00:00:00Z"),
          priceAtPrediction: 100,
          horizonDays: 30,
          probabilityDown: 0.6,
          probabilitySideways: 0.3,
          probabilityUp: 0.1,
          modelVersion: "manual",
        }),
        75,
        asOf,
      ),
    ];
    const report = calibrate(resolved);
    expect(report[0]?.directionalAccuracyPct).toBe(100);
    expect(report[0]?.biasNote).toMatch(/overestimates|underestimates|bias/i);
    expect(directionFromPrices(230, 230)).toBe("sideways");
  });
});

describe("Recommendation Evidence Engine", () => {
  it("attaches evidence cards to the Crown Zenith BUY fixture", () => {
    const rec = fixtures.crownZenith;
    expect(rec.action).toBe("buy");
    expect(rec.confidence).toBe(0.94);
    expect(rec.evidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.evidence.map((e) => e.evidenceSource)).toEqual(
      expect.arrayContaining(["shelf_observation", "sold_comp"]),
    );
    const shelf = rec.evidence.find((e) => e.evidenceSource === "shelf_observation");
    const comps = rec.evidence.find((e) => e.evidenceSource === "sold_comp");
    expect(shelf?.freshnessHours).toBe(2);
    expect(comps?.freshnessHours).toBe(14);
  });

  it("flags stale recommendations on every read", () => {
    const live = readRecommendation(fixtures.crownZenith, fixtures.asOf);
    expect(live.isStale).toBe(false);
    const stale = readRecommendation(fixtures.crownZenith, addDays(fixtures.asOf, 3));
    expect(stale.isStale).toBe(true);
  });

  it("rejects a recommendation with no evidence card", () => {
    expect(() =>
      createRecommendation({
        assetId: fixtures.crownZenith.assetId,
        action: "buy",
        confidence: 0.5,
        createdAt: fixtures.asOf,
        expiresAt: addDays(fixtures.asOf, 1),
        sourceSystem: "manual",
        evidence: [],
      }),
    ).toThrow(/evidence_card/);
  });
});

describe("Acquisition Underwriting", () => {
  it("computes 1.49× coverage on the vintage lot and never auto-blocks", () => {
    const row = fixtures.vintageLot;
    expect(coverageRatio(1045, 700)).toBe(1.493);
    expect(row.acquisitionCoverageRatio).toBe(1.493);
    expect(row.belowThreshold).toBe(false);
    expect(row.blocked).toBe(false);
  });

  it("flags below-threshold rows for human review without blocking", () => {
    const flagged = underwrite({
      lotDescription: "Thin vintage lot",
      evaluatedAt: fixtures.asOf,
      askingPrice: 950,
      offerPrice: 900,
      conservativeRawValue: 1045,
    });
    expect(flagged.belowThreshold).toBe(true);
    expect(flagged.blocked).toBe(false);
    expect(flagged.notes).toMatch(/human review/i);
  });

  it("locks a completed transaction as immutable", () => {
    const locked = lockUnderwriting(fixtures.vintageLot, fixtures.asOf);
    expect(locked.completedTransaction).toBe(true);
    expect(() => lockUnderwriting(locked, addDays(fixtures.asOf, 1))).toThrow(
      UnderwritingError,
    );
  });
});

describe("Grading Optimizer", () => {
  it("keeps every profit term visible and stores a 0–100 score", () => {
    const { flareon, jolteon, snorlax, chansey } = fixtures.grading;
    expect(flareon.recommendation).toBe("grade");
    expect(jolteon.recommendation).toBe("grade");
    expect(snorlax.recommendation).toBe("sell_raw");
    expect(chansey.recommendation).toBe("inspect_further");

    for (const row of [flareon, jolteon, snorlax, chansey]) {
      expect(row.gradingOpportunityScore).toBeGreaterThanOrEqual(0);
      expect(row.gradingOpportunityScore).toBeLessThanOrEqual(100);
      const terms = expectedIncrementalProfit(row.expectedGradingValue, row);
      expect(terms.expectedIncrementalProfit).toBe(row.expectedIncrementalProfit);
      expect(terms.rawValue).toBe(row.rawValue);
      expect(terms.gradingCost).toBe(row.gradingCost);
    }
  });
});

describe("Binder Chase + Museum Synergy", () => {
  it("uses constrained tiers and a separate cultural_icons page type", () => {
    expect(fixtures.museumPage.pageType).toBe("museum_page");
    expect(fixtures.culturalIcons.pageType).toBe("cultural_icons");
    expect(fixtures.museumPage.slots).toHaveLength(9);
    expect(fixtures.museumPage.slots[0]?.tier).toBe("museum_anchor");
    expect(fixtures.museumPage.slots[8]?.tier).toBe("filler");
  });

  it("recommends RIP at >=8/9 filled and BUY_SINGLES when more is missing", () => {
    const rip = binderPageCompletion(fixtures.museumPage, fixtures.museumOwned);
    expect(rip.filledSlots).toBe(8);
    expect(rip.ripVsSinglesRecommendation).toBe("rip_candidate");

    const expensiveMissing = new Set(
      [...fixtures.museumOwned].filter((_, i) => i < 6),
    );
    const singles = binderPageCompletion(fixtures.museumPage, expensiveMissing);
    expect(singles.missingSlots).toBeGreaterThanOrEqual(2);
    expect(singles.ripVsSinglesRecommendation).toBe("buy_singles");
  });

  it("keeps synergy components queryable beside the composite", () => {
    const s = fixtures.blastoisePiplup;
    expect(s.contributingGoalIds).toEqual([
      fixtures.goals.blastoise.id,
      fixtures.goals.tagTeam.id,
    ]);
    expect(s.marketAttractiveness).toBe(78);
    expect(s.museumImportance).toBe(92);
    expect(s.investmentScore).toBe(70);
    expect(s.liquidityScore).toBe(65);
    expect(s.collectionSynergyScore).toBeGreaterThan(0);
    expect(s.collectionSynergyScore).not.toBe(s.museumImportance);
  });
});

describe("Decision-engine evidence retrofit", () => {
  it("wraps a Buy rec with evidence cards and a stale flag", () => {
    const env = wrapEngineRecommendation({
      holdingId: "clz-not-a-uuid",
      action: "Buy",
      confidence: 0.8,
      supporting: [{ summary: "Ask under range low" }],
      opposing: [{ summary: "Thin comps" }],
    });
    expect(env.evidence.length).toBeGreaterThanOrEqual(1);
    expect(env.isStale).toBe(false);
    expect(env.action).toBe("buy");
  });
});

describe("Collection quality density", () => {
  it("keeps component scores beside the density ratio", () => {
    const d = collectionQualityDensity({
      museumImportance: 90,
      investmentScore: 70,
      liquidityScore: 60,
      collectionSynergyScore: 80,
      capitalDeployed: 200,
    });
    expect(d.qualityBlend).toBe(75);
    expect(d.collectionQualityDensity).toBeGreaterThan(0);
    expect(d.museumImportance).toBe(90);
  });
});

describe("Cohen cover score", () => {
  it("marks Poison Ivy #9 as buy-cheap, not chase", () => {
    const r = scoreCohenCover(COHEN_IVY9_FIXTURE);
    expect(r.action).toBe("buy_cheap");
    expect(r.trueScarcity).toBe(3);
    expect(r.variantDilutionPenalty).toBe(3);
    expect(r.imageIconicity).toBe(10);
  });

  it("keeps a verified LTD-500 early Cohen in museum-hold territory", () => {
    const r = scoreCohenCover(COHEN_DIENAMITE_FIXTURE);
    expect(r.action).toBe("museum_hold");
    expect(r.cohenScore).toBeGreaterThan(scoreCohenCover(COHEN_IVY9_FIXTURE).cohenScore);
  });
});

describe("Print-life monitor", () => {
  it("refuses automated OOP classification", () => {
    expect(() => classifyPrintLife()).toThrow(/blocked/i);
  });
});

describe("Phase 2 — schema / manual only", () => {
  it("accepts the Drew Brees post-HOF manual row", () => {
    expect(fixtures.drewBreesCycle.cycleState).toBe("accumulation");
    expect(fixtures.drewBreesCycle.dataSource).toBe("manual");
    expect(fixtures.drewBreesWatch.watchNote).toMatch(/Accumulation Watch/);
  });

  it("refuses automated classification", () => {
    expect(() => classifyMarketCycle()).toThrow(/blocked/i);
  });
});

describe("Phase 3 — interfaces only", () => {
  it("keeps CardSight-scoped providers and rejects scoped-out ones", () => {
    expect(ALLOWED_IDENTIFICATION_PROVIDERS).toContain("cardsight");
    expect(ALLOWED_IDENTIFICATION_PROVIDERS).toContain("tcgdex");
    expect(FORBIDDEN_IDENTIFICATION_PROVIDERS).toContain("yugioh");
    expect(() => assertAllowedProvider("yugioh")).toThrow(/out of scope/);
  });

  it("never overwrites a confirmed identity in place", () => {
    const scan = recordCardScan({
      capturedAt: fixtures.asOf,
      imageRef: "s3://scans/demo.jpg",
    });
    const first = openIdentification(scan.id, fixtures.asOf);
    expect(first.needsReview).toBe(true);
    const { previous, next } = supersedeIdentification(
      { ...first, confirmedAssetId: fixtures.megaGreninja.assetId, needsReview: false },
      fixtures.crownZenith.assetId ?? first.cardScanId,
      "greg",
      fixtures.asOf,
    );
    expect(previous.supersededBy).toBe(next.id);
    expect(previous.confirmedAssetId).toBe(fixtures.megaGreninja.assetId);
    expect(next.id).not.toBe(previous.id);
  });

  it("does not stub auction max-bid or trade basket equality", () => {
    expect(() => auctionMaxBid()).toThrow(/deferred/);
    expect(() => tradeBasketEquality()).toThrow(/deferred/);
  });

  it("exports a versioned intelligence contract", () => {
    expect(INTELLIGENCE_VERSION).toBe("intelligence@0.1.0");
  });
});
