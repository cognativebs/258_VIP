/**
 * Postgres backend for the manual intelligence store (backlog O).
 *
 * Writes land in the vault_core tables from migrations 20260815_11..16, which
 * were unused until now. The tables' own guards stay authoritative:
 *   - prediction: trg_prediction_protect_forecast (forecast fields frozen,
 *     resolved rows immutable, no deletes) and trg_prediction_set_resolves_at;
 *   - acquisition_underwriting: trg_underwriting_protect_locked;
 *   - card_scan: trg_card_scan_no_update; card_identification: confirmed
 *     identity never overwritten in place.
 * Reads go through the views the migrations name for read paths
 * (recommendation_active, evidence_card_live, acquisition_underwriting_flagged,
 * prediction_needs_scoring), so stale and below-threshold flags come from SQL.
 *
 * Provenance (Q21, owner 2026-11-23): prediction, acquisition_underwriting,
 * grading_evaluation, recommendation and evidence_card store provenance in
 * prov_* columns at write time. Rows written before that have NULL prov_* and
 * are rebuilt on read, labelled so in `notes` with the reader's rule version.
 *
 * Field capture -> underwriting (Q20) is field_captured_item.acquisition_underwriting_id.
 *
 * Nothing here writes vault_market (HS-2) or implies a priced_unit join (HS-1);
 * assets join on vault_core.asset(id), holdings on vault_collection.holding(id).
 */
import type { Pool, PoolClient } from "pg";
import {
  CardScanSchema,
  DUE_PREDICTIONS_RULE,
  EvidenceCardSchema,
  FieldSessionSchema,
  GradingEvaluationSchema,
  INTELLIGENCE_IMPORT_RULE,
  INTELLIGENCE_VERSION,
  IdentificationGoldenCaseSchema,
  MarketCycleStateSchema,
  PredictionSchema,
  RecommendationRecordSchema,
  UnderwritingSchema,
  BuyOpportunityScanSchema,
  FieldCaptureSchema,
  isUuid,
  lockUnderwriting,
  resolvePrediction,
  type BuyOpportunityScan,
  type CardIdentification,
  type CardScan,
  type DuePredictionsReport,
  type FieldCapture,
  type FieldSession,
  type GradingEvaluation,
  type IdentificationGoldenCase,
  type ImportCollectionReport,
  type IntelligenceCollection,
  type IntelligenceImportReport,
  type MarketCycleState,
  type Prediction,
  type RecommendationRecord,
  type Underwriting,
} from "@vip/intelligence";
import { ProvenanceSchema, markInferred, markObserved, type Provenance } from "@vip/evidence";
import {
  buildFieldCapture,
  buildFieldSession,
  buildGoldenCase,
  buildGrading,
  buildManualCycle,
  buildPrediction,
  buildUnderwriting,
  emptyIntelligenceDoc,
  type IntelligenceDoc,
  type IntelligenceStore,
} from "./intelligenceStore.js";

export type PgExec = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type PgIntelligenceStoreOptions = {
  /**
   * The executor is a client already inside a transaction (tests). Writes then
   * use SAVEPOINTs instead of BEGIN/COMMIT so the caller's ROLLBACK undoes them.
   */
  inTransaction?: boolean;
};

const REBUILT_NOTE = (table: string) =>
  `provenance rebuilt on read — this vault_core.${table} row predates stored provenance; rule version is the reader's (${INTELLIGENCE_VERSION})`;

/** Q21: the six prov_* columns, in insert order. */
const PROV_COLUMNS =
  "prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification_status, prov_notes";

function provParams(p: Provenance | null | undefined): unknown[] {
  if (!p) return [null, null, null, null, null, null];
  return [
    p.source,
    p.method,
    p.ruleOrModelVersion,
    Number(p.confidence.toFixed(3)),
    p.verificationStatus,
    p.notes ?? null,
  ];
}

/** Provenance stored at write time, or null for a row written before Q21. */
function storedProvenance(r: Record<string, unknown>): Provenance | null {
  if (r.prov_rule_version == null || r.prov_method == null || r.prov_source == null) return null;
  return ProvenanceSchema.parse({
    source: String(r.prov_source),
    method: String(r.prov_method),
    ruleOrModelVersion: String(r.prov_rule_version),
    confidence: r.prov_confidence == null ? 0 : Number(r.prov_confidence),
    verificationStatus: String(r.prov_verification_status ?? "unverified"),
    ...(r.prov_notes != null ? { notes: String(r.prov_notes) } : {}),
  });
}

/** SELECT from a read view plus the base table's prov_* columns (views list their columns explicitly). */
function viewWithProv(view: string, base: string): string {
  return `SELECT v.*, b.prov_source, b.prov_method, b.prov_rule_version, b.prov_confidence,
                 b.prov_verification_status, b.prov_notes
            FROM vault_core.${view} v JOIN vault_core.${base} b ON b.id = v.id`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Postgres could not be reached or is not migrated — the only case the JSON fallback covers. */
export function isPgUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if (
    [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "ECONNRESET",
      "EHOSTUNREACH",
      "EAI_AGAIN",
      "57P01", // admin_shutdown
      "57P03", // cannot_connect_now
      "3D000", // database does not exist
      "28P01", // auth failed
      "28000",
      "42P01", // undefined table: migrations not applied
      "3F000", // undefined schema
    ].includes(code)
  ) {
    return true;
  }
  if (code.startsWith("08")) return true; // connection exception class
  const msg = typeof e.message === "string" ? e.message : "";
  return /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/i.test(msg);
}

