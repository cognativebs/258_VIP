import { randomUUID } from "node:crypto";
import { markInferred, markObserved } from "@vip/evidence";
import { addDays, round2 } from "./math.js";
import {
  PredictionSchema,
  PriceDirectionSchema,
  type Prediction,
  type PriceDirection,
} from "./schemas.js";
import { INTELLIGENCE_VERSION } from "./version.js";

const SIDEWAYS_BAND = 0.05;

export class PredictionLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionLedgerError";
  }
}

export type PredictionInput = {
  id?: string;
  assetId: string;
  predictedAt: Date;
  priceAtPrediction: number;
  horizonDays: number;
  probabilityDown: number;
  probabilitySideways: number;
  probabilityUp: number;
  assumptions?: string | null;
  evidenceIds?: string[];
  confidence?: number | null;
  modelVersion?: string;
};

export function createPrediction(input: PredictionInput): Prediction {
  const predictedAt = input.predictedAt;
  return PredictionSchema.parse({
    id: input.id ?? randomUUID(),
    assetId: input.assetId,
    predictedAt,
    priceAtPrediction: input.priceAtPrediction,
    horizonDays: input.horizonDays,
    resolvesAt: addDays(predictedAt, input.horizonDays),
    probabilityDown: input.probabilityDown,
    probabilitySideways: input.probabilitySideways,
    probabilityUp: input.probabilityUp,
    assumptions: input.assumptions ?? null,
    evidenceIds: input.evidenceIds ?? [],
    confidence: input.confidence ?? null,
    modelVersion: input.modelVersion ?? "manual",
    actualPrice: null,
    actualDirection: null,
    forecastError: null,
    explanation: null,
    modelAdjustment: null,
    resolvedAt: null,
    createdAt: predictedAt,
    provenance: markInferred({
      source: input.modelVersion ?? "manual",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: input.confidence ?? 0.5,
      notes: "Frozen forecast — unverified until resolution",
    }),
  });
}

export function impliedDirection(row: Prediction): PriceDirection {
  const triples: Array<[PriceDirection, number]> = [
    ["down", row.probabilityDown],
    ["sideways", row.probabilitySideways],
    ["up", row.probabilityUp],
  ];
  triples.sort((a, b) => b[1] - a[1]);
  return triples[0]![0];
}

export function directionFromPrices(
  priceAtPrediction: number,
  actualPrice: number,
): PriceDirection {
  if (actualPrice < priceAtPrediction * (1 - SIDEWAYS_BAND)) return "down";
  if (actualPrice > priceAtPrediction * (1 + SIDEWAYS_BAND)) return "up";
  return "sideways";
}

export function resolvePrediction(
  row: Prediction,
  actualPrice: number,
  asOf: Date,
  notes?: { explanation?: string; modelAdjustment?: string },
): Prediction {
  if (row.resolvedAt) {
    throw new PredictionLedgerError("A resolved prediction is never mutated again");
  }
  if (asOf < row.resolvesAt) {
    throw new PredictionLedgerError(
      `Cannot resolve before resolvesAt (${row.resolvesAt.toISOString()})`,
    );
  }
  const actualDirection = directionFromPrices(row.priceAtPrediction, actualPrice);
  return PredictionSchema.parse({
    ...row,
    actualPrice,
    actualDirection,
    forecastError: round2(actualPrice - row.priceAtPrediction),
    explanation: notes?.explanation ?? null,
    modelAdjustment: notes?.modelAdjustment ?? null,
    resolvedAt: asOf,
    provenance: markObserved({
      source: row.modelVersion,
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: 1,
      notes: "Outcome recorded after horizon",
    }),
  });
}

/** Forecast fields are frozen; only resolution fields may change. */
export function assertForecastImmutable(before: Prediction, after: Prediction): void {
  const frozen: Array<keyof Prediction> = [
    "id",
    "assetId",
    "predictedAt",
    "priceAtPrediction",
    "horizonDays",
    "resolvesAt",
    "probabilityDown",
    "probabilitySideways",
    "probabilityUp",
    "assumptions",
    "modelVersion",
    "createdAt",
  ];
  for (const key of frozen) {
    const a = before[key];
    const b = after[key];
    const same =
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) {
      throw new PredictionLedgerError(`Forecast field ${key} is immutable`);
    }
  }
}

export function needsScoring(rows: Prediction[], asOf: Date): Prediction[] {
  return rows.filter((r) => r.resolvedAt == null && r.resolvesAt <= asOf);
}

export type CalibrationReport = {
  modelVersion: string;
  resolvedCount: number;
  directionalAccuracyPct: number | null;
  avgForecastError: number | null;
  biasNote: string;
};

export function calibrate(rows: Prediction[]): CalibrationReport[] {
  const byModel = new Map<string, Prediction[]>();
  for (const row of rows) {
    if (!row.resolvedAt || !row.actualDirection) continue;
    const list = byModel.get(row.modelVersion) ?? [];
    list.push(row);
    byModel.set(row.modelVersion, list);
  }

  return [...byModel.entries()].map(([modelVersion, group]) => {
    const hits = group.filter((r) => impliedDirection(r) === r.actualDirection).length;
    const avgError =
      group.reduce((s, r) => s + (r.forecastError ?? 0), 0) / group.length;
    return {
      modelVersion,
      resolvedCount: group.length,
      directionalAccuracyPct: round2((hits / group.length) * 100),
      avgForecastError: round2(avgError),
      biasNote: biasNote(avgError, group.length),
    };
  });
}

function biasNote(avgForecastError: number, n: number): string {
  if (n < 3) {
    return "Sample too small for a systematic-bias claim";
  }
  if (avgForecastError < -10) {
    return "Model systematically overestimates prices (actuals come in lower)";
  }
  if (avgForecastError > 10) {
    return "Model systematically underestimates prices (e.g. misses post-release compression if signed the other way)";
  }
  return "No systematic bias detected at this sample size";
}

export { PriceDirectionSchema };
