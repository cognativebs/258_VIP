/**
 * Phase D wave 1 — cross-sectional emitters only.
 * Does not write signals_normalized or enable Phase 2.
 */
import {
  PHASE_D_ASK_CONTEXT_HIGH,
  PHASE_D_ASK_CONTEXT_LOW,
  PHASE_D_ASK_HIGH,
  PHASE_D_ASK_LISTING_MIN,
  PHASE_D_ASK_LOW,
  PHASE_D_CONFIDENCE_CEILING,
  PHASE_D_GRADING_COST,
  PHASE_D_MIN_NIGHTLY_SNAPSHOTS,
  PHASE_D_P_98_SENSITIVITY,
  PHASE_D_P_98_UNVERIFIED,
  PHASE_D_PRE_1975_YEAR,
  PHASE_D_PREMIUM_TIGHT,
  PHASE_D_RULE,
  PHASE_D_SELLING_EXPENSE_PCT,
  PhaseDContextSchema,
  PhaseDEvidenceBundleSchema,
  SIGNALS_CONTEXT_CAP,
  type PhaseDContext,
  type PhaseDEvidenceBundle,
} from "@vip/core-model";
import { evaluateGrading } from "@vip/intelligence";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";

export type AskRow = {
  assetId: string;
  conditionKey: string;
  medianAsk: number;
  listingCount: number;
  guidePrice: number;
};

export type AskCalibrationRow = AskRow & {
  publisher: string | null;
  yearBegan: number | null;
  canonicalName: string | null;
};

