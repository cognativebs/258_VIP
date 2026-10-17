/**
 * Prediction calibration (pure). A prediction's confidence is the probability it
 * stated; a measurement says whether the call was right. Brier = mean of
 * (confidence − outcome)², lower is better; 0.25 is what always saying 50% earns.
 * Unmeasured rows count as pending, never as misses.
 */
export type MeasuredCall = { confidence: number; directionCorrect: boolean | null };

export type CalibrationSummary = {
  resolved: number;
  pending: number;
  hits: number;
  brier: number | null;
  /** Brier of always answering 0.5 on the same rows, for comparison. */
  coinFlipBrier: 0.25;
  note: string;
};

export function calibrationSummary(rows: ReadonlyArray<MeasuredCall>): CalibrationSummary {
  const resolved = rows.filter((r) => r.directionCorrect !== null);
  const hits = resolved.filter((r) => r.directionCorrect).length;
  const brier = resolved.length
    ? Math.round((resolved.reduce((s, r) => s + (r.confidence - (r.directionCorrect ? 1 : 0)) ** 2, 0) / resolved.length) * 1000) / 1000
    : null;
  return {
    resolved: resolved.length,
    pending: rows.length - resolved.length,
    hits,
    brier,
    coinFlipBrier: 0.25,
    note:
      resolved.length < 10
        ? `Only ${resolved.length} measured call(s): too few to judge calibration.`
        : brier! < 0.25
          ? "Better than a coin flip on the measured calls."
          : "No better than a coin flip on the measured calls.",
  };
}