/** Turn constraint/trigger errors into sentences the desk can show. */
function readable(err: unknown): Error {
  if (!err || typeof err !== "object") return new Error(String(err));
  const e = err as { code?: string; message?: string; detail?: string; constraint?: string };
  if (isPgUnavailable(err)) return err as Error;
  if (e.code === "23503") {
    return new Error(
      `References a row that does not exist (${e.constraint ?? "foreign key"}): ${e.detail ?? e.message ?? ""}`.trim(),
    );
  }
  if (e.code === "22P02") return new Error(`Not a valid id: ${e.message ?? ""}`);
  return err instanceof Error ? err : new Error(String(e.message ?? err));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function numOrNull(v: unknown): number | null {
  return v == null ? null : num(v);
}

function date(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

function dateOrNull(v: unknown): Date | null {
  return v == null ? null : date(v);
}

async function exists(db: PgExec, table: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await db.query(`SELECT 1 FROM ${table} WHERE id = $1::uuid`, [id]);
  return r.rows.length > 0;
}

async function requireAsset(db: PgExec, assetId: string, label: string): Promise<void> {
  if (!(await exists(db, "vault_core.asset", assetId))) {
    throw new Error(
      `${label} ${assetId} is not in vault_core.asset — the Postgres ledger only takes catalog assets (pass the asset's UUID).`,
    );
  }
}

async function requireHolding(db: PgExec, holdingId: string): Promise<void> {
  if (!(await exists(db, "vault_collection.holding", holdingId))) {
    throw new Error(
      `Holding ${holdingId} is not in vault_collection.holding — the Postgres ledger only takes real holdings (pass the holding's UUID).`,
    );
  }
}

/**
 * Q18 (owner 2026-11-23): the desk can name an asset by UUID, slug, exact
 * canonical name (case-insensitive) or an external id value, as it could with
 * the JSON store. Exactly one asset must match; zero or several is an error
 * that names the matches — never a guess.
 */
export const ASSET_KEY_LOOKUP_RULE = "intel-asset-key-lookup@0.1.0";

export async function resolveAssetKey(db: PgExec, raw: unknown, label: string): Promise<string> {
  const keyText = String(raw ?? "").trim();
  if (!keyText) throw new Error(`${label} is empty — pass an asset UUID, slug or exact name.`);
  if (isUuid(keyText)) {
    await requireAsset(db, keyText, label);
    return keyText;
  }
  const r = await db.query(
    `SELECT a.id, a.canonical_name
       FROM vault_core.asset a
      WHERE lower(a.slug) = lower($1)
         OR lower(a.canonical_name) = lower($1)
         OR a.id IN (SELECT e.asset_id FROM vault_core.external_id e WHERE e.external_value = $1)
      ORDER BY a.canonical_name
      LIMIT 6`,
    [keyText],
  );
  const rows = r.rows as Array<{ id: string; canonical_name: string }>;
  if (rows.length === 1) return String(rows[0]!.id);
  if (rows.length === 0) {
    throw new Error(
      `${label} matches no asset in vault_core.asset (by slug, exact name or external id). Pass the asset's UUID.`,
    );
  }
  const names = rows.slice(0, 5).map((row) => `${row.canonical_name} (${row.id})`).join("; ");
  throw new Error(`${label} matches ${rows.length >= 6 ? "6+" : rows.length} assets: ${names}. Pass the UUID.`);
}

/** A holding by UUID, or by an asset key when that asset has exactly one holding. */
export async function resolveHoldingKey(db: PgExec, raw: unknown): Promise<string> {
  const keyText = String(raw ?? "").trim();
  if (isUuid(keyText)) {
    await requireHolding(db, keyText);
    return keyText;
  }
  const assetId = await resolveAssetKey(db, keyText, `Holding "${keyText}"`);
  const r = await db.query(
    `SELECT id FROM vault_collection.holding WHERE asset_id = $1::uuid ORDER BY id LIMIT 3`,
    [assetId],
  );
  if (r.rows.length === 1) return String((r.rows[0] as { id: string }).id);
  throw new Error(
    r.rows.length === 0
      ? `Holding "${keyText}": asset ${assetId} has no holding in vault_collection.holding.`
      : `Holding "${keyText}": asset ${assetId} has several holdings. Pass the holding's UUID.`,
  );
}


let savepointSeq = 0;

async function withTx<T>(
  db: PgExec | Pool,
  opts: PgIntelligenceStoreOptions,
  fn: (tx: PgExec) => Promise<T>,
): Promise<T> {
  if (opts.inTransaction) {
    const name = `intel_sp_${++savepointSeq}`;
    await db.query(`SAVEPOINT ${name}`);
    try {
      const out = await fn(db);
      await db.query(`RELEASE SAVEPOINT ${name}`);
      return out;
    } catch (e) {
      await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw e;
    }
  }
  const pool = db as Pool;
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

export function predictionFromRow(r: Record<string, unknown>): Prediction {
  const resolved = r.resolved_at != null;
  const confidence = numOrNull(r.confidence);
  const modelVersion = String(r.model_version);
  return PredictionSchema.parse({
    id: String(r.id),
    assetId: String(r.asset_id),
    predictedAt: date(r.predicted_at),
    priceAtPrediction: num(r.price_at_prediction),
    horizonDays: num(r.horizon_days),
    resolvesAt: date(r.resolves_at),
    probabilityDown: num(r.probability_down),
    probabilitySideways: num(r.probability_sideways),
    probabilityUp: num(r.probability_up),
    assumptions: (r.assumptions as string | null) ?? null,
    evidenceIds: (r.evidence_ids as string[] | null) ?? [],
    confidence,
    modelVersion,
    actualPrice: numOrNull(r.actual_price),
    actualDirection: (r.actual_direction as string | null) ?? null,
    forecastError: numOrNull(r.forecast_error),
    explanation: (r.explanation as string | null) ?? null,
    modelAdjustment: (r.model_adjustment as string | null) ?? null,
    resolvedAt: dateOrNull(r.resolved_at),
    createdAt: date(r.created_at),
    provenance: (() => {
      const stored = storedProvenance(r);
      if (resolved) {
        return markObserved({
          source: stored?.source ?? modelVersion,
          ruleOrModelVersion: stored?.ruleOrModelVersion ?? INTELLIGENCE_VERSION,
          confidence: 1,
          notes: stored
            ? "Outcome recorded after horizon · forecast provenance stored at write"
            : `Outcome recorded after horizon · ${REBUILT_NOTE("prediction")}`,
        });
      }
      return (
        stored ??
        markInferred({
          source: modelVersion,
          ruleOrModelVersion: INTELLIGENCE_VERSION,
          confidence: confidence ?? 0.5,
          notes: `Frozen forecast — unverified until resolution · ${REBUILT_NOTE("prediction")}`,
        })
      );
    })(),
  });
}

function underwritingFromRow(r: Record<string, unknown>): Underwriting {
  const confidence = numOrNull(r.confidence);
  return UnderwritingSchema.parse({
    id: String(r.id),
    assetId: (r.asset_id as string | null) ?? null,
    lotDescription: (r.lot_description as string | null) ?? null,
    evaluatedAt: date(r.evaluated_at),
    askingPrice: num(r.asking_price),
    offerPrice: num(r.offer_price),
    conservativeRawValue: num(r.conservative_raw_value),
    likelyRawValue: numOrNull(r.likely_raw_value),
    museumKeepValue: numOrNull(r.museum_keep_value),
    liquidationValue: numOrNull(r.liquidation_value),
    sellingCosts: numOrNull(r.selling_costs),
    expectedDaysToLiquidate: numOrNull(r.expected_days_to_liquidate),
    acquisitionCoverageRatio: num(r.acquisition_coverage_ratio),
    coverageRatioMinimumThreshold: num(r.coverage_ratio_minimum_threshold),
    belowThreshold: Boolean(r.below_threshold),
    blocked: false,
    expectedProfit: numOrNull(r.expected_profit),
    capitalAtRisk: numOrNull(r.capital_at_risk),
    confidence,
    linkedRecommendationId: (r.linked_recommendation_id as string | null) ?? null,
    completedTransaction: Boolean(r.completed_transaction),
    lockedAt: dateOrNull(r.locked_at),
    notes: (r.notes as string | null) ?? null,
    provenance: storedProvenance(r) ?? markInferred({
      source: "acquisition_underwriting",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: confidence ?? 0.7,
      notes: `Coverage ratio is a generated column; inputs are user-supplied · ${REBUILT_NOTE("acquisition_underwriting")}`,
    }),
  });
}

function gradingFromRow(r: Record<string, unknown>): GradingEvaluation {
  const recommendation = String(r.recommendation);
  return GradingEvaluationSchema.parse({
    id: String(r.id),
    holdingId: String(r.holding_id),
    evaluatedAt: date(r.evaluated_at),
    rawValue: num(r.raw_value),
    psa7Probability: numOrNull(r.psa7_probability),
    psa7Value: numOrNull(r.psa7_value),
    psa8Probability: numOrNull(r.psa8_probability),
    psa8Value: numOrNull(r.psa8_value),
    psa9Probability: numOrNull(r.psa9_probability),
    psa9Value: numOrNull(r.psa9_value),
    psa10Probability: numOrNull(r.psa10_probability),
    psa10Value: numOrNull(r.psa10_value),
    gradingCost: num(r.grading_cost),
    shippingCost: num(r.shipping_cost),
    insuranceCost: num(r.insurance_cost),
    sellingExpensePct: num(r.selling_expense_pct),
    opportunityCost: num(r.opportunity_cost),
    expectedGradingValue: num(r.expected_grading_value),
    expectedIncrementalProfit: num(r.expected_incremental_profit ?? 0),
    gradingOpportunityScore: num(r.grading_opportunity_score ?? 0),
    recommendation,
    graderRouting: (r.grader_routing as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    provenance: storedProvenance(r) ?? markInferred({
      source: "grading_optimizer",
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence: recommendation === "inspect_further" ? 0.3 : 0.65,
      notes: `PSA-tier inputs are manual · unverified unless a pop report is attached · ${REBUILT_NOTE("grading_evaluation")}`,
    }),
  });
}

function cycleFromRow(r: Record<string, unknown>): MarketCycleState {
  return MarketCycleStateSchema.parse({
    id: String(r.id),
    assetId: String(r.asset_id),
    evaluatedAt: date(r.evaluated_at),
    cycleState: String(r.cycle_state),
    bubbleRiskScore: numOrNull(r.bubble_risk_score),
    priceVelocity: numOrNull(r.price_velocity),
    priceVsAthPct: numOrNull(r.price_vs_ath_pct),
    salesVelocity: numOrNull(r.sales_velocity),
    listingSupply: numOrNull(r.listing_supply),
    populationGrowthRate: numOrNull(r.population_growth_rate),
    releaseAgeDays: numOrNull(r.release_age_days),
    reprintRisk: (r.reprint_risk as string | null) ?? null,
    popularitySignal: numOrNull(r.popularity_signal),
    liquidityScore: numOrNull(r.liquidity_score),
    dataSource: String(r.data_source),
    notes: (r.notes as string | null) ?? null,
  });
}

function scanFromRow(r: Record<string, unknown>): BuyOpportunityScan {
  return BuyOpportunityScanSchema.parse({
    id: String(r.id),
    assetId: String(r.asset_id),
    marketCycleStateId: (r.market_cycle_state_id as string | null) ?? null,
    scannedAt: date(r.scanned_at),
    buyOpportunityScore: numOrNull(r.buy_opportunity_score),
    declineFromHighPct: numOrNull(r.decline_from_high_pct),
    psaPremium: numOrNull(r.psa_premium),
    liquidityScore: numOrNull(r.liquidity_score),
    popularitySignal: numOrNull(r.popularity_signal),
    artworkDesirability: numOrNull(r.artwork_desirability),
    setQuality: numOrNull(r.set_quality),
    watchNote: (r.watch_note as string | null) ?? null,
    dataSource: String(r.data_source),
  });
}

function sessionFromRow(r: Record<string, unknown>): FieldSession {
  return FieldSessionSchema.parse({
    id: String(r.id),
    mode: String(r.mode),
    startedAt: date(r.started_at),
    endedAt: dateOrNull(r.ended_at),
    locationContext: (r.location_context as string | null) ?? null,
  });
}

function cardScanFromRow(r: Record<string, unknown>): CardScan {
  return CardScanSchema.parse({
    id: String(r.id),
    capturedAt: date(r.captured_at),
    imageRef: String(r.image_ref),
    physicalFingerprint: (r.physical_fingerprint as string | null) ?? null,
    source: String(r.source),
  });
}

function identificationFromRow(r: Record<string, unknown>): CardIdentification {
  return {
    id: String(r.id),
    cardScanId: String(r.card_scan_id),
    confirmedAssetId: (r.confirmed_asset_id as string | null) ?? null,
    chosenCandidateId: (r.chosen_candidate_id as string | null) ?? null,
    confirmedBy: (r.confirmed_by as string | null) ?? null,
    confirmedAt: dateOrNull(r.confirmed_at),
    needsReview: Boolean(r.needs_review),
    supersededBy: (r.superseded_by as string | null) ?? null,
    createdAt: date(r.created_at),
  };
}

function goldenFromRow(r: Record<string, unknown>): IdentificationGoldenCase {
  return IdentificationGoldenCaseSchema.parse({
    id: String(r.id),
    cardScanId: String(r.card_scan_id),
    knownCorrectAssetId: String(r.known_correct_asset_id),
    category: (r.category as string | null) ?? null,
    addedAt: date(r.added_at),
  });
}

function captureFromRow(r: Record<string, unknown>): FieldCapture {
  return FieldCaptureSchema.parse({
    id: String(r.id),
    fieldSessionId: String(r.field_session_id),
    capturedAt: date(r.captured_at).toISOString(),
    askingPrice: numOrNull(r.asking_price),
    imageRef: (r.image_ref as string | null) ?? null,
    recommendationId: (r.recommendation_id as string | null) ?? null,
    underwritingId: (r.underwriting_id as string | null) ?? null,
    cardScanId: (r.raw_scan_id as string | null) ?? null,
    identificationId: (r.identification_id as string | null) ?? null,
    // No identification row yet means nothing has reviewed it: still needs review.
    needsReview: r.needs_review == null ? true : Boolean(r.needs_review),
  });
}

function recommendationFromRows(
  r: Record<string, unknown>,
  cards: Record<string, unknown>[],
): RecommendationRecord | null {
  const id = String(r.id);
  const confidence = num(r.confidence);
  const parsed = RecommendationRecordSchema.safeParse({
    id,
    assetId: (r.asset_id as string | null) ?? null,
    holdingId: (r.holding_id as string | null) ?? null,
    action: String(r.action),
    confidence,
    rationale: (r.rationale as string | null) ?? null,
    createdAt: date(r.created_at),
    expiresAt: date(r.expires_at),
    sourceSystem: String(r.source_system),
    isStale: Boolean(r.is_stale),
    evidence: cards.map((c) =>
      EvidenceCardSchema.parse({
        id: String(c.id),
        recommendationId: id,
        evidenceSource: String(c.evidence_source),
        evidenceTimestamp: date(c.evidence_timestamp),
        freshnessHours: Math.max(0, num(c.freshness_hours)),
        confidence: numOrNull(c.confidence),
        supportingEvidence: (c.supporting_evidence as string | null) ?? null,
        contradictoryEvidence: (c.contradictory_evidence as string | null) ?? null,
        missingInformation: (c.missing_information as string | null) ?? null,
        confidenceWouldIncreaseIf: (c.confidence_would_increase_if as string | null) ?? null,
        rawReferenceId: (c.raw_reference_id as string | null) ?? null,
        createdAt: date(c.created_at),
        provenance: storedProvenance(c) ?? markObserved({
          source: String(c.evidence_source),
          ruleOrModelVersion: INTELLIGENCE_VERSION,
          confidence: numOrNull(c.confidence) ?? 0.7,
          notes: REBUILT_NOTE("evidence_card"),
        }),
      }),
    ),
    provenance: storedProvenance(r) ?? markObserved({
      source: String(r.source_system),
      ruleOrModelVersion: INTELLIGENCE_VERSION,
      confidence,
      notes: REBUILT_NOTE("recommendation"),
    }),
  });
  // A recommendation with no evidence_card is incomplete (table comment) — it is
  // not served as a recommendation.
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Inserts (shared by store writes and the JSON import). Each is idempotent on
// id and returns whether a row was inserted.
// ---------------------------------------------------------------------------

async function inserted(db: PgExec, text: string, params: unknown[]): Promise<boolean> {
  const r = await db.query(text, params);
  return r.rows.length > 0;
}

export function insertPrediction(db: PgExec, p: Prediction): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.prediction
       (id, asset_id, predicted_at, price_at_prediction, horizon_days, resolves_at,
        probability_down, probability_sideways, probability_up, assumptions, evidence_ids,
        confidence, model_version, actual_price, actual_direction, forecast_error,
        explanation, model_adjustment, resolved_at, created_at, ${PROV_COLUMNS})
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[], $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      p.id,
      p.assetId,
      p.predictedAt,
      p.priceAtPrediction,
      p.horizonDays,
      p.resolvesAt,
      p.probabilityDown,
      p.probabilitySideways,
      p.probabilityUp,
      p.assumptions ?? null,
      p.evidenceIds ?? [],
      p.confidence ?? null,
      p.modelVersion,
      p.actualPrice ?? null,
      p.actualDirection ?? null,
      p.forecastError ?? null,
      p.explanation ?? null,
      p.modelAdjustment ?? null,
      p.resolvedAt ?? null,
      p.createdAt,
      ...provParams(p.provenance),
    ],
  );
}

export function insertUnderwriting(db: PgExec, u: Underwriting, notes = u.notes): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.acquisition_underwriting
       (id, asset_id, lot_description, evaluated_at, asking_price, offer_price,
        conservative_raw_value, likely_raw_value, museum_keep_value, liquidation_value,
        selling_costs, expected_days_to_liquidate, coverage_ratio_minimum_threshold,
        expected_profit, capital_at_risk, confidence, linked_recommendation_id,
        completed_transaction, locked_at, notes, ${PROV_COLUMNS})
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17::uuid, $18, $19, $20, $21, $22, $23, $24, $25, $26)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      u.id,
      u.assetId ?? null,
      u.lotDescription ?? null,
      u.evaluatedAt,
      u.askingPrice,
      u.offerPrice,
      u.conservativeRawValue,
      u.likelyRawValue ?? null,
      u.museumKeepValue ?? null,
      u.liquidationValue ?? null,
      u.sellingCosts ?? null,
      u.expectedDaysToLiquidate ?? null,
      u.coverageRatioMinimumThreshold,
      u.expectedProfit ?? null,
      u.capitalAtRisk ?? null,
      u.confidence ?? null,
      u.linkedRecommendationId ?? null,
      u.completedTransaction,
      u.lockedAt ?? null,
      notes ?? null,
      ...provParams(u.provenance),
    ],
  );
}