export type PremiumRow = {
  assetId: string;
  raw: number;
  high: number;
  highKey: "graded_9_8" | "graded_psa_10";
  yearBegan: number | null;
  publisher: string | null;
  canonicalName: string | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function capConfidence(n: number): number {
  return Math.min(PHASE_D_CONFIDENCE_CEILING, n);
}

function dollarGap(row: AskRow): number {
  return row.medianAsk - row.guidePrice;
}

function toAskBundle(
  row: AskRow,
  key: "ask_divergence_high" | "ask_divergence_low",
  now: Date,
): PhaseDEvidenceBundle {
  const ratio = row.medianAsk / row.guidePrice;
  const gap = dollarGap(row);
  return PhaseDEvidenceBundleSchema.parse({
    emitterKey: key,
    emitterVersion: PHASE_D_RULE,
    assetId: row.assetId,
    conditionKey: row.conditionKey,
    direction: key === "ask_divergence_high" ? "bullish" : "bearish",
    strength: clamp01(Math.abs(gap) / Math.max(row.guidePrice, 1)),
    confidence: capConfidence(0.55 + Math.min(0.2, row.listingCount / 50)),
    firedAt: now.toISOString(),
    evidence: {
      medianAsk: row.medianAsk,
      guidePrice: row.guidePrice,
      listingCount: row.listingCount,
      ratio: Number(ratio.toFixed(3)),
      dollarDivergence: Number(gap.toFixed(2)),
    },
    notes:
      "Cross-sectional ask vs guide. Ranked by |ask − guide| dollars, not ratio. " +
      "Not sustained 3-day. vendor_derived ceiling 0.75. eBay asks are often aspirational.",
  });
}

export function emitAskDivergence(rows: AskRow[], now = new Date()): PhaseDEvidenceBundle[] {
  const eligible = rows.filter((row) => row.listingCount >= PHASE_D_ASK_LISTING_MIN && row.guidePrice > 0);
  const high = eligible
    .filter((row) => row.medianAsk / row.guidePrice > PHASE_D_ASK_HIGH)
    .sort((a, b) => Math.abs(dollarGap(b)) - Math.abs(dollarGap(a)))
    .slice(0, PHASE_D_ASK_CONTEXT_HIGH)
    .map((row) => toAskBundle(row, "ask_divergence_high", now));
  const low = eligible
    .filter((row) => row.medianAsk / row.guidePrice < PHASE_D_ASK_LOW)
    .sort((a, b) => Math.abs(dollarGap(b)) - Math.abs(dollarGap(a)))
    .slice(0, PHASE_D_ASK_CONTEXT_LOW)
    .map((row) => toAskBundle(row, "ask_divergence_low", now));
  return [...high, ...low].sort(
    (a, b) => Math.abs(Number(b.evidence.dollarDivergence)) - Math.abs(Number(a.evidence.dollarDivergence)),
  );
}

export function evaluateGradingAtP98(
  row: Pick<PremiumRow, "assetId" | "raw" | "high">,
  p98: number,
  now = new Date(),
) {
  return evaluateGrading({
    holdingId: row.assetId,
    evaluatedAt: now,
    rawValue: row.raw,
    psa9: { probability: 0, value: 0 },
    psa10: { probability: p98, value: row.high },
    gradingCost: PHASE_D_GRADING_COST,
    sellingExpensePct: PHASE_D_SELLING_EXPENSE_PCT,
    graderRouting: "CGC",
    notes: `P(9.8)=${p98} assumed · unverified. CGC 9.8 via PriceCharting high rung.`,
  });
}

export function isPre1975PressRisk(yearBegan: number | null): boolean {
  return yearBegan != null && yearBegan < PHASE_D_PRE_1975_YEAR;
}

export function emitGradingArbitrage(
  rows: PremiumRow[],
  now = new Date(),
  p98 = PHASE_D_P_98_UNVERIFIED,
): PhaseDEvidenceBundle[] {
  const out: PhaseDEvidenceBundle[] = [];
  for (const row of rows) {
    if (row.raw <= 0 || row.high <= 0) continue;
    const ratio = row.high / row.raw;
    const profits = Object.fromEntries(
      PHASE_D_P_98_SENSITIVITY.map((p) => [p, evaluateGradingAtP98(row, p, now).expectedIncrementalProfit]),
    ) as Record<number, number>;
    const intersection = PHASE_D_P_98_SENSITIVITY.every((p) => profits[p] > 0);
    if (!intersection) continue;
    const evaluation = evaluateGradingAtP98(row, p98, now);
    const profit = evaluation.expectedIncrementalProfit;
    const pre1975 = isPre1975PressRisk(row.yearBegan);
    const flags = [
      "vendor_derived 9.8 multiple · confidence ≤ 0.75",
      `P(9.8)=${p98} assumed · unverified`,
      pre1975 ? "pre-1975 press/restoration risk" : null,
    ].filter(Boolean);
    out.push(
      PhaseDEvidenceBundleSchema.parse({
        emitterKey: "grading_arbitrage",
        emitterVersion: PHASE_D_RULE,
        assetId: row.assetId,
        conditionKey: row.highKey,
        direction: profit > 0 ? "bullish" : profit < 0 ? "bearish" : "neutral",
        strength: clamp01(Math.abs(profit) / Math.max(row.raw, 1)),
        confidence: capConfidence(0.55),
        firedAt: now.toISOString(),
        evidence: {
          rawUngraded: row.raw,
          highGrade: row.high,
          highKey: row.highKey,
          ratio: Number(ratio.toFixed(3)),
          p98,
          p98Assumed: true,
          vendorDerivedMultiple: true,
          profitAtP10: profits[0.1],
          profitAtP20: profits[0.2],
          profitAtP30: profits[0.3],
          intersectionQueue: true,
          pre1975PressRestorationRisk: pre1975,
          yearBegan: row.yearBegan,
          gradingCost: PHASE_D_GRADING_COST,
          sellingExpensePct: PHASE_D_SELLING_EXPENSE_PCT,
          expectedValue: evaluation.expectedGradingValue,
          expectedIncrementalProfit: profit,
          gradingOpportunityScore: evaluation.gradingOpportunityScore,
          recommendation: evaluation.recommendation,
          canonicalName: row.canonicalName,
        },
        notes: `Grading Optimizer terms. ${flags.join(" · ")}. Not signals_normalized.`,
      }),
    );
  }
  return out
    .sort((a, b) => Number(b.evidence.profitAtP10) - Number(a.evidence.profitAtP10))
    .slice(0, SIGNALS_CONTEXT_CAP);
}

export function emitGradePremiumCompression(rows: PremiumRow[], now = new Date()): PhaseDEvidenceBundle[] {
  const out: PhaseDEvidenceBundle[] = [];
  for (const row of rows) {
    if (row.raw <= 0 || row.high <= 0) continue;
    const ratio = row.high / row.raw;
    if (ratio >= PHASE_D_PREMIUM_TIGHT) continue;
    out.push(
      PhaseDEvidenceBundleSchema.parse({
        emitterKey: "grade_premium_compression",
        emitterVersion: PHASE_D_RULE,
        assetId: row.assetId,
        conditionKey: row.highKey,
        direction: "bearish",
        strength: clamp01((PHASE_D_PREMIUM_TIGHT - ratio) / PHASE_D_PREMIUM_TIGHT),
        confidence: capConfidence(0.6),
        firedAt: now.toISOString(),
        evidence: {
          rawUngraded: row.raw,
          highGrade: row.high,
          highKey: row.highKey,
          ratio: Number(ratio.toFixed(3)),
        },
        notes: "Within-snapshot tier spread only. 90d compression deferred until 30 nightly snapshots.",
      }),
    );
  }
  return out
    .sort((a, b) => b.strength - a.strength)
    .slice(0, SIGNALS_CONTEXT_CAP);
}

export async function loadAskRows(): Promise<AskRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH asks AS (
      SELECT
        l.asset_id,
        l.condition_key,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY l.ask_price::float) AS median_ask,
        count(*)::int AS listing_count
      FROM vault_market.listing_observation l
      WHERE l.observation_kind = 'browse_listing'
        AND l.ask_price IS NOT NULL
        AND l.ask_price > 0
      GROUP BY l.asset_id, l.condition_key
    )
    SELECT
      a.asset_id::text,
      g.condition_key,
      a.median_ask,
      a.listing_count,
      g.guide_price::float AS guide_price
    FROM asks a
    JOIN vault_market.v_guide_price_baseline g
      ON g.asset_id = a.asset_id
     AND (
       g.condition_key = a.condition_key
       OR (a.condition_key = 'any' AND g.condition_key = 'raw_ungraded')
     )
    WHERE g.snapshot_on = (
      SELECT max(g2.snapshot_on)
        FROM vault_market.v_guide_price_baseline g2
       WHERE g2.asset_id = a.asset_id
         AND g2.condition_key = CASE
           WHEN a.condition_key = 'any' THEN 'raw_ungraded'
           ELSE a.condition_key
         END
    )
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    conditionKey: String(row.condition_key),
    medianAsk: Number(row.median_ask),
    listingCount: Number(row.listing_count),
    guidePrice: Number(row.guide_price),
  }));
}

