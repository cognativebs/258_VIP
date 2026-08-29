import { sql } from "drizzle-orm";
import {
  SCAN_HOLDING_SOURCE,
  SCAN_INGEST_RULE,
  SCAN_SNAPSHOT_SOURCE,
  assessCandidates,
  policyFromEnv,
  type OpenBatchResult,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";

/**
 * Durable staging for scan intake (ADR 0009).
 *
 * Batches, units, and every identity candidate live in `vault_media.*`.
 * Nothing here touches `vault_core.asset` or `vault_collection.holding` —
 * that boundary is crossed only by `resolveUnit`.
 */

const CATEGORY_IDS: Record<string, number> = {
  pokemon: 1,
  sports: 2,
  mtg: 3,
  comic: 4,
  other: 5,
};

export type PersistBatchResult = {
  batchId: string;
  sessionId: string;
  unitCount: number;
  candidateCount: number;
};

/** Write a freshly opened batch to staging. Canonical tables untouched. */
export async function persistBatch(
  result: OpenBatchResult,
  opts: { adapterId?: string; notes?: string } = {},
): Promise<PersistBatchResult> {
  const db = getDb();
  const batch = result.batch;
  const adapterId = opts.adapterId ?? "fixture-catalog";
  const policy = policyFromEnv();

  await db.execute(sql`
    INSERT INTO vault_media.capture_session
      (id, device, model_version, purpose, quality_tier, category_hint, notes,
       prov_source, prov_rule_version)
    VALUES (
      ${batch.sessionId}::uuid, ${batch.device}, ${SCAN_INGEST_RULE},
      ${batch.purpose}::vault_media.capture_purpose,
      ${batch.qualityTier}::vault_media.capture_quality_tier,
      ${batch.categoryHint ?? null}, ${batch.notes ?? null},
      ${SCAN_HOLDING_SOURCE}, ${SCAN_INGEST_RULE}
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO vault_media.scan_batch
      (id, session_id, device, status, category_hint, notes)
    VALUES (
      ${batch.id}::uuid, ${batch.sessionId}::uuid, ${batch.device},
      ${batch.status}, ${batch.categoryHint ?? null}, ${batch.notes ?? null}
    )
    ON CONFLICT (id) DO NOTHING
  `);

  const snapshotByUnit = new Map(result.rawSnapshots.map((s) => [s.unitId, s]));
  let candidateCount = 0;

  for (const unit of batch.units) {
    const snapshot = snapshotByUnit.get(unit.id);
    let snapshotId: string | null = null;

    if (snapshot) {
      // Immutable capture record (rule 3): keep the scan forever, even if the
      // identity is later rejected. Re-scanning the same bytes must reuse the
      // existing row rather than insert a second one — so read the id back
      // instead of assuming our generated UUID won.
      const existing = await db.execute(sql`
        SELECT id FROM vault_evidence.raw_snapshots
        WHERE content_hash = ${snapshot.contentHash}
        LIMIT 1
      `);
      const found = (existing.rows as Array<Record<string, unknown>>)[0];
      if (found) {
        snapshotId = String(found.id);
      } else {
        const inserted = await db.execute(sql`
          INSERT INTO vault_evidence.raw_snapshots
            (id, source, content_hash, content_type, storage_ref, byte_length,
             record_count, prov_source, prov_rule_version)
          VALUES (
            ${snapshot.id}::uuid, ${SCAN_SNAPSHOT_SOURCE}, ${snapshot.contentHash},
            ${snapshot.contentType}, ${snapshot.storageRef}, ${snapshot.byteLength},
            1, ${SCAN_HOLDING_SOURCE}, ${SCAN_INGEST_RULE}
          )
          ON CONFLICT (content_hash) DO NOTHING
          RETURNING id
        `);
        const row = (inserted.rows as Array<Record<string, unknown>>)[0];
        snapshotId = row ? String(row.id) : null;
      }
    }

    const assessment = assessCandidates(unit.candidates, {
      policy,
      duplicateAlert: unit.duplicateAlert ?? null,
    });

    await db.execute(sql`
      INSERT INTO vault_media.scan_unit
        (id, batch_id, unit_index, status, category_hint, front_storage_ref,
         front_content_hash, back_storage_ref, back_content_hash, ocr_text,
         selected_candidate_key, raw_snapshot_id, duplicate_acknowledged,
         top_confidence, confidence_band)
      VALUES (
        ${unit.id}::uuid, ${batch.id}::uuid, ${unit.unitIndex}, ${unit.status},
        ${unit.categoryHint ?? null}, ${unit.frontStorageRef}, ${unit.frontContentHash},
        ${unit.backStorageRef ?? null}, ${unit.backContentHash ?? null},
        ${unit.ocrText ?? null}, ${unit.selectedCandidateKey ?? null},
        ${snapshotId ? sql`${snapshotId}::uuid` : sql`NULL`},
        ${Boolean(unit.duplicateAlert)},
        ${assessment.topConfidence}, ${assessment.band}
      )
      ON CONFLICT (id) DO NOTHING
    `);

    for (const [rank, candidate] of unit.candidates.entries()) {
      await db.execute(sql`
        INSERT INTO vault_media.scan_unit_candidate
          (unit_id, catalog_key, asset_id, category, display_name, set_name,
           collector_number, player_or_character, release_year, external_ids,
           adapter_id, confidence, match_reasons, rank, prov_rule_version,
           prov_confidence)
        VALUES (
          ${unit.id}::uuid, ${candidate.catalogKey},
          ${candidate.assetId ? sql`${candidate.assetId}::uuid` : sql`NULL`},
          ${candidate.category}, ${candidate.displayName},
          ${candidate.setName ?? null}, ${candidate.collectorNumber ?? null},
          ${candidate.playerOrCharacter ?? null}, ${candidate.year ?? null},
          ${JSON.stringify(candidate.externalIds)}::jsonb,
          ${adapterId}, ${candidate.confidence},
          -- Build the text[] from JSON: interpolating a JS array directly makes
          -- Drizzle emit one placeholder per element, which is not a valid cast.
          ARRAY(
            SELECT jsonb_array_elements_text(${JSON.stringify(candidate.matchReasons)}::jsonb)
          ),
          ${rank},
          ${candidate.provenance.ruleOrModelVersion},
          ${candidate.provenance.confidence ?? candidate.confidence}
        )
        ON CONFLICT (unit_id, catalog_key) DO NOTHING
      `);
      candidateCount += 1;
    }
  }

  return {
    batchId: batch.id,
    sessionId: batch.sessionId,
    unitCount: batch.units.length,
    candidateCount,
  };
}

export type StagedCandidateRow = {
  catalogKey: string;
  displayName: string;
  category: string | null;
  setName: string | null;
  collectorNumber: string | null;
  confidence: number;
  matchReasons: string[];
  adapterId: string;
  assetId: string | null;
};

export type StagedUnitRow = {
  id: string;
  unitIndex: number;
  status: string;
  frontStorageRef: string;
  backStorageRef: string | null;
  selectedCandidateKey: string | null;
  holdingId: string | null;
  confirmedAssetId: string | null;
  resolutionMode: string | null;
  topConfidence: number | null;
  confidenceBand: string | null;
  duplicateAcknowledged: boolean;
  decisionAction: string | null;
  candidates: StagedCandidateRow[];
};

export type StagedBatchRow = {
  id: string;
  device: string;
  status: string;
  categoryHint: string | null;
  notes: string | null;
  createdAt: string;
  units: StagedUnitRow[];
};

/** Read staged batches back (survives API restart, unlike the in-memory store). */
export async function listStagedBatches(limit = 25): Promise<StagedBatchRow[]> {
  const db = getDb();
  const batches = await db.execute(sql`
    SELECT id, session_id, device, status, category_hint, notes, created_at
    FROM vault_media.scan_batch
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  const rows = batches.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const out = [];
  for (const b of rows) {
    const units = await db.execute(sql`
      SELECT
        u.id, u.unit_index, u.status, u.front_storage_ref, u.back_storage_ref,
        u.selected_candidate_key, u.holding_id, u.confirmed_asset_id,
        u.resolution_mode, u.resolution_rule_version, u.top_confidence,
        u.confidence_band, u.duplicate_acknowledged, u.decision_action,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'catalogKey', c.catalog_key,
              'displayName', c.display_name,
              'category', c.category,
              'setName', c.set_name,
              'collectorNumber', c.collector_number,
              'confidence', c.confidence,
              'matchReasons', c.match_reasons,
              'adapterId', c.adapter_id,
              'assetId', c.asset_id
            ) ORDER BY c.confidence DESC)
            FROM vault_media.scan_unit_candidate c
            WHERE c.unit_id = u.id
          ),
          '[]'::json
        ) AS candidates
      FROM vault_media.scan_unit u
      WHERE u.batch_id = ${b.id as string}::uuid
      ORDER BY u.unit_index
    `);

    out.push({
      id: String(b.id),
      device: String(b.device),
      status: String(b.status),
      categoryHint: (b.category_hint as string | null) ?? null,
      notes: (b.notes as string | null) ?? null,
      createdAt: new Date(String(b.created_at)).toISOString(),
      units: (units.rows as Array<Record<string, unknown>>).map((u) => ({
        id: String(u.id),
        unitIndex: Number(u.unit_index),
        status: String(u.status),
        frontStorageRef: String(u.front_storage_ref),
        backStorageRef: (u.back_storage_ref as string | null) ?? null,
        selectedCandidateKey: (u.selected_candidate_key as string | null) ?? null,
        holdingId: (u.holding_id as string | null) ?? null,
        confirmedAssetId: (u.confirmed_asset_id as string | null) ?? null,
        resolutionMode: (u.resolution_mode as string | null) ?? null,
        topConfidence: u.top_confidence == null ? null : Number(u.top_confidence),
        confidenceBand: (u.confidence_band as string | null) ?? null,
        duplicateAcknowledged: Boolean(u.duplicate_acknowledged),
        decisionAction: (u.decision_action as string | null) ?? null,
        candidates: (Array.isArray(u.candidates)
          ? (u.candidates as Array<Record<string, unknown>>)
          : []
        ).map((c) => ({
          catalogKey: String(c.catalogKey),
          displayName: String(c.displayName),
          category: (c.category as string | null) ?? null,
          setName: (c.setName as string | null) ?? null,
          collectorNumber: (c.collectorNumber as string | null) ?? null,
          confidence: Number(c.confidence),
          matchReasons: Array.isArray(c.matchReasons)
            ? (c.matchReasons as string[])
            : [],
          adapterId: String(c.adapterId ?? "unknown"),
          assetId: (c.assetId as string | null) ?? null,
        })),
      })),
    });
  }
  return out;
}

export type ResolveUnitRequest = {
  unitId: string;
  catalogKey: string;
  mode: "operator_confirmed" | "auto_high_confidence";
  quantity?: number;
  acknowledgeDuplicates?: boolean;
  assumedGrade?: string | null;
  location?: string | null;
};

export type ResolveUnitResult =
  | {
      ok: true;
      unitId: string;
      assetId: string;
      holdingId: string;
      mode: ResolveUnitRequest["mode"];
      decisionAction: "Hold" | "Sell";
      alreadyResolved: boolean;
      note: string;
    }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

/**
 * The one place staging becomes inventory.
 *
 * Resolve-or-create asset, link external ids, insert the holding, and stamp the
 * unit — all in a single transaction keyed on the unit, so a retry cannot
 * produce a second holding.
 */
export async function resolveUnit(
  req: ResolveUnitRequest,
): Promise<ResolveUnitResult> {
  const db = getDb();
  const quantity = req.quantity ?? 1;
  const assumedGrade = req.assumedGrade ?? "NM";

  const unitRes = await db.execute(sql`
    SELECT u.id, u.status, u.resolution_mode, u.confirmed_asset_id, u.holding_id,
           u.duplicate_acknowledged, u.raw_snapshot_id, u.category_hint
    FROM vault_media.scan_unit u
    WHERE u.id = ${req.unitId}::uuid
  `);
  const unit = (unitRes.rows as Array<Record<string, unknown>>)[0];
  if (!unit) {
    return { ok: false, status: 404, code: "UNIT_NOT_FOUND", error: `Unit ${req.unitId} not found` };
  }

  if (unit.resolution_mode && unit.confirmed_asset_id && unit.holding_id) {
    return {
      ok: true,
      unitId: req.unitId,
      assetId: String(unit.confirmed_asset_id),
      holdingId: String(unit.holding_id),
      mode: unit.resolution_mode as ResolveUnitRequest["mode"],
      decisionAction: "Sell",
      alreadyResolved: true,
      note: "Unit was already resolved; returning the existing holding.",
    };
  }

  const candRes = await db.execute(sql`
    SELECT catalog_key, asset_id, category, display_name, set_name,
           collector_number, release_year, external_ids, confidence
    FROM vault_media.scan_unit_candidate
    WHERE unit_id = ${req.unitId}::uuid AND catalog_key = ${req.catalogKey}
  `);
  const candidate = (candRes.rows as Array<Record<string, unknown>>)[0];
  if (!candidate) {
    return {
      ok: false,
      status: 400,
      code: "CANDIDATE_NOT_FOUND",
      error: `Candidate ${req.catalogKey} is not staged for this unit`,
    };
  }

  if (unit.duplicate_acknowledged === true && req.acknowledgeDuplicates !== true) {
    return {
      ok: false,
      status: 409,
      code: "DUPLICATE_UNACKNOWLEDGED",
      error:
        "This card already exists in inventory — set acknowledgeDuplicates to add another copy",
    };
  }

  const category = String(candidate.category ?? unit.category_hint ?? "other");
  const categoryId = CATEGORY_IDS[category] ?? CATEGORY_IDS.other!;
  const externalIds = Array.isArray(candidate.external_ids)
    ? (candidate.external_ids as Array<{ source: string; value: string }>)
    : [];

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Resolve the canonical asset: candidate hint → external id → create.
      let assetId: string | null = candidate.asset_id
        ? String(candidate.asset_id)
        : null;

      if (!assetId && externalIds.length > 0) {
        for (const ext of externalIds) {
          const hit = await tx.execute(sql`
            SELECT asset_id FROM vault_core.external_id
            WHERE source = ${ext.source} AND external_value = ${ext.value}
            LIMIT 1
          `);
          const row = (hit.rows as Array<Record<string, unknown>>)[0];
          if (row) {
            assetId = String(row.asset_id);
            break;
          }
        }
      }

      if (!assetId) {
        const created = await tx.execute(sql`
          INSERT INTO vault_core.asset
            (category_id, canonical_name, release_year)
          VALUES (
            ${categoryId}, ${String(candidate.display_name)},
            ${candidate.release_year ?? null}
          )
          RETURNING id
        `);
        assetId = String((created.rows as Array<Record<string, unknown>>)[0]!.id);
      }

      // 2. Link external ids (idempotent; never steal another asset's id).
      for (const ext of externalIds) {
        await tx.execute(sql`
          INSERT INTO vault_core.external_id (asset_id, source, external_value)
          VALUES (${assetId}::uuid, ${ext.source}, ${ext.value})
          ON CONFLICT (source, external_value) DO NOTHING
        `);
      }

      // 3. Holding. source_row_id is the unit id, so the UNIQUE (source,
      //    source_row_id) makes a repeated confirm a no-op rather than a dupe.
      const notes =
        unit.duplicate_acknowledged
          ? `Scan ID confirmed as ${candidate.display_name}; duplicate acknowledged; ${assumedGrade} assumed · unverified`
          : `Scan ID confirmed as ${candidate.display_name}; ${assumedGrade} assumed · unverified`;

      const holdingRes = await tx.execute(sql`
        INSERT INTO vault_collection.holding
          (asset_id, quantity, location, assumed_grade, slab_status,
           recommendation, needs_verification, verification_notes,
           source, source_row_id, inventory_bucket, inventory_bucket_source,
           inventory_bucket_rule, collection_pillar, sell_priority)
        VALUES (
          ${assetId}::uuid, ${quantity}, ${req.location ?? null}, ${assumedGrade},
          ${"raw"}, ${"Sell"}, ${true}, ${notes},
          ${SCAN_HOLDING_SOURCE}, ${req.unitId},
          ${"dealer_inventory"}, ${"inferred"}, ${"inventory-bucket@0.1.0"},
          ${"General Inventory"}, ${"High"}
        )
        ON CONFLICT (source, source_row_id) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          updated_at = now()
        RETURNING id
      `);
      const holdingId = String(
        (holdingRes.rows as Array<Record<string, unknown>>)[0]!.id,
      );

      // 4. Stamp the unit. The CHECK constraint refuses this row unless asset,
      //    holding, and rule version are all present together.
      await tx.execute(sql`
        UPDATE vault_media.scan_unit
        SET status = 'confirmed',
            selected_candidate_key = ${req.catalogKey},
            confirmed_asset_id = ${assetId}::uuid,
            holding_id = ${holdingId}::uuid,
            resolution_mode = ${req.mode}::vault_media.scan_resolution_mode,
            resolution_rule_version = ${SCAN_INGEST_RULE},
            resolved_at = now(),
            decision_action = 'Sell',
            updated_at = now()
        WHERE id = ${req.unitId}::uuid
      `);

      await tx.execute(sql`
        UPDATE vault_media.scan_batch b
        SET status = CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM vault_media.scan_unit u
                WHERE u.batch_id = b.id AND u.resolution_mode IS NULL
              ) THEN 'closed' ELSE 'review'
            END,
            updated_at = now()
        WHERE b.id = (
          SELECT batch_id FROM vault_media.scan_unit WHERE id = ${req.unitId}::uuid
        )
      `);

      return { assetId: assetId!, holdingId };
    });

    return {
      ok: true,
      unitId: req.unitId,
      assetId: result.assetId,
      holdingId: result.holdingId,
      mode: req.mode,
      decisionAction: "Sell",
      alreadyResolved: false,
      note: "Holding entered Dealer Inventory as Sell (churn). Condition remains NM assumed · unverified until grading capture",
    };
  } catch (e) {
    return {
      ok: false,
      status: 400,
      code: "RESOLVE_FAILED",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type ScanHoldingRow = {
  id: string;
  assetId: string;
  assetName: string;
  quantity: number;
  assumedGrade: string | null;
  needsVerification: boolean;
  verificationNotes: string | null;
  location: string | null;
  category: string | null;
  inventoryBucket: "personal_collection" | "investment_vault" | "dealer_inventory";
  recommendation: string | null;
  externalIds: Array<{ source: string; externalValue: string }>;
};

/**
 * Confirmed scan holdings, so a resolved card shows up in the collection and
 * the next scan of the same card raises a duplicate alert against it.
 */
export async function loadScanHoldings(): Promise<ScanHoldingRow[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT
      h.id, h.asset_id, h.quantity, h.assumed_grade, h.needs_verification,
      h.verification_notes, h.location, h.inventory_bucket, h.recommendation,
      a.canonical_name, a.release_year,
      c.kind AS category,
      COALESCE(
        (
          SELECT json_agg(json_build_object('source', e.source, 'externalValue', e.external_value))
          FROM vault_core.external_id e
          WHERE e.asset_id = a.id
        ),
        '[]'::json
      ) AS external_ids
    FROM vault_collection.holding h
    JOIN vault_core.asset a ON a.id = h.asset_id
    LEFT JOIN vault_core.categories c ON c.id = a.category_id
    WHERE h.source = ${SCAN_HOLDING_SOURCE}
    ORDER BY h.imported_at DESC
  `);

  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    assetId: String(row.asset_id),
    assetName: String(row.canonical_name),
    quantity: Number(row.quantity ?? 1),
    assumedGrade: (row.assumed_grade as string | null) ?? null,
    needsVerification: Boolean(row.needs_verification),
    verificationNotes: (row.verification_notes as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    inventoryBucket:
      row.inventory_bucket === "personal_collection" ||
      row.inventory_bucket === "investment_vault"
        ? row.inventory_bucket
        : "dealer_inventory",
    recommendation: (row.recommendation as string | null) ?? null,
    externalIds: Array.isArray(row.external_ids)
      ? (row.external_ids as Array<{ source: string; externalValue: string }>)
      : [],
  }));
}

/** Reject a unit: keep capture + candidates, write nothing canonical. */
export async function rejectUnit(
  unitId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  try {
    const res = await db.execute(sql`
      UPDATE vault_media.scan_unit
      SET status = 'rejected',
          resolution_mode = 'rejected'::vault_media.scan_resolution_mode,
          resolution_rule_version = ${SCAN_INGEST_RULE},
          resolved_at = now(),
          ocr_text = COALESCE(ocr_text, ''),
          updated_at = now()
      WHERE id = ${unitId}::uuid AND resolution_mode IS NULL
    `);
    if ((res.rowCount ?? 0) === 0) {
      return { ok: false, error: "Unit not found or already resolved" };
    }
    void reason;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
