import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUE_PREDICTIONS_RULE,
  addGoldenCase,
  createFieldSession,
  createPrediction,
  uuidFromKey,
  evaluateGrading,
  lockUnderwriting,
  needsScoring,
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
  type DuePredictionsReport,
  type FieldCapture,
  type FieldSession,
  type GradingEvaluation,
  type IdentificationGoldenCase,
  type IntelligenceStoreKind,
  type MarketCycleState,
  type Prediction,
  type RecommendationRecord,
  type Underwriting,
} from "@vip/intelligence";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type { FieldCapture };

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

export function emptyIntelligenceDoc(): IntelligenceDoc {
  return {
    predictions: [],
    recommendations: [],
    underwriting: [],
    grading: [],
    cycleStates: [],
    buyScans: [],
    fieldSessions: [],
    captures: [],
    cardScans: [],
    identifications: [],
    goldenCases: [],
  };
}

function defaultStatePath(): string {
  return resolve(__dirname, "../../../../scripts/dev-intelligence-state.json");
}

export function intelligenceStatePath(): string {
  return process.env.VIP_INTELLIGENCE_STATE ?? defaultStatePath();
}

export function reviveDates(value: unknown): unknown {
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
    ...emptyIntelligenceDoc(),
    predictions: [fx.megaGreninja],
    recommendations: [fx.crownZenith],
    underwriting: [fx.vintageLot],
    grading: [fx.grading.flareon, fx.grading.jolteon, fx.grading.snorlax, fx.grading.chansey],
    cycleStates: [fx.drewBreesCycle],
    buyScans: [fx.drewBreesWatch],
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

// ---------------------------------------------------------------------------
// Write bodies. The domain functions in @vip/intelligence validate (zod) and
// compute every derived field; both backends call the same builders, so a row
// written to Postgres carries the same derived values the JSON store keeps.
// ---------------------------------------------------------------------------

export type AddPredictionBody = {
  assetId: string;
  priceAtPrediction: number;
  horizonDays: number;
  probabilityDown: number;
  probabilitySideways: number;
  probabilityUp: number;
  assumptions?: string;
  confidence?: number;
  modelVersion?: string;
};

export type AddUnderwritingBody = {
  lotDescription?: string;
  askingPrice: number;
  offerPrice: number;
  conservativeRawValue: number;
  coverageRatioMinimumThreshold?: number;
  notes?: string;
};

export type AddGradingBody = {
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
};

export type AddManualCycleBody = {
  assetId: string;
  cycleState: MarketCycleState["cycleState"];
  notes?: string;
  watchNote?: string;
};

export type StartFieldSessionBody = {
  mode: "store" | "show" | "auction" | "trade";
  locationContext?: string;
};

export type CaptureFieldItemBody = {
  sessionId: string;
  askingPrice?: number;
  imageRef?: string;
  conservativeRawValue?: number;
  recommendationId?: string;
};

export type AddGoldenCaseBody = {
  imageRef: string;
  knownCorrectAssetId: string;
  category?: string;
  physicalFingerprint?: string;
};

function key(value: unknown): string {
  return uuidFromKey(String(value ?? ""));
}

export function buildPrediction(body: AddPredictionBody, now = new Date()): Prediction {
  return createPrediction({
    assetId: key(body.assetId),
    predictedAt: now,
    priceAtPrediction: body.priceAtPrediction,
    horizonDays: body.horizonDays,
    probabilityDown: body.probabilityDown,
    probabilitySideways: body.probabilitySideways,
    probabilityUp: body.probabilityUp,
    assumptions: body.assumptions,
    confidence: body.confidence,
    modelVersion: body.modelVersion ?? "manual",
  });
}

export function buildUnderwriting(body: AddUnderwritingBody, now = new Date()): Underwriting {
  return underwrite({
    lotDescription: body.lotDescription,
    evaluatedAt: now,
    askingPrice: body.askingPrice,
    offerPrice: body.offerPrice,
    conservativeRawValue: body.conservativeRawValue,
    coverageRatioMinimumThreshold: body.coverageRatioMinimumThreshold,
    notes: body.notes,
  });
}

export function buildGrading(body: AddGradingBody, now = new Date()): GradingEvaluation {
  return evaluateGrading({
    holdingId: key(body.holdingId),
    evaluatedAt: now,
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
}

export function buildManualCycle(
  body: AddManualCycleBody,
  now = new Date(),
): { cycle: MarketCycleState; scan: BuyOpportunityScan } {
  const cycle = recordManualCycleState({
    assetId: key(body.assetId),
    evaluatedAt: now,
    cycleState: body.cycleState,
    notes: body.notes,
  });
  const scan = recordManualBuyOpportunity({
    assetId: key(body.assetId),
    marketCycleStateId: cycle.id,
    scannedAt: now,
    watchNote: body.watchNote ?? body.notes,
  });
  return { cycle, scan };
}

export function buildFieldSession(body: StartFieldSessionBody, now = new Date()): FieldSession {
  return createFieldSession({
    mode: body.mode,
    startedAt: now,
    locationContext: body.locationContext,
  });
}

/**
 * vault_core.field_captured_item has no underwriting column, so the Postgres
 * store links a capture to its underwriting row with this tag in
 * acquisition_underwriting.notes (see intelligenceStorePg.ts).
 */
export function fieldCaptureTag(captureId: string): string {
  return `[field_capture:${captureId}]`;
}

export type FieldCaptureBundle = {
  capture: FieldCapture;
  cardScan: CardScan | null;
  identification: CardIdentification | null;
  underwriting: Underwriting | null;
};

export function buildFieldCapture(
  session: FieldSession,
  body: CaptureFieldItemBody,
  now = new Date(),
): FieldCaptureBundle {
  let cardScan: CardScan | null = null;
  let identification: CardIdentification | null = null;
  if (body.imageRef) {
    cardScan = recordCardScan({ capturedAt: now, imageRef: body.imageRef });
    identification = openIdentification(cardScan.id, now);
  }
  let uw: Underwriting | null = null;
  if (body.askingPrice != null && body.conservativeRawValue != null) {
    uw = underwrite({
      lotDescription: `Field ${session.mode} capture`,
      evaluatedAt: now,
      askingPrice: body.askingPrice,
      offerPrice: body.askingPrice,
      conservativeRawValue: body.conservativeRawValue,
    });
  }
  const capture: FieldCapture = {
    id: randomUUID(),
    fieldSessionId: session.id,
    capturedAt: now.toISOString(),
    askingPrice: body.askingPrice ?? null,
    imageRef: body.imageRef ?? null,
    recommendationId: body.recommendationId ?? null,
    underwritingId: uw?.id ?? null,
    cardScanId: cardScan?.id ?? null,
    identificationId: identification?.id ?? null,
    needsReview: true,
  };
  return { capture, cardScan, identification, underwriting: uw };
}

export function buildGoldenCase(
  body: AddGoldenCaseBody,
  now = new Date(),
): { cardScan: CardScan; goldenCase: IdentificationGoldenCase } {
  const cardScan = recordCardScan({
    capturedAt: now,
    imageRef: body.imageRef,
    physicalFingerprint: body.physicalFingerprint,
    source: "golden_deck",
  });
  const goldenCase = addGoldenCase({
    cardScanId: cardScan.id,
    knownCorrectAssetId: key(body.knownCorrectAssetId),
    category: body.category,
  });
  return { cardScan, goldenCase };
}

// ---------------------------------------------------------------------------
// JSON backend (VIP_INTELLIGENCE_STATE). Kept as the fallback when Postgres is
// unreachable; the synchronous helpers stay exported for scripts and tests.
// ---------------------------------------------------------------------------

export function addPrediction(body: AddPredictionBody): Prediction {
  return mutateIntelligence((doc) => {
    const row = buildPrediction(body);
    doc.predictions.push(row);
    return row;
  });
}

export function resolveStoredPrediction(
  id: string,
  actualPrice: number,
  explanation?: string,
  modelAdjustment?: string,
): Prediction {
  return mutateIntelligence((doc) => {
    const idx = doc.predictions.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Prediction not found: ${id}`);
    const next = resolvePrediction(doc.predictions[idx]!, actualPrice, new Date(), {
      explanation,
      modelAdjustment,
    });
    doc.predictions[idx] = next;
    return next;
  });
}

export function addUnderwriting(body: AddUnderwritingBody): Underwriting {
  return mutateIntelligence((doc) => {
    const row = buildUnderwriting(body);
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

export function addGrading(body: AddGradingBody): GradingEvaluation {
  return mutateIntelligence((doc) => {
    const row = buildGrading(body);
    doc.grading.push(row);
    return row;
  });
}

export function addManualCycle(body: AddManualCycleBody): {
  cycle: MarketCycleState;
  scan: BuyOpportunityScan;
} {
  return mutateIntelligence((doc) => {
    const out = buildManualCycle(body);
    doc.cycleStates.push(out.cycle);
    doc.buyScans.push(out.scan);
    return out;
  });
}

export function startFieldSession(body: StartFieldSessionBody): FieldSession {
  return mutateIntelligence((doc) => {
    const row = buildFieldSession(body);
    doc.fieldSessions.push(row);
    return row;
  });
}

export function captureFieldItem(body: CaptureFieldItemBody): FieldCapture {
  return mutateIntelligence((doc) => {
    const session = doc.fieldSessions.find((s) => s.id === body.sessionId);
    if (!session) throw new Error(`Field session not found: ${body.sessionId}`);
    const bundle = buildFieldCapture(session, body);
    if (bundle.cardScan) doc.cardScans.push(bundle.cardScan);
    if (bundle.identification) doc.identifications.push(bundle.identification);
    if (bundle.underwriting) doc.underwriting.push(bundle.underwriting);
    doc.captures.push(bundle.capture);
    return bundle.capture;
  });
}

export function addGoldenCaseRow(body: AddGoldenCaseBody): IdentificationGoldenCase {
  return mutateIntelligence((doc) => {
    const { cardScan, goldenCase } = buildGoldenCase(body);
    doc.cardScans.push(cardScan);
    doc.goldenCases.push(goldenCase);
    return goldenCase;
  });
}

// ---------------------------------------------------------------------------
// One interface, two backends.
// ---------------------------------------------------------------------------

export type IntelligenceStore = {
  readonly kind: IntelligenceStoreKind;
  load(): Promise<IntelligenceDoc>;
  /** Unresolved predictions past their horizon. Read-only: nothing auto-resolves. */
  duePredictions(asOf?: Date): Promise<DuePredictionsReport>;
  addPrediction(body: AddPredictionBody): Promise<Prediction>;
  resolvePrediction(
    id: string,
    actualPrice: number,
    notes?: { explanation?: string; modelAdjustment?: string },
  ): Promise<Prediction>;
  addUnderwriting(body: AddUnderwritingBody): Promise<Underwriting>;
  lockUnderwriting(id: string): Promise<Underwriting>;
  addGrading(body: AddGradingBody): Promise<GradingEvaluation>;
  addManualCycle(
    body: AddManualCycleBody,
  ): Promise<{ cycle: MarketCycleState; scan: BuyOpportunityScan }>;
  startFieldSession(body: StartFieldSessionBody): Promise<FieldSession>;
  captureFieldItem(body: CaptureFieldItemBody): Promise<FieldCapture>;
  addGoldenCase(body: AddGoldenCaseBody): Promise<IdentificationGoldenCase>;
};

export function jsonDuePredictions(
  predictions: Prediction[],
  asOf = new Date(),
): DuePredictionsReport {
  const due = needsScoring(predictions, asOf).sort(
    (a, b) => a.resolvesAt.getTime() - b.resolvesAt.getTime(),
  );
  return {
    store: "json",
    source: "json:needsScoring",
    rule: DUE_PREDICTIONS_RULE,
    asOf: asOf.toISOString(),
    count: due.length,
    predictions: due,
    note: "JSON store (Postgres unavailable or VIP_INTELLIGENCE_STORE=json). A person records each outcome; nothing auto-resolves.",
  };
}

export function jsonIntelligenceStore(): IntelligenceStore {
  return {
    kind: "json",
    load: async () => loadIntelligenceDoc(),
    duePredictions: async (asOf = new Date()) =>
      jsonDuePredictions(loadIntelligenceDoc().predictions, asOf),
    addPrediction: async (body) => addPrediction(body),
    resolvePrediction: async (id, actualPrice, notes) =>
      resolveStoredPrediction(id, actualPrice, notes?.explanation, notes?.modelAdjustment),
    addUnderwriting: async (body) => addUnderwriting(body),
    lockUnderwriting: async (id) => lockStoredUnderwriting(id),
    addGrading: async (body) => addGrading(body),
    addManualCycle: async (body) => addManualCycle(body),
    startFieldSession: async (body) => startFieldSession(body),
    captureFieldItem: async (body) => captureFieldItem(body),
    addGoldenCase: async (body) => addGoldenCaseRow(body),
  };
}