export async function loadPremiumRows(): Promise<PremiumRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      raw.asset_id::text,
      raw.guide_price::float AS raw,
      high.guide_price::float AS high,
      high.condition_key AS high_key,
      s.year_began,
      s.publisher,
      a.canonical_name
    FROM vault_market.v_guide_price_baseline raw
    JOIN vault_market.v_guide_price_baseline high
      ON high.asset_id = raw.asset_id
     AND high.snapshot_on = raw.snapshot_on
     AND high.condition_key IN ('graded_9_8', 'graded_psa_10')
    JOIN vault_core.asset a ON a.id = raw.asset_id
    LEFT JOIN vault_comic.variant v ON v.asset_id = raw.asset_id
    LEFT JOIN vault_comic.issue i ON i.id = v.issue_id
    LEFT JOIN vault_comic.series s ON s.id = i.series_id
    WHERE raw.condition_key = 'raw_ungraded'
      AND raw.snapshot_on = (
        SELECT max(g.snapshot_on)
          FROM vault_market.v_guide_price_baseline g
         WHERE g.asset_id = raw.asset_id
           AND g.condition_key = 'raw_ungraded'
      )
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    raw: Number(row.raw),
    high: Number(row.high),
    highKey: row.high_key === "graded_psa_10" ? "graded_psa_10" : "graded_9_8",
    yearBegan: row.year_began == null ? null : Number(row.year_began),
    publisher: row.publisher == null ? null : String(row.publisher),
    canonicalName: row.canonical_name == null ? null : String(row.canonical_name),
  }));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) * (hi - idx) + (sorted[hi] ?? 0) * (idx - lo);
}