export function insertGrading(db: PgExec, g: GradingEvaluation): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.grading_evaluation
       (id, holding_id, evaluated_at, raw_value, psa7_probability, psa7_value,
        psa8_probability, psa8_value, psa9_probability, psa9_value, psa10_probability,
        psa10_value, grading_cost, shipping_cost, insurance_cost, selling_expense_pct,
        opportunity_cost, expected_incremental_profit, grading_opportunity_score,
        recommendation, grader_routing, notes, ${PROV_COLUMNS})
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      g.id,
      g.holdingId,
      g.evaluatedAt,
      g.rawValue,
      g.psa7Probability ?? null,
      g.psa7Value ?? null,
      g.psa8Probability ?? null,
      g.psa8Value ?? null,
      g.psa9Probability ?? null,
      g.psa9Value ?? null,
      g.psa10Probability ?? null,
      g.psa10Value ?? null,
      g.gradingCost,
      g.shippingCost,
      g.insuranceCost,
      g.sellingExpensePct,
      g.opportunityCost,
      g.expectedIncrementalProfit,
      g.gradingOpportunityScore,
      g.recommendation,
      g.graderRouting ?? null,
      g.notes ?? null,
      ...provParams(g.provenance),
    ],
  );
}

export function insertCycle(db: PgExec, c: MarketCycleState): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.market_cycle_state
       (id, asset_id, evaluated_at, cycle_state, bubble_risk_score, price_velocity,
        price_vs_ath_pct, sales_velocity, listing_supply, population_growth_rate,
        release_age_days, reprint_risk, popularity_signal, liquidity_score, data_source, notes)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      c.id,
      c.assetId,
      c.evaluatedAt,
      c.cycleState,
      c.bubbleRiskScore ?? null,
      c.priceVelocity ?? null,
      c.priceVsAthPct ?? null,
      c.salesVelocity ?? null,
      c.listingSupply ?? null,
      c.populationGrowthRate ?? null,
      c.releaseAgeDays ?? null,
      c.reprintRisk ?? null,
      c.popularitySignal ?? null,
      c.liquidityScore ?? null,
      c.dataSource,
      c.notes ?? null,
    ],
  );
}

