import { CATALOG_RESOLVER_RULE } from "../constants.js";
import {
  IdentificationBenchmarkCaseSchema,
  IdentificationBenchmarkReportSchema,
  type AdapterBenchmarkReport,
  type ConfidenceCalibrationBand,
  type IdentificationBenchmarkCase,
  type IdentificationBenchmarkReport,
} from "./resolver-schemas.js";

const BANDS: Array<
  Pick<ConfidenceCalibrationBand, "band" | "minInclusive" | "maxExclusive">
> = [
  { band: "high", minInclusive: 0.9, maxExclusive: 1.0001 },
  { band: "mid", minInclusive: 0.45, maxExclusive: 0.9 },
  { band: "low", minInclusive: 0, maxExclusive: 0.45 },
];

function ratio(correct: number, total: number): number | null {
  if (total === 0) return null;
  return Number((correct / total).toFixed(4));
}

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function top1Hit(row: IdentificationBenchmarkCase): boolean | null {
  if (row.failed) return false;
  if (row.confirmedCorrect != null) return row.confirmedCorrect;
  const pred = normalize(row.predictedCatalogKey);
  const exp = normalize(row.expectedCatalogKey);
  if (!pred || !exp) return null;
  return pred === exp;
}

function parallelHit(row: IdentificationBenchmarkCase): boolean | null {
  const exp = normalize(row.expectedParallel);
  if (!exp) return null;
  if (row.failed) return false;
  return normalize(row.predictedParallel) === exp;
}

function numberHit(row: IdentificationBenchmarkCase): boolean | null {
  const exp = normalize(row.expectedCollectorNumber);
  if (!exp) return null;
  if (row.failed) return false;
  return normalize(row.predictedCollectorNumber) === exp;
}

function scoreSlice(adapterId: string, rows: IdentificationBenchmarkCase[]): AdapterBenchmarkReport {
  let top1Correct = 0;
  let top1Total = 0;
  let parallelCorrect = 0;
  let parallelTotal = 0;
  let numberCorrect = 0;
  let numberTotal = 0;
  let failed = 0;
  let calls = 0;

  const calibration = BANDS.map((band) => {
    const inBand = rows.filter((row) => {
      const conf = row.predictedConfidence;
      return (
        conf != null && conf >= band.minInclusive && conf < band.maxExclusive
      );
    });
    let correct = 0;
    for (const row of inBand) {
      const hit = top1Hit(row);
      if (hit === true) correct += 1;
    }
    return {
      ...band,
      count: inBand.length,
      correct,
      accuracy: ratio(correct, inBand.length),
    };
  });

  for (const row of rows) {
    calls += row.providerCalls;
    if (row.failed) failed += 1;
    const t1 = top1Hit(row);
    if (t1 !== null) {
      top1Total += 1;
      if (t1) top1Correct += 1;
    }
    const p = parallelHit(row);
    if (p !== null) {
      parallelTotal += 1;
      if (p) parallelCorrect += 1;
    }
    const n = numberHit(row);
    if (n !== null) {
      numberTotal += 1;
      if (n) numberCorrect += 1;
    }
  }

  return {
    adapterId,
    cases: rows.length,
    top1Accuracy: ratio(top1Correct, top1Total),
    exactParallelAccuracy: ratio(parallelCorrect, parallelTotal),
    cardNumberAccuracy: ratio(numberCorrect, numberTotal),
    failureRate: rows.length === 0 ? 0 : Number((failed / rows.length).toFixed(4)),
    callsConsumed: calls,
    calibration,
  };
}

export function scoreIdentificationBenchmark(
  cases: IdentificationBenchmarkCase[],
): IdentificationBenchmarkReport {
  const parsed = cases.map((row) => IdentificationBenchmarkCaseSchema.parse(row));
  const byAdapter = new Map<string, IdentificationBenchmarkCase[]>();
  for (const row of parsed) {
    const list = byAdapter.get(row.adapterId) ?? [];
    list.push(row);
    byAdapter.set(row.adapterId, list);
  }

  const adapters = [...byAdapter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, rows]) => scoreSlice(id, rows));

  return IdentificationBenchmarkReportSchema.parse({
    ruleOrModelVersion: CATALOG_RESOLVER_RULE,
    caseCount: parsed.length,
    adapters,
    overall: scoreSlice("overall", parsed),
  });
}