function priceBand(guide: number): string {
  if (guide < 5) return "<$5";
  if (guide < 15) return "$5-15";
  if (guide < 40) return "$15-40";
  if (guide < 100) return "$40-100";
  return "$100+";
}

function eraBucket(year: number | null): string {
  if (year == null) return "unknown";
  if (year < 1956) return "golden";
  if (year < 1970) return "silver";
  if (year < 1975) return "bronze-early";
  if (year < 1986) return "bronze";
  if (year < 1992) return "copper";
  return "modern";
}

function counts(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

export async function loadAskCalibrationRows(): Promise<AskCalibrationRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH asks AS (
      SELECT
        l.asset_id,
        l.condition_key,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY l.ask_price::float) AS median_ask,
        count(*)::int AS listing_count
      FROM vault_market.listing_observation l
      WHERE l.observation_kind = 'browse_listing'
        AND l.ask_price IS NOT NULL
        AND l.ask_price > 0
      GROUP BY l.asset_id, l.condition_key
    )
    SELECT
      a.asset_id::text,
      g.condition_key,
      a.median_ask,
      a.listing_count,
      g.guide_price::float AS guide_price,
      s.publisher,
      s.year_began,
      asset.canonical_name
    FROM asks a
    JOIN vault_market.v_guide_price_baseline g
      ON g.asset_id = a.asset_id
     AND (
       g.condition_key = a.condition_key
       OR (a.condition_key = 'any' AND g.condition_key = 'raw_ungraded')
     )
    JOIN vault_core.asset asset ON asset.id = a.asset_id
    LEFT JOIN vault_comic.variant v ON v.asset_id = a.asset_id
    LEFT JOIN vault_comic.issue i ON i.id = v.issue_id
    LEFT JOIN vault_comic.series s ON s.id = i.series_id
    WHERE g.snapshot_on = (
      SELECT max(g2.snapshot_on)
        FROM vault_market.v_guide_price_baseline g2
       WHERE g2.asset_id = a.asset_id
         AND g2.condition_key = CASE
           WHEN a.condition_key = 'any' THEN 'raw_ungraded'
           ELSE a.condition_key
         END
    )
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    assetId: String(row.asset_id),
    conditionKey: String(row.condition_key),
    medianAsk: Number(row.median_ask),
    listingCount: Number(row.listing_count),
    guidePrice: Number(row.guide_price),
    publisher: row.publisher == null ? null : String(row.publisher),
    yearBegan: row.year_began == null ? null : Number(row.year_began),
    canonicalName: row.canonical_name == null ? null : String(row.canonical_name),
  }));
}

export function summarizeAskCalibration(rows: AskCalibrationRow[]) {
  const eligible = rows.filter((row) => row.listingCount >= PHASE_D_ASK_LISTING_MIN && row.guidePrice > 0);
  const ratios = eligible.map((row) => row.medianAsk / row.guidePrice).sort((a, b) => a - b);
  const fireAt = (threshold: number) => eligible.filter((row) => row.medianAsk / row.guidePrice > threshold).length;
  const highs = eligible.filter((row) => row.medianAsk / row.guidePrice > PHASE_D_ASK_HIGH);
  const rest = eligible.filter((row) => row.medianAsk / row.guidePrice <= PHASE_D_ASK_HIGH);
  const share = (subset: AskCalibrationRow[], key: (row: AskCalibrationRow) => string) => {
    const subsetCounts = counts(subset.map(key));
    const restCounts = counts(rest.map(key));
    return Object.keys({ ...subsetCounts, ...restCounts })
      .sort()
      .map((name) => ({
        name,
        high: subsetCounts[name] ?? 0,
        other: restCounts[name] ?? 0,
        highShare: subset.length ? (subsetCounts[name] ?? 0) / subset.length : 0,
        otherShare: rest.length ? (restCounts[name] ?? 0) / rest.length : 0,
      }));
  };
  const medianGuide = (subset: AskCalibrationRow[]) => {
    const values = subset.map((row) => row.guidePrice).sort((a, b) => a - b);
    return percentile(values, 0.5);
  };
  return {
    eligible: eligible.length,
    min: ratios[0] ?? 0,
    p25: percentile(ratios, 0.25),
    p50: percentile(ratios, 0.5),
    p75: percentile(ratios, 0.75),
    p90: percentile(ratios, 0.9),
    max: ratios[ratios.length - 1] ?? 0,
    fires: {
      at115: fireAt(1.15),
      at125: fireAt(1.25),
      at150: fireAt(1.5),
      at200: fireAt(2.0),
    },
    highCount: highs.length,
    medianGuideHigh: medianGuide(highs),
    medianGuideOther: medianGuide(rest),
    byPriceBand: share(highs, (row) => priceBand(row.guidePrice)),
    byPublisher: share(highs, (row) => row.publisher ?? "unknown")
      .sort((a, b) => b.high - a.high)
      .slice(0, 12),
    byEra: share(highs, (row) => eraBucket(row.yearBegan)),
  };
}