export function insertBuyScan(db: PgExec, s: BuyOpportunityScan): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.buy_opportunity_scan
       (id, asset_id, market_cycle_state_id, scanned_at, buy_opportunity_score,
        decline_from_high_pct, psa_premium, liquidity_score, popularity_signal,
        artwork_desirability, set_quality, watch_note, data_source)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      s.id,
      s.assetId,
      s.marketCycleStateId ?? null,
      s.scannedAt,
      s.buyOpportunityScore ?? null,
      s.declineFromHighPct ?? null,
      s.psaPremium ?? null,
      s.liquidityScore ?? null,
      s.popularitySignal ?? null,
      s.artworkDesirability ?? null,
      s.setQuality ?? null,
      s.watchNote ?? null,
      s.dataSource,
    ],
  );
}

export function insertFieldSession(db: PgExec, s: FieldSession): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.field_session (id, mode, started_at, ended_at, location_context)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [s.id, s.mode, s.startedAt, s.endedAt ?? null, s.locationContext ?? null],
  );
}

export function insertCardScan(db: PgExec, s: CardScan): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.card_scan (id, captured_at, image_ref, physical_fingerprint, source)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [s.id, s.capturedAt, s.imageRef, s.physicalFingerprint ?? null, s.source],
  );
}

/** superseded_by is written in a second pass (it references another identification row). */
export function insertIdentification(db: PgExec, i: CardIdentification): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.card_identification
       (id, card_scan_id, confirmed_asset_id, chosen_candidate_id, confirmed_by,
        confirmed_at, needs_review, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      i.id,
      i.cardScanId,
      i.confirmedAssetId,
      i.chosenCandidateId,
      i.confirmedBy,
      i.confirmedAt,
      i.needsReview,
      i.createdAt,
    ],
  );
}

