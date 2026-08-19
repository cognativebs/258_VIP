import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addGoldenCase,
  createFieldSession,
  createPrediction,
  uuidFromKey,
  evaluateGrading,
  lockUnderwriting,
  openIdentification,
  recordCardScan,
  recordManualBuyOpportunity,
  recordManualCycleState,
  resolvePrediction,
  seedIntelligenceFixtures,
  underwrite,
  type BuyOpportunityScan,
  type CardIdentification,
  type CardScan,
  type FieldSession,
  type GradingEvaluation,
  type IdentificationGoldenCase,
  type MarketCycleState,
  type Prediction,
  type RecommendationRecord,
  type Underwriting,
} from "@vip/intelligence";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type FieldCapture = {
  id: string;
  fieldSessionId: string;
  capturedAt: string;
  askingPrice: number | null;
  imageRef: string | null;
  recommendationId: string | null;
  underwritingId: string | null;
  cardScanId: string | null;
  identificationId: string | null;
  needsReview: boolean;
};

export type IntelligenceDoc = {
  predictions: Prediction[];
  recommendations: RecommendationRecord[];
  underwriting: Underwriting[];
  grading: GradingEvaluation[];
  cycleStates: MarketCycleState[];
  buyScans: BuyOpportunityScan[];
  fieldSessions: FieldSession[];
  captures: FieldCapture[];
  cardScans: CardScan[];
  identifications: CardIdentification[];
  goldenCases: IdentificationGoldenCase[];
};

function defaultStatePath(): string {
  return resolve(__dirname, "../../../../scripts/dev-intelligence-state.json");
}

export function intelligenceStatePath(): string {
  return process.env.VIP_INTELLIGENCE_STATE ?? defaultStatePath();
}

function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === "string" &&
        /(?:At|Timestamp)$/.test(k)
      ) {
        const d = new Date(v);
        out[k] = Number.isNaN(d.getTime()) ? v : d;
      } else {
        out[k] = reviveDates(v);
      }
    }
    return out;
  }
  return value;
}

function seedDoc(): IntelligenceDoc {
  const fx = seedIntelligenceFixtures();
  return {
    predictions: [fx.megaGreninja],
    recommendations: [fx.crownZenith],
    underwriting: [fx.vintageLot],
    grading: [fx.grading.flareon, fx.grading.jolteon, fx.grading.snorlax, fx.grading.chansey],
    cycleStates: [fx.drewBreesCycle],
    buyScans: [fx.drewBreesWatch],
    fieldSessions: [],
    captures: [],
    cardScans: [],
    identifications: [],
    goldenCases: [],
  };
}

export function loadIntelligenceDoc(): IntelligenceDoc {
  const path = intelligenceStatePath();
  if (!existsSync(path)) {
    const seeded = seedDoc();
    saveIntelligenceDoc(seeded);
    return seeded;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as IntelligenceDoc;
    return reviveDates(raw) as IntelligenceDoc;
  } catch {
    const seeded = seedDoc();
    saveIntelligenceDoc(seeded);
    return seeded;
  }
}

export function saveIntelligenceDoc(doc: IntelligenceDoc): void {
  const path = intelligenceStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2), "utf8");
}

export function mutateIntelligence<T>(fn: (doc: IntelligenceDoc) => T): T {
  const doc = loadIntelligenceDoc();
  const result = fn(doc);
  saveIntelligenceDoc(doc);
  return result;
}

export function addPrediction(body: {
  assetId: string;
  priceAtPrediction: number;
  horizonDays: number;
  probabilityDown: number;
  probabilitySideways: number;
  probabilityUp: number;
  assumptions?: string;
  confidence?: number;
  modelVersion?: string;
}): Prediction {
  return mutateIntelligence((doc) => {
    const row = createPrediction({
      assetId: uuidFromKey(body.assetId),
      predictedAt: new Date(),
      priceAtPrediction: body.priceAtPrediction,
      horizonDays: body.horizonDays,
      probabilityDown: body.probabilityDown,
      probabilitySideways: body.probabilitySideways,
      probabilityUp: body.probabilityUp,
      assumptions: body.assumptions,
      confidence: body.confidence,
      modelVersion: body.modelVersion ?? "manual",
    });
    doc.predictions.push(row);
    return row;
  });
}