export function formatAskCalibration(summary: ReturnType<typeof summarizeAskCalibration>): string {
  const line = (rows: Array<{ name: string; high: number; other: number; highShare: number; otherShare: number }>) =>
    rows
      .map(
        (row) =>
          `  ${row.name}: high=${row.high} (${(row.highShare * 100).toFixed(0)}%) other=${row.other} (${(row.otherShare * 100).toFixed(0)}%)`,
      )
      .join("\n");
  return [
    `ask/guide eligible=${summary.eligible}`,
    `  min=${summary.min.toFixed(3)} p25=${summary.p25.toFixed(3)} p50=${summary.p50.toFixed(3)} p75=${summary.p75.toFixed(3)} p90=${summary.p90.toFixed(3)} max=${summary.max.toFixed(3)}`,
    `  fires >1.15=${summary.fires.at115} >1.25=${summary.fires.at125} >1.50=${summary.fires.at150} >2.00=${summary.fires.at200}`,
    `  highs=${summary.highCount} medianGuide high=$${summary.medianGuideHigh.toFixed(2)} other=$${summary.medianGuideOther.toFixed(2)}`,
    "by price band (guide):",
    line(summary.byPriceBand),
    "by era:",
    line(summary.byEra),
    "by publisher (top):",
    line(summary.byPublisher),
  ].join("\n");
}

export async function nightlySnapshotDays(): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT count(DISTINCT snapshot_on)::int AS days
      FROM vault_market.guide_price_observation
     WHERE ingest_batch = 'phase_b_csv'
       AND baseline_eligible
  `);
  return Number((result.rows[0] as { days: number } | undefined)?.days ?? 0);
}

export async function loadPhaseDContext(now = new Date()): Promise<PhaseDContext> {
  const [days, asks, premiums] = await Promise.all([
    nightlySnapshotDays(),
    loadAskRows(),
    loadPremiumRows(),
  ]);
  return PhaseDContextSchema.parse({
    nightlySnapshotDays: days,
    deferredEmitters: ["price_acceleration", "lull_detected"],
    deferredUntilSnapshots: PHASE_D_MIN_NIGHTLY_SNAPSHOTS,
    askDivergence: emitAskDivergence(asks, now),
    gradePremiumCompression: emitGradePremiumCompression(premiums, now),
    gradingArbitrage: emitGradingArbitrage(premiums, now),
    phase2Enabled: false,
    provenance: {
      source: "phase_d_cross_section",
      method: "inferred",
      ruleOrModelVersion: PHASE_D_RULE,
      verificationStatus: "unverified",
      confidenceCeiling: PHASE_D_CONFIDENCE_CEILING,
      notes:
        "Wave 1 cross-section only. price_acceleration and lull wait for 30 nightly snapshots. " +
        "Not signals_normalized. Phase 2 scoring stays off. Confidence ≤ 0.75.",
    },
  });
}

export function formatPhaseDContext(ctx: PhaseDContext): string {
  return [
    `${PHASE_D_RULE} nightlySnapshotDays=${ctx.nightlySnapshotDays} need=${ctx.deferredUntilSnapshots}`,
    `askDivergence=${ctx.askDivergence.length} gradePremiumCompression=${ctx.gradePremiumCompression.length} gradingArbitrage=${ctx.gradingArbitrage.length}`,
    `deferred=${ctx.deferredEmitters.join(",")} phase2Enabled=${ctx.phase2Enabled}`,
  ].join("\n");
}