export function insertGoldenCase(db: PgExec, g: IdentificationGoldenCase): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.identification_golden_case
       (id, card_scan_id, known_correct_asset_id, category, added_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [g.id, g.cardScanId, g.knownCorrectAssetId, g.category ?? null, g.addedAt],
  );
}

export function insertCapture(db: PgExec, c: FieldCapture): Promise<boolean> {
  return inserted(
    db,
    `INSERT INTO vault_core.field_captured_item
       (id, field_session_id, captured_at, raw_scan_id, asking_price, recommendation_id,
        acquisition_underwriting_id)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7::uuid)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      c.id,
      c.fieldSessionId,
      new Date(c.capturedAt),
      c.cardScanId,
      c.askingPrice,
      c.recommendationId,
      c.underwritingId ?? null,
    ],
  );
}

export async function insertRecommendation(db: PgExec, r: RecommendationRecord): Promise<boolean> {
  const did = await inserted(
    db,
    `INSERT INTO vault_core.recommendation
       (id, asset_id, holding_id, action, confidence, rationale, created_at, expires_at, source_system,
        ${PROV_COLUMNS})
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      r.id,
      r.assetId ?? null,
      r.holdingId ?? null,
      r.action,
      r.confidence,
      r.rationale ?? null,
      r.createdAt,
      r.expiresAt,
      r.sourceSystem,
      ...provParams(r.provenance),
    ],
  );
  if (did) {
    for (const c of r.evidence) {
      await db.query(
        `INSERT INTO vault_core.evidence_card
           (id, recommendation_id, evidence_source, evidence_timestamp, confidence,
            supporting_evidence, contradictory_evidence, missing_information,
            confidence_would_increase_if, raw_reference_id, created_at, ${PROV_COLUMNS})
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          r.id,
          c.evidenceSource,
          c.evidenceTimestamp,
          c.confidence ?? null,
          c.supportingEvidence ?? null,
          c.contradictoryEvidence ?? null,
          c.missingInformation ?? null,
          c.confidenceWouldIncreaseIf ?? null,
          c.rawReferenceId ?? null,
          c.createdAt,
          ...provParams(c.provenance),
        ],
      );
    }
  }
  return did;
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const CAPTURE_SELECT = `
  SELECT c.*, s.image_ref, i.id AS identification_id, i.needs_review,
         c.acquisition_underwriting_id AS underwriting_id
    FROM vault_core.field_captured_item c
    LEFT JOIN vault_core.card_scan s ON s.id = c.raw_scan_id
    LEFT JOIN LATERAL (
      SELECT ci.id, ci.needs_review FROM vault_core.card_identification ci
       WHERE ci.card_scan_id = c.raw_scan_id AND ci.superseded_by IS NULL
       ORDER BY ci.created_at DESC LIMIT 1
    ) i ON true`;

async function one<T>(
  db: PgExec,
  text: string,
  id: string,
  map: (r: Record<string, unknown>) => T,
): Promise<T> {
  const r = await db.query(text, [id]);
  if (!r.rows[0]) throw new Error(`Row ${id} not found after write`);
  return map(r.rows[0]);
}

export async function loadPgIntelligenceDoc(db: PgExec): Promise<IntelligenceDoc> {
  const q = async (text: string) => (await db.query(text)).rows as Record<string, unknown>[];
  // One query at a time: a single pg client must not be handed concurrent queries.
  const predictions = await q(`SELECT * FROM vault_core.prediction ORDER BY created_at, id`);
  const recs = await q(`${viewWithProv("recommendation_active", "recommendation")} ORDER BY v.created_at, v.id`);
  const cards = await q(`${viewWithProv("evidence_card_live", "evidence_card")} ORDER BY v.created_at, v.id`);
  const underwriting = await q(`${viewWithProv("acquisition_underwriting_flagged", "acquisition_underwriting")} ORDER BY v.evaluated_at, v.id`);
  const grading = await q(`SELECT * FROM vault_core.grading_evaluation ORDER BY evaluated_at, id`);
  const cycles = await q(`SELECT * FROM vault_core.market_cycle_state ORDER BY evaluated_at, id`);
  const scans = await q(`SELECT * FROM vault_core.buy_opportunity_scan ORDER BY scanned_at, id`);
  const sessions = await q(`SELECT * FROM vault_core.field_session ORDER BY started_at, id`);
  const captures = await q(`${CAPTURE_SELECT} ORDER BY c.captured_at, c.id`);
  const cardScans = await q(`SELECT * FROM vault_core.card_scan ORDER BY captured_at, id`);
  const idents = await q(`SELECT * FROM vault_core.card_identification ORDER BY created_at, id`);
  const golden = await q(`SELECT * FROM vault_core.identification_golden_case ORDER BY added_at, id`);

  const cardsByRec = new Map<string, Record<string, unknown>[]>();
  for (const c of cards) {
    const k = String(c.recommendation_id);
    cardsByRec.set(k, [...(cardsByRec.get(k) ?? []), c]);
  }
  return {
    ...emptyIntelligenceDoc(),
    predictions: predictions.map(predictionFromRow),
    recommendations: recs
      .map((r) => recommendationFromRows(r, cardsByRec.get(String(r.id)) ?? []))
      .filter((r): r is RecommendationRecord => r != null),
    underwriting: underwriting.map(underwritingFromRow),
    grading: grading.map(gradingFromRow),
    cycleStates: cycles.map(cycleFromRow),
    buyScans: scans.map(scanFromRow),
    fieldSessions: sessions.map(sessionFromRow),
    captures: captures.map(captureFromRow),
    cardScans: cardScans.map(cardScanFromRow),
    identifications: idents.map(identificationFromRow),
    goldenCases: golden.map(goldenFromRow),
  };
}

export async function pgDuePredictions(db: PgExec): Promise<DuePredictionsReport> {
  const r = await db.query(
    `SELECT p.*, b.prov_source, b.prov_method, b.prov_rule_version, b.prov_confidence,
            b.prov_verification_status, b.prov_notes, now() AS db_now
       FROM vault_core.prediction_needs_scoring p JOIN vault_core.prediction b ON b.id = p.id
      ORDER BY p.resolves_at, p.id`,
  );
  const rows = r.rows as Record<string, unknown>[];
  const asOf =
    rows[0]?.db_now != null
      ? date(rows[0].db_now)
      : date((await db.query(`SELECT now() AS db_now`)).rows[0]?.db_now ?? new Date());
  return {
    store: "postgres",
    source: "vault_core.prediction_needs_scoring",
    rule: DUE_PREDICTIONS_RULE,
    asOf: asOf.toISOString(),
    count: rows.length,
    predictions: rows.map(predictionFromRow),
    note: "Past horizon, no outcome recorded (database clock). A person records each outcome; nothing auto-resolves.",
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export function pgIntelligenceStore(
  db: Pool | PgExec,
  opts: PgIntelligenceStoreOptions = {},
): IntelligenceStore {
  const exec = db as PgExec;
  const tx = <T>(fn: (t: PgExec) => Promise<T>) =>
    withTx(db, opts, fn).catch((e: unknown) => {
      throw readable(e);
    });
  const read = <T>(p: Promise<T>) =>
    p.catch((e: unknown) => {
      throw readable(e);
    });

  return {
    kind: "postgres",
    load: () => read(loadPgIntelligenceDoc(exec)),
    duePredictions: () => read(pgDuePredictions(exec)),

    addPrediction: (body) =>
      tx(async (t) => {
        const assetId = await resolveAssetKey(t, body.assetId, `Asset "${String(body.assetId)}"`);
        const row = buildPrediction({ ...body, assetId });
        await insertPrediction(t, row);
        return one(t, `SELECT * FROM vault_core.prediction WHERE id = $1::uuid`, row.id, predictionFromRow);
      }),

    resolvePrediction: (id, actualPrice, notes) =>
      tx(async (t) => {
        if (!isUuid(id)) throw new Error(`Prediction not found: ${id}`);
        const found = await t.query(
          `SELECT * FROM vault_core.prediction WHERE id = $1::uuid FOR UPDATE`,
          [id],
        );
        if (!found.rows[0]) throw new Error(`Prediction not found: ${id}`);
        // Domain rules first (no early resolve, resolved rows frozen); the
        // forecast-protect trigger backs them up in SQL.
        const next = resolvePrediction(predictionFromRow(found.rows[0]), actualPrice, new Date(), notes);
        const upd = await t.query(
          `UPDATE vault_core.prediction
              SET actual_price = $2, actual_direction = $3, forecast_error = $4,
                  explanation = $5, model_adjustment = $6, resolved_at = $7
            WHERE id = $1::uuid AND resolved_at IS NULL
            RETURNING *`,
          [
            id,
            next.actualPrice,
            next.actualDirection,
            next.forecastError,
            next.explanation ?? null,
            next.modelAdjustment ?? null,
            next.resolvedAt,
          ],
        );
        if (!upd.rows[0]) throw new Error("A resolved prediction is never mutated again");
        return predictionFromRow(upd.rows[0]);
      }),

    addUnderwriting: (body) =>
      tx(async (t) => {
        const row = buildUnderwriting(body);
        await insertUnderwriting(t, row);
        return one(
          t,
          `${viewWithProv("acquisition_underwriting_flagged", "acquisition_underwriting")} WHERE v.id = $1::uuid`,
          row.id,
          underwritingFromRow,
        );
      }),

    lockUnderwriting: (id) =>
      tx(async (t) => {
        if (!isUuid(id)) throw new Error(`Underwriting not found: ${id}`);
        const found = await t.query(
          `${viewWithProv("acquisition_underwriting_flagged", "acquisition_underwriting")} WHERE v.id = $1::uuid`,
          [id],
        );
        if (!found.rows[0]) throw new Error(`Underwriting not found: ${id}`);
        const next = lockUnderwriting(underwritingFromRow(found.rows[0]), new Date());
        await t.query(
          `UPDATE vault_core.acquisition_underwriting
              SET completed_transaction = true, locked_at = $2
            WHERE id = $1::uuid AND locked_at IS NULL`,
          [id, next.lockedAt],
        );
        return one(
          t,
          `${viewWithProv("acquisition_underwriting_flagged", "acquisition_underwriting")} WHERE v.id = $1::uuid`,
          id,
          underwritingFromRow,
        );
      }),

    addGrading: (body) =>
      tx(async (t) => {
        const holdingId = await resolveHoldingKey(t, body.holdingId);
        const row = buildGrading({ ...body, holdingId });
        await insertGrading(t, row);
        return one(t, `SELECT * FROM vault_core.grading_evaluation WHERE id = $1::uuid`, row.id, gradingFromRow);
      }),

    addManualCycle: (body) =>
      tx(async (t) => {
        const assetId = await resolveAssetKey(t, body.assetId, `Asset "${String(body.assetId)}"`);
        const { cycle, scan } = buildManualCycle({ ...body, assetId });
        await insertCycle(t, cycle);
        await insertBuyScan(t, scan);
        return {
          cycle: await one(t, `SELECT * FROM vault_core.market_cycle_state WHERE id = $1::uuid`, cycle.id, cycleFromRow),
          scan: await one(t, `SELECT * FROM vault_core.buy_opportunity_scan WHERE id = $1::uuid`, scan.id, scanFromRow),
        };
      }),

    startFieldSession: (body) =>
      tx(async (t) => {
        const row = buildFieldSession(body);
        await insertFieldSession(t, row);
        return one(t, `SELECT * FROM vault_core.field_session WHERE id = $1::uuid`, row.id, sessionFromRow);
      }),

    captureFieldItem: (body) =>
      tx(async (t) => {
        const sid = String(body.sessionId ?? "");
        const found = isUuid(sid)
          ? await t.query(`SELECT * FROM vault_core.field_session WHERE id = $1::uuid`, [sid])
          : { rows: [] };
        if (!found.rows[0]) throw new Error(`Field session not found: ${body.sessionId}`);
        const bundle = buildFieldCapture(sessionFromRow(found.rows[0]), body);
        if (bundle.cardScan) await insertCardScan(t, bundle.cardScan);
        if (bundle.identification) await insertIdentification(t, bundle.identification);
        if (bundle.underwriting) {
          await insertUnderwriting(t, bundle.underwriting);
        }
        await insertCapture(t, bundle.capture);
        return one(t, `${CAPTURE_SELECT} WHERE c.id = $1::uuid`, bundle.capture.id, captureFromRow);
      }),

    addGoldenCase: (body) =>
      tx(async (t) => {
        const knownCorrectAssetId = await resolveAssetKey(
          t,
          body.knownCorrectAssetId,
          `Known-correct asset "${String(body.knownCorrectAssetId)}"`,
        );
        const { cardScan, goldenCase } = buildGoldenCase({ ...body, knownCorrectAssetId });
        await insertCardScan(t, cardScan);
        await insertGoldenCase(t, goldenCase);
        return one(
          t,
          `SELECT * FROM vault_core.identification_golden_case WHERE id = $1::uuid`,
          goldenCase.id,
          goldenFromRow,
        );
      }),
  };
}

// ---------------------------------------------------------------------------
// One-shot import of a JSON state file (idempotent on id).
// ---------------------------------------------------------------------------

const TABLES: Record<IntelligenceCollection, string> = {
  fieldSessions: "vault_core.field_session",
  cardScans: "vault_core.card_scan",
  identifications: "vault_core.card_identification",
  goldenCases: "vault_core.identification_golden_case",
  recommendations: "vault_core.recommendation (+ evidence_card)",
  predictions: "vault_core.prediction",
  underwriting: "vault_core.acquisition_underwriting",
  grading: "vault_core.grading_evaluation",
  cycleStates: "vault_core.market_cycle_state",
  buyScans: "vault_core.buy_opportunity_scan",
  captures: "vault_core.field_captured_item",
};

type ImportStep = {
  /** Reason to skip (a referenced catalog row is missing), or null to insert. */
  precheck: (db: PgExec) => Promise<string | null>;
  insert: (db: PgExec) => Promise<boolean>;
};

/**
 * Copy every row of a JSON intelligence document into vault_core, preserving
 * ids and timestamps. Re-running is a no-op (ON CONFLICT (id) DO NOTHING).
 * Rows whose asset / holding / parent row is not in Postgres are skipped and
 * reported, never written with a placeholder. The JSON file is never modified.
 *
 * `dryRun` runs every insert inside one transaction and rolls it back, so the
 * counts are what a real run would do against the current database.
 */
export async function importIntelligenceDoc(
  db: Pool | PgExec,
  raw: Partial<IntelligenceDoc>,
  opts: { dryRun: boolean; source: string; inTransaction?: boolean },
): Promise<IntelligenceImportReport> {
  const doc: IntelligenceDoc = { ...emptyIntelligenceDoc(), ...raw };

  const asset = (id: string | null | undefined, label = "asset") => async (db: PgExec) =>
    id == null || (await exists(db, "vault_core.asset", id)) ? null : `${label} ${id} not in vault_core.asset`;
  const holding = (id: string | null | undefined) => async (db: PgExec) =>
    id == null || (await exists(db, "vault_collection.holding", id))
      ? null
      : `holding ${id} not in vault_collection.holding`;
  const parent = (table: string, id: string | null | undefined, label: string) => async (db: PgExec) =>
    id == null || (await exists(db, table, id)) ? null : `${label} ${id} not in ${table}`;
  const all =
    (...checks: Array<(db: PgExec) => Promise<string | null>>) =>
    async (db: PgExec) => {
      for (const c of checks) {
        const why = await c(db);
        if (why) return why;
      }
      return null;
    };

  function steps(collection: IntelligenceCollection, row: unknown): ImportStep {
    switch (collection) {
      case "fieldSessions": {
        const s = FieldSessionSchema.parse(row);
        return { precheck: async () => null, insert: (db) => insertFieldSession(db, s) };
      }
      case "cardScans": {
        const s = CardScanSchema.parse(row);
        return { precheck: async () => null, insert: (db) => insertCardScan(db, s) };
      }
      case "identifications": {
        const i = row as CardIdentification;
        if (!i?.id || !i.cardScanId) throw new Error("identification row missing id or cardScanId");
        const ident: CardIdentification = {
          ...i,
          confirmedAt: i.confirmedAt ? date(i.confirmedAt) : null,
          createdAt: date(i.createdAt),
        };
        return {
          precheck: all(
            parent("vault_core.card_scan", ident.cardScanId, "card scan"),
            asset(ident.confirmedAssetId, "confirmed asset"),
            parent("vault_core.card_identification_candidate", ident.chosenCandidateId, "candidate"),
          ),
          insert: (db) => insertIdentification(db, ident),
        };
      }
      case "goldenCases": {
        const g = IdentificationGoldenCaseSchema.parse(row);
        return {
          precheck: all(
            parent("vault_core.card_scan", g.cardScanId, "card scan"),
            asset(g.knownCorrectAssetId, "known-correct asset"),
          ),
          insert: (db) => insertGoldenCase(db, g),
        };
      }
      case "recommendations": {
        const r = RecommendationRecordSchema.parse(row);
        return {
          precheck: all(asset(r.assetId), holding(r.holdingId)),
          insert: (db) => insertRecommendation(db, r),
        };
      }
      case "predictions": {
        const p = PredictionSchema.parse(row);
        return { precheck: asset(p.assetId), insert: (db) => insertPrediction(db, p) };
      }
      case "underwriting": {
        const u = UnderwritingSchema.parse(row);
        return {
          precheck: all(
            asset(u.assetId),
            parent("vault_core.recommendation", u.linkedRecommendationId, "recommendation"),
          ),
          insert: (db) => insertUnderwriting(db, u),
        };
      }
      case "grading": {
        const g = GradingEvaluationSchema.parse(row);
        return { precheck: holding(g.holdingId), insert: (db) => insertGrading(db, g) };
      }
      case "cycleStates": {
        const c = MarketCycleStateSchema.parse(row);
        return { precheck: asset(c.assetId), insert: (db) => insertCycle(db, c) };
      }
      case "buyScans": {
        const s = BuyOpportunityScanSchema.parse(row);
        return {
          precheck: all(
            asset(s.assetId),
            parent("vault_core.market_cycle_state", s.marketCycleStateId, "cycle state"),
          ),
          insert: (db) => insertBuyScan(db, s),
        };
      }
      case "captures": {
        const raw = row as Record<string, unknown>;
        const c = FieldCaptureSchema.parse({
          ...raw,
          capturedAt: raw.capturedAt instanceof Date ? raw.capturedAt.toISOString() : raw.capturedAt,
        });
        return {
          precheck: all(
            parent("vault_core.field_session", c.fieldSessionId, "field session"),
            parent("vault_core.card_scan", c.cardScanId, "card scan"),
            parent("vault_core.recommendation", c.recommendationId, "recommendation"),
            parent("vault_core.acquisition_underwriting", c.underwritingId ?? null, "underwriting"),
          ),
          insert: (db) => insertCapture(db, c),
        };
      }
    }
  }

  const ORDER: IntelligenceCollection[] = [
    "fieldSessions",
    "cardScans",
    "identifications",
    "goldenCases",
    "recommendations",
    "predictions",
    "underwriting",
    "grading",
    "cycleStates",
    "buyScans",
    "captures",
  ];

  // Own transaction from a pool; a savepoint when handed a client already in one (tests).
  const owned: PoolClient | null = opts.inTransaction ? null : await (db as Pool).connect();
  const client: PgExec = owned ?? (db as PgExec);
  const begin = opts.inTransaction ? "SAVEPOINT intel_import" : "BEGIN";
  const commit = opts.inTransaction ? "RELEASE SAVEPOINT intel_import" : "COMMIT";
  const rollback = opts.inTransaction ? "ROLLBACK TO SAVEPOINT intel_import" : "ROLLBACK";
  const collections = {} as Record<IntelligenceCollection, ImportCollectionReport>;
  try {
    await client.query(begin);
    for (const name of ORDER) {
      const rows = (doc[name] as unknown[] | undefined) ?? [];
      const rep: ImportCollectionReport = {
        table: TABLES[name],
        inJson: rows.length,
        inserted: 0,
        alreadyPresent: 0,
        skipped: [],
      };
      for (const row of rows) {
        const id = String((row as { id?: unknown })?.id ?? "?");
        await client.query("SAVEPOINT intel_import_row");
        try {
          const step = steps(name, row);
          const why = await step.precheck(client);
          if (why) {
            rep.skipped.push({ id, reason: why });
          } else if (await step.insert(client)) {
            rep.inserted += 1;
          } else {
            rep.alreadyPresent += 1;
          }
          await client.query("RELEASE SAVEPOINT intel_import_row");
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT intel_import_row");
          const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
          rep.skipped.push({ id, reason: `rejected: ${msg.slice(0, 300)}` });
        }
      }
      collections[name] = rep;
    }
    // Second pass: superseded_by links between identification rows.
    for (const i of doc.identifications ?? []) {
      if (!i?.supersededBy) continue;
      await client.query("SAVEPOINT intel_import_link");
      try {
        await client.query(
          `UPDATE vault_core.card_identification SET superseded_by = $2::uuid
            WHERE id = $1::uuid AND superseded_by IS NULL
              AND EXISTS (SELECT 1 FROM vault_core.card_identification WHERE id = $2::uuid)`,
          [i.id, i.supersededBy],
        );
        await client.query("RELEASE SAVEPOINT intel_import_link");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT intel_import_link");
      }
    }
    await client.query(opts.dryRun ? rollback : commit);
    if (opts.dryRun && opts.inTransaction) await client.query(commit);
  } catch (e) {
    await client.query(rollback).catch(() => undefined);
    throw e;
  } finally {
    owned?.release();
  }

  const reps = Object.values(collections);
  return {
    rule: INTELLIGENCE_IMPORT_RULE,
    source: opts.source,
    dryRun: opts.dryRun,
    collections,
    totals: {
      inJson: reps.reduce((s, r) => s + r.inJson, 0),
      inserted: reps.reduce((s, r) => s + r.inserted, 0),
      alreadyPresent: reps.reduce((s, r) => s + r.alreadyPresent, 0),
      skipped: reps.reduce((s, r) => s + r.skipped.length, 0),
    },
  };
}