export function resolveStoredPrediction(
  id: string,
  actualPrice: number,
  explanation?: string,
): Prediction {
  return mutateIntelligence((doc) => {
    const idx = doc.predictions.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Prediction not found: ${id}`);
    const next = resolvePrediction(doc.predictions[idx]!, actualPrice, new Date(), {
      explanation,
    });
    doc.predictions[idx] = next;
    return next;
  });
}

export function addUnderwriting(body: {
  lotDescription?: string;
  askingPrice: number;
  offerPrice: number;
  conservativeRawValue: number;
  coverageRatioMinimumThreshold?: number;
  notes?: string;
}): Underwriting {
  return mutateIntelligence((doc) => {
    const row = underwrite({
      lotDescription: body.lotDescription,
      evaluatedAt: new Date(),
      askingPrice: body.askingPrice,
      offerPrice: body.offerPrice,
      conservativeRawValue: body.conservativeRawValue,
      coverageRatioMinimumThreshold: body.coverageRatioMinimumThreshold,
      notes: body.notes,
    });
    doc.underwriting.push(row);
    return row;
  });
}

export function lockStoredUnderwriting(id: string): Underwriting {
  return mutateIntelligence((doc) => {
    const idx = doc.underwriting.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error(`Underwriting not found: ${id}`);
    const next = lockUnderwriting(doc.underwriting[idx]!, new Date());
    doc.underwriting[idx] = next;
    return next;
  });
}

export function addGrading(body: {
  holdingId: string;
  rawValue: number;
  gradingCost: number;
  shippingCost?: number;
  insuranceCost?: number;
  psa7?: { probability?: number; value?: number };
  psa8?: { probability?: number; value?: number };
  psa9?: { probability?: number; value?: number };
  psa10?: { probability?: number; value?: number };
  notes?: string;
}): GradingEvaluation {
  return mutateIntelligence((doc) => {
    const row = evaluateGrading({
      holdingId: uuidFromKey(body.holdingId),
      evaluatedAt: new Date(),
      rawValue: body.rawValue,
      gradingCost: body.gradingCost,
      shippingCost: body.shippingCost,
      insuranceCost: body.insuranceCost,
      psa7: body.psa7,
      psa8: body.psa8,
      psa9: body.psa9,
      psa10: body.psa10,
      notes: body.notes,
    });
    doc.grading.push(row);
    return row;
  });
}

export function addManualCycle(body: {
  assetId: string;
  cycleState: MarketCycleState["cycleState"];
  notes?: string;
  watchNote?: string;
}): { cycle: MarketCycleState; scan: BuyOpportunityScan } {
  return mutateIntelligence((doc) => {
    const cycle = recordManualCycleState({
      assetId: uuidFromKey(body.assetId),
      evaluatedAt: new Date(),
      cycleState: body.cycleState,
      notes: body.notes,
    });
    const scan = recordManualBuyOpportunity({
      assetId: uuidFromKey(body.assetId),
      marketCycleStateId: cycle.id,
      scannedAt: new Date(),
      watchNote: body.watchNote ?? body.notes,
    });
    doc.cycleStates.push(cycle);
    doc.buyScans.push(scan);
    return { cycle, scan };
  });
}

export function startFieldSession(body: {
  mode: "store" | "show" | "auction" | "trade";
  locationContext?: string;
}): FieldSession {
  return mutateIntelligence((doc) => {
    const row = createFieldSession({
      mode: body.mode,
      startedAt: new Date(),
      locationContext: body.locationContext,
    });
    doc.fieldSessions.push(row);
    return row;
  });
}

export function captureFieldItem(body: {
  sessionId: string;
  askingPrice?: number;
  imageRef?: string;
  conservativeRawValue?: number;
  recommendationId?: string;
}): FieldCapture {
  return mutateIntelligence((doc) => {
    const session = doc.fieldSessions.find((s) => s.id === body.sessionId);
    if (!session) throw new Error(`Field session not found: ${body.sessionId}`);
    const now = new Date();
    let cardScanId: string | null = null;
    let identificationId: string | null = null;
    if (body.imageRef) {
      const scan = recordCardScan({ capturedAt: now, imageRef: body.imageRef });
      const ident = openIdentification(scan.id, now);
      doc.cardScans.push(scan);
      doc.identifications.push(ident);
      cardScanId = scan.id;
      identificationId = ident.id;
    }
    let underwritingId: string | null = null;
    if (body.askingPrice != null && body.conservativeRawValue != null) {
      const uw = underwrite({
        lotDescription: `Field ${session.mode} capture`,
        evaluatedAt: now,
        askingPrice: body.askingPrice,
        offerPrice: body.askingPrice,
        conservativeRawValue: body.conservativeRawValue,
      });
      doc.underwriting.push(uw);
      underwritingId = uw.id;
    }
    const capture: FieldCapture = {
      id: randomUUID(),
      fieldSessionId: session.id,
      capturedAt: now.toISOString(),
      askingPrice: body.askingPrice ?? null,
      imageRef: body.imageRef ?? null,
      recommendationId: body.recommendationId ?? null,
      underwritingId,
      cardScanId,
      identificationId,
      needsReview: true,
    };
    doc.captures.push(capture);
    return capture;
  });
}

export function addGoldenCaseRow(body: {
  imageRef: string;
  knownCorrectAssetId: string;
  category?: string;
  physicalFingerprint?: string;
}): IdentificationGoldenCase {
  return mutateIntelligence((doc) => {
    const scan = recordCardScan({
      capturedAt: new Date(),
      imageRef: body.imageRef,
      physicalFingerprint: body.physicalFingerprint,
      source: "golden_deck",
    });
    const row = addGoldenCase({
      cardScanId: scan.id,
      knownCorrectAssetId: uuidFromKey(body.knownCorrectAssetId),
      category: body.category,
    });
    doc.cardScans.push(scan);
    doc.goldenCases.push(row);
    return row;
  });
}
