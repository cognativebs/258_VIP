import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  CARD_SCAN_RULE,
  DEFAULT_SCAN_SOURCE,
  DEFAULT_SCANNER_PROFILE,
  ScanBatchTelemetrySchema,
  type CardScanObject,
  type ScanBatchTelemetry,
} from "@vip/core-model";
import {
  FolderWatchAdapter,
  baseVsParallelFromEvidence,
  identifyFromPairedImages,
  isPhysicalReimport,
  ocrImageFile,
  pairPagesForReview,
  policyFromEnv,
  readImageMeta,
  routeReview,
  thresholdsFromEnv,
  type DevicePage,
  type IdentityCandidate,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";
import type { ApiHolding } from "./holdings.js";
import { importFolderPages, resolveScanFolder } from "./scanFolder.js";
import { catalogResolverEnabled, getCatalogResolver } from "./catalogLive.js";
import { inventoryLookupFromHoldings, openScanFromApi } from "./scanIngest.js";
import { persistBatch, resolveUnit } from "./scanStorePg.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export function scanMasterDir(): string {
  return process.env.VIP_SCAN_MASTER_DIR?.trim()
    ? process.env.VIP_SCAN_MASTER_DIR.trim()
    : join(REPO_ROOT, "data", "scan-masters");
}

/** @deprecated prefer scanMasterDir() so tests can override VIP_SCAN_MASTER_DIR */
export const SCAN_MASTER_DIR = scanMasterDir();

export const RICOH_FIXTURE_DIR = join(REPO_ROOT, "data", "scan-inbox", "ricoh-v1-fixture");

export class RicohIntakeError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.status = status;
  }
}

function masterDir(batchId: string): string {
  return join(scanMasterDir(), batchId);
}

function sidecarSync(imagePath: string): string {
  const sidecar = imagePath.replace(/\.[^.]+$/, ".txt");
  try {
    return readFileSync(sidecar, "utf8").trim();
  } catch {
    return "";
  }
}

function preserveMaster(
  batchId: string,
  srcPath: string,
  originalName: string,
): { dest: string; bytes: Buffer; hash: string; meta: ReturnType<typeof readImageMeta> } {
  const bytes = readFileSync(srcPath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const destDir = masterDir(batchId);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `${hash.slice(0, 16)}_${basename(originalName)}`);
  copyFileSync(srcPath, dest);
  return { dest, bytes, hash, meta: readImageMeta(bytes) };
}

async function knownFrontHashes(excludeBatchId: string): Promise<Set<string>> {
  try {
    const db = getDb();
    const res = await db.execute(sql`
      SELECT front_content_hash FROM vault_media.scan_unit
      WHERE batch_id <> ${excludeBatchId}::uuid
    `);
    return new Set(
      (res.rows as Array<{ front_content_hash: string }>).map((r) => r.front_content_hash),
    );
  } catch {
    return new Set();
  }
}

export type RicohIntakeRequest = {
  folder?: string | null;
  categoryHint?: "sports" | "pokemon" | "mtg" | null;
  notes?: string;
  source?: string;
  scannerProfile?: string;
  pairing?:
    | "sequential_duplex"
    | "sequential_duplex_back_first"
    | "filename_front_back"
    | "auto";
  holdings?: ApiHolding[];
};

export type RicohIntakeResult = {
  folder: string;
  batchId: string;
  source: string;
  scannerProfile: string;
  imageCount: number;
  expectedCardCount: number;
  pairingMethod:
    | "sequential_duplex"
    | "sequential_duplex_back_first"
    | "filename_front_back"
    | "auto";
  processingStatus: string;
  errorsWarnings: string[];
  telemetry: ScanBatchTelemetry;
  cards: CardScanObject[];
  staged: { batchId: string; unitCount: number; candidateCount: number };
};

export async function ingestRicohBatch(
  req: RicohIntakeRequest,
): Promise<RicohIntakeResult> {
  const t0 = Date.now();
  const source = req.source?.trim() || DEFAULT_SCAN_SOURCE;
  const scannerProfile = req.scannerProfile?.trim() || DEFAULT_SCANNER_PROFILE;
  const imported = await importFolderPages({
    folder: req.folder ?? null,
    categoryHint: req.categoryHint ?? "sports",
    pairing:
      req.pairing === "filename_front_back" ? "filename_front_back" : "sequential_duplex",
    notes: req.notes,
    maxFiles: 200,
  });
  if (!imported.ok) {
    throw new RicohIntakeError(imported.error, imported.status);
  }

  for (const page of imported.pages) {
    const ocr = await ocrImageFile(page.storageRef, page.contentHash);
    page.ocrText = [page.ocrText, ocr.text].filter(Boolean).join("\n").trim() || null;
  }

  const adapter = new FolderWatchAdapter({
    rootLabel: imported.folder,
    pairing: "sequential_duplex",
    categoryHint: req.categoryHint ?? "sports",
  });
  const pages: DevicePage[] = adapter
    .ingestDescriptors(
      imported.pages.map((p) => ({
        fileName: p.fileName,
        storageRef: p.storageRef,
        contentHash: p.contentHash,
        mimeType: p.mimeType,
        ocrText: p.ocrText,
      })),
    )
    .map((p, i) => ({ ...p, sequence: imported.pages[i]?.sequence ?? i }));

  const pairing = pairPagesForReview(pages, {
    strategy: req.pairing ?? "auto",
    categoryHint: req.categoryHint ?? "sports",
  });

  const categoryHint = req.categoryHint ?? "sports";
  const opened = await openScanFromApi({
    device: source,
    categoryHint,
    notes: req.notes ?? `Ricoh intake · profile ${scannerProfile}`,
    units: pairing.units.map((u, i) => ({
      ...u,
      unitIndex: i,
    })),
    inventory: inventoryLookupFromHoldings(req.holdings ?? []),
    skipResolver: catalogResolverEnabled(categoryHint),
  });

  const staged = await persistBatch(opened, {
    adapterId: "ricoh-intake-v1",
    notes: req.notes,
  });
  const batchId = staged.batchId;
  const known = await knownFrontHashes(batchId);
  const thresholds = thresholdsFromEnv();
  const policy = policyFromEnv();
  const warnings = [...pairing.warnings];
  const cards: CardScanObject[] = [];
  let identified = 0;
  let visionCostUsd = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let conflicts = 0;
  let dups = 0;
  let failures = 0;

  const db = getDb();

  for (const [i, unit] of opened.batch.units.entries()) {
    try {
      const frontSrc = unit.frontStorageRef;
      const backSrc = unit.backStorageRef;
      const frontMaster = preserveMaster(batchId, frontSrc, basename(frontSrc));
      const backMaster = backSrc
        ? preserveMaster(batchId, backSrc, basename(backSrc))
        : null;
      const transforms = [
        "master_copied_unmodified",
        "normalized_is_master_copy",
        "no_pixel_resample",
        "no_contrast_enhance",
        "no_saturation_enhance",
        "no_sharpen",
        "no_foil_enhance",
        `orientation_recorded:${frontMaster.meta.orientation}`,
      ];
      // Per-side text only. unit.ocrText joins front+back in openScanBatch —
      // feeding that into one side would silently merge contradictory evidence.
      const pixelId = await identifyFromPairedImages({
        frontPath: frontMaster.dest,
        backPath: backMaster?.dest ?? null,
        frontHash: frontMaster.hash,
        backHash: backMaster?.hash,
        sidecarFront: sidecarSync(frontSrc),
        sidecarBack: backSrc ? sidecarSync(backSrc) : "",
        frontFileName: basename(frontSrc),
        backFileName: backSrc ? basename(backSrc) : "",
        categoryHint,
        resolver: catalogResolverEnabled(categoryHint)
          ? getCatalogResolver()
          : undefined,
      });
      const evidence = pixelId.evidence;
      visionCostUsd += pixelId.estimatedCostUsd;
      if (pixelId.notes.length) {
        warnings.push(...pixelId.notes.map((n) => `unit ${unit.unitIndex}: ${n}`));
      }
      const top = pixelId.candidates[0] ?? unit.candidates[0];
      await upsertPixelCandidates(unit.id, pixelId.candidates);
      // Catalog may fill a missing field, never break a recorded conflict.
      if (
        top?.playerOrCharacter &&
        !evidence.fused.playerOrCharacter.value &&
        evidence.conflictNotes.length === 0
      ) {
        evidence.fused.playerOrCharacter = {
          value: top.playerOrCharacter,
          confidence: top.confidence,
          origin: "catalog",
        };
      }
      const baseVs = baseVsParallelFromEvidence(evidence);
      const pairingNeedsReview = pairing.needsReview[i] ?? false;
      const route = routeReview({
        baseConfidence: baseVs.baseConfidence,
        conflict: evidence.conflictNotes.length > 0,
        pairingNeedsReview,
        thresholds,
      });
      const physical = isPhysicalReimport(unit.frontContentHash, known);
      if (physical) dups += 1;
      if (unit.duplicateAlert) dups += 1;
      if (baseVs.baseDisplayName) identified += 1;
      if (route === "HIGH") high += 1;
      else if (route === "MEDIUM") medium += 1;
      else if (route === "CONFLICT") conflicts += 1;
      else low += 1;

      const frontImageId = await insertCaptureImage({
        sessionId: opened.batch.sessionId,
        hash: frontMaster.hash,
        ref: frontMaster.dest,
        face: "front",
        filename: basename(frontSrc),
        meta: frontMaster.meta,
        byteLength: frontMaster.bytes.length,
        unitIndex: unit.unitIndex,
        transforms,
        source,
      });
      const backImageId = backMaster
        ? await insertCaptureImage({
            sessionId: opened.batch.sessionId,
            hash: backMaster.hash,
            ref: backMaster.dest,
            face: "back",
            filename: basename(backSrc!),
            meta: backMaster.meta,
            byteLength: backMaster.bytes.length,
            unitIndex: unit.unitIndex,
            transforms,
            source,
          })
        : null;

      const reviewStatus =
        route === "CONFLICT" || route === "LOW" || pairingNeedsReview
          ? "needs_review"
          : physical || unit.duplicateAlert
            ? "needs_confirmation"
            : route === "HIGH"
              ? "draft_ready"
              : "needs_confirmation";

      await db.execute(sql`
        UPDATE vault_media.scan_unit
        SET front_image_id = ${frontImageId}::uuid,
            back_image_id = ${backImageId},
            normalized_front_ref = ${frontMaster.dest},
            normalized_back_ref = ${backMaster?.dest ?? null},
            pairing_method = ${pairing.method},
            pairing_confidence = ${pairing.pairingConfidence[i] ?? 0},
            pairing_needs_review = ${pairingNeedsReview},
            orientation = ${frontMaster.meta.orientation},
            identification_status = ${baseVs.baseDisplayName ? "inferred" : "unknown"},
            review_status = ${reviewStatus},
            review_route = ${route},
            identity_evidence = ${JSON.stringify(evidence)}::jsonb,
            base_vs_parallel = ${JSON.stringify(baseVs)}::jsonb,
            physical_reimport = ${physical},
            transformations = ${JSON.stringify(transforms)}::jsonb,
            updated_at = now()
        WHERE id = ${unit.id}::uuid
      `);

      if (
        policy.autoResolveEnabled &&
        route === "HIGH" &&
        top &&
        !unit.duplicateAlert &&
        !physical
      ) {
        await resolveUnit({
          unitId: unit.id,
          catalogKey: top.catalogKey,
          mode: "auto_high_confidence",
          acknowledgeDuplicates: false,
        });
      }

      known.add(unit.frontContentHash);

      cards.push({
        cardScanId: unit.id,
        batchId,
        frontImageId,
        backImageId,
        originalFrontRef: frontMaster.dest,
        originalBackRef: backMaster?.dest ?? null,
        normalizedFrontRef: frontMaster.dest,
        normalizedBackRef: backMaster?.dest ?? null,
        source,
        pairingMethod: pairing.method,
        pairingConfidence: pairing.pairingConfidence[i] ?? 0,
        pairingNeedsReview,
        orientation: frontMaster.meta.orientation,
        processingStatus: "processed",
        identificationStatus: baseVs.baseDisplayName ? "inferred" : "unknown",
        reviewStatus,
        reviewRoute: route,
        evidence,
        baseVsParallel: baseVs,
        physicalReimport: physical,
        identityDuplicate: Boolean(unit.duplicateAlert),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      failures += 1;
      warnings.push(
        `unit ${unit.unitIndex}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const totalMs = Date.now() - t0;
  const telemetry = ScanBatchTelemetrySchema.parse({
    imagesReceived: imported.fileCount,
    cardsPaired: pairing.units.filter((u) => u.back).length,
    pairingFailures: pairing.needsReview.filter(Boolean).length + pairing.orphans.length,
    cardsIdentified: identified,
    high,
    medium,
    low,
    needsReview: cards.filter((c) => c.reviewStatus === "needs_review").length,
    conflicts,
    duplicateWarnings: dups,
    processingFailures: failures,
    avgMsPerCard: opened.batch.units.length ? totalMs / opened.batch.units.length : 0,
    totalMs,
    estimatedCostUsd: Number(visionCostUsd.toFixed(6)),
  });

  await db.execute(sql`
    UPDATE vault_media.scan_batch
    SET source = ${source},
        scanner_profile = ${scannerProfile},
        image_count = ${imported.fileCount},
        expected_card_count = ${pairing.units.length},
        processing_status = ${"review"},
        errors_warnings = ${JSON.stringify(warnings)}::jsonb,
        telemetry = ${JSON.stringify(telemetry)}::jsonb,
        status = 'review',
        updated_at = now()
    WHERE id = ${batchId}::uuid
  `);

  return {
    folder: imported.folder,
    batchId,
    source,
    scannerProfile,
    imageCount: imported.fileCount,
    expectedCardCount: pairing.units.length,
    pairingMethod: pairing.method,
    processingStatus: "review",
    errorsWarnings: warnings,
    telemetry,
    cards,
    staged: {
      batchId,
      unitCount: opened.batch.units.length,
      candidateCount: staged.candidateCount,
    },
  };
}

export type SwapFacesResult = {
  batchId: string;
  swapped: number;
  skipped: number;
  pairingMethod: "sequential_duplex" | "sequential_duplex_back_first";
  note: string;
};

/**
 * Operator-asserted front/back swap on staged (unconfirmed) units.
 * Re-fuses per-side evidence. Does not invent a missing side.
 */
export async function swapStagedFaces(opts: {
  batchId?: string;
  unitId?: string;
}): Promise<SwapFacesResult> {
  const db = getDb();
  let batchId = opts.batchId?.trim() ?? "";
  if (!batchId && opts.unitId) {
    const found = await db.execute(sql`
      SELECT batch_id::text AS batch_id FROM vault_media.scan_unit
      WHERE id = ${opts.unitId}::uuid
    `);
    batchId = String((found.rows as Array<{ batch_id: string }>)[0]?.batch_id ?? "");
  }
  if (!batchId) {
    throw new RicohIntakeError("batchId or unitId required", 400);
  }

  const units = await db.execute(sql`
    SELECT id, unit_index, resolution_mode, pairing_method, transformations,
           front_storage_ref, back_storage_ref,
           front_content_hash, back_content_hash,
           front_image_id, back_image_id,
           normalized_front_ref, normalized_back_ref
    FROM vault_media.scan_unit
    WHERE batch_id = ${batchId}::uuid
      ${opts.unitId ? sql`AND id = ${opts.unitId}::uuid` : sql``}
    ORDER BY unit_index
  `);

  const rows = units.rows as Array<{
    id: string;
    unit_index: number;
    resolution_mode: string | null;
    pairing_method: string | null;
    transformations: unknown;
    front_storage_ref: string;
    back_storage_ref: string | null;
    front_content_hash: string;
    back_content_hash: string | null;
    front_image_id: string | null;
    back_image_id: string | null;
    normalized_front_ref: string | null;
    normalized_back_ref: string | null;
  }>;
  if (opts.unitId && rows.length === 0) {
    throw new RicohIntakeError("Scan unit not found", 404);
  }

  const known = await knownFrontHashes(batchId);
  const thresholds = thresholdsFromEnv();
  let swapped = 0;
  let skipped = 0;
  let nextMethod: "sequential_duplex" | "sequential_duplex_back_first" =
    "sequential_duplex_back_first";

  for (const row of rows) {
    if (row.resolution_mode || !row.back_storage_ref || !row.back_content_hash) {
      skipped += 1;
      continue;
    }
    nextMethod =
      row.pairing_method === "sequential_duplex_back_first"
        ? "sequential_duplex"
        : "sequential_duplex_back_first";

    const newFrontRef = row.back_storage_ref;
    const newBackRef = row.front_storage_ref;
    const newFrontHash = row.back_content_hash;
    const newBackHash = row.front_content_hash;
    const newFrontMaster = row.normalized_back_ref ?? newFrontRef;
    const newBackMaster = row.normalized_front_ref ?? newBackRef;
    const pixelId = await identifyFromPairedImages({
      frontPath: newFrontMaster,
      backPath: newBackMaster,
      frontHash: newFrontHash,
      backHash: newBackHash,
      sidecarFront: sidecarSync(newFrontRef),
      sidecarBack: sidecarSync(newBackRef),
      frontFileName: basename(newFrontRef),
      backFileName: basename(newBackRef),
      categoryHint: "sports",
    });
    const evidence = pixelId.evidence;
    const baseVs = baseVsParallelFromEvidence(evidence);
    const route = routeReview({
      baseConfidence: baseVs.baseConfidence,
      conflict: evidence.conflictNotes.length > 0,
      pairingNeedsReview: false,
      thresholds,
    });
    const physical = isPhysicalReimport(newFrontHash, known);
    const reviewStatus =
      route === "CONFLICT" || route === "LOW"
        ? "needs_review"
        : physical
          ? "needs_confirmation"
          : route === "HIGH"
            ? "draft_ready"
            : "needs_confirmation";
    const prev = Array.isArray(row.transformations) ? row.transformations : [];
    const transforms = [
      ...prev.filter((t) => typeof t === "string"),
      "operator_swapped_faces",
      `pairing_method:${nextMethod}`,
    ];

    await upsertPixelCandidates(row.id, pixelId.candidates);

    await db.execute(sql`
      UPDATE vault_media.scan_unit
      SET front_storage_ref = ${newFrontRef},
          back_storage_ref = ${newBackRef},
          front_content_hash = ${newFrontHash},
          back_content_hash = ${newBackHash},
          front_image_id = ${row.back_image_id},
          back_image_id = ${row.front_image_id},
          normalized_front_ref = ${row.normalized_back_ref},
          normalized_back_ref = ${row.normalized_front_ref},
          pairing_method = ${nextMethod},
          pairing_confidence = ${0.85},
          pairing_needs_review = ${false},
          identification_status = ${baseVs.baseDisplayName ? "inferred" : "unknown"},
          review_status = ${reviewStatus},
          review_route = ${route},
          identity_evidence = ${JSON.stringify(evidence)}::jsonb,
          base_vs_parallel = ${JSON.stringify(baseVs)}::jsonb,
          physical_reimport = ${physical},
          transformations = ${JSON.stringify(transforms)}::jsonb,
          updated_at = now()
      WHERE id = ${row.id}::uuid
        AND resolution_mode IS NULL
    `);

    if (row.front_image_id) {
      await db.execute(sql`
        UPDATE vault_media.capture_image
        SET face = ${"back"}::vault_media.capture_face, updated_at = now()
        WHERE id = ${row.front_image_id}::uuid
      `);
    }
    if (row.back_image_id) {
      await db.execute(sql`
        UPDATE vault_media.capture_image
        SET face = ${"front"}::vault_media.capture_face, updated_at = now()
        WHERE id = ${row.back_image_id}::uuid
      `);
    }
    known.add(newFrontHash);
    swapped += 1;
  }

  const warn = await db.execute(sql`
    SELECT errors_warnings FROM vault_media.scan_batch WHERE id = ${batchId}::uuid
  `);
  const existing = (warn.rows as Array<{ errors_warnings: unknown }>)[0]
    ?.errors_warnings;
  const warnings = Array.isArray(existing) ? existing.filter((w) => typeof w === "string") : [];
  warnings.push(
    swapped
      ? `operator swapped front/back on ${swapped} card(s) → ${nextMethod}`
      : "no unconfirmed duplex cards to swap",
  );
  await db.execute(sql`
    UPDATE vault_media.scan_batch
    SET errors_warnings = ${JSON.stringify(warnings)}::jsonb,
        updated_at = now()
    WHERE id = ${batchId}::uuid
  `);

  return {
    batchId,
    swapped,
    skipped,
    pairingMethod: nextMethod,
    note:
      swapped === 0
        ? "Nothing swapped. Confirmed cards stay as they were; singles have no back to swap."
        : `Swapped front/back on ${swapped} staged card(s). Re-check identity before confirm.`,
  };
}

async function upsertPixelCandidates(
  unitId: string,
  candidates: IdentityCandidate[],
): Promise<void> {
  const db = getDb();
  for (const [rank, candidate] of candidates.entries()) {
    await db.execute(sql`
      INSERT INTO vault_media.scan_unit_candidate
        (unit_id, catalog_key, asset_id, category, display_name, set_name,
         collector_number, player_or_character, release_year, external_ids,
         adapter_id, confidence, match_reasons, rank, prov_rule_version,
         prov_confidence)
      VALUES (
        ${unitId}::uuid, ${candidate.catalogKey},
        ${candidate.assetId ? sql`${candidate.assetId}::uuid` : sql`NULL`},
        ${candidate.category}, ${candidate.displayName},
        ${candidate.setName ?? null}, ${candidate.collectorNumber ?? null},
        ${candidate.playerOrCharacter ?? null}, ${candidate.year ?? null},
        ${JSON.stringify(candidate.externalIds)}::jsonb,
        ${candidate.adapterId ?? "pixel-ocr-v1"}, ${candidate.confidence},
        ARRAY(
          SELECT jsonb_array_elements_text(${JSON.stringify(candidate.matchReasons)}::jsonb)
        ),
        ${rank},
        ${candidate.provenance.ruleOrModelVersion},
        ${candidate.provenance.confidence ?? candidate.confidence}
      )
      ON CONFLICT (unit_id, catalog_key) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        display_name = EXCLUDED.display_name,
        set_name = EXCLUDED.set_name,
        collector_number = EXCLUDED.collector_number,
        player_or_character = EXCLUDED.player_or_character,
        release_year = EXCLUDED.release_year,
        adapter_id = EXCLUDED.adapter_id,
        rank = EXCLUDED.rank
    `);
  }
}

async function insertCaptureImage(input: {
  sessionId: string;
  hash: string;
  ref: string;
  face: "front" | "back";
  filename: string;
  meta: ReturnType<typeof readImageMeta>;
  byteLength: number;
  unitIndex: number;
  transforms: string[];
  source: string;
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const res = await db.execute(sql`
    INSERT INTO vault_media.capture_image
      (id, session_id, content_hash, storage_ref, preprocessing_steps, face,
       quality_tier, unit_index, mime_type, byte_length, original_filename,
       width_px, height_px, image_role, transformations,
       prov_source, prov_rule_version)
    VALUES (
      ${id}::uuid, ${input.sessionId}::uuid, ${input.hash}, ${input.ref},
      ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.transforms)}::jsonb)),
      ${input.face}::vault_media.capture_face, ${"intake"}::vault_media.capture_quality_tier,
      ${input.unitIndex}, ${input.meta.format === "png" ? "image/png" : "image/jpeg"},
      ${input.byteLength}, ${input.filename}, ${input.meta.width}, ${input.meta.height},
      ${"master"}, ${JSON.stringify(input.transforms)}::jsonb,
      ${input.source}, ${CARD_SCAN_RULE}
    )
    ON CONFLICT (content_hash) DO UPDATE SET
      storage_ref = EXCLUDED.storage_ref,
      original_filename = EXCLUDED.original_filename,
      updated_at = now()
    RETURNING id
  `);
  return String((res.rows as Array<{ id: string }>)[0]?.id ?? id);
}

export type AcceptanceCard = {
  originalFrontRef: string;
  pairingNeedsReview: boolean;
  pairingConfidence: number;
  reviewRoute: string;
  reviewStatus: string;
  physicalReimport: boolean;
  baseVsParallel: {
    baseDisplayName: string | null;
    parallelDisplayName: string | null;
    baseConfidence: number;
    parallelConfidence: number;
  };
};

export function acceptanceRows(cards: AcceptanceCard[]) {
  return cards.map((c) => ({
    card: c.baseVsParallel.baseDisplayName ?? basename(c.originalFrontRef),
    pairing: c.pairingNeedsReview
      ? `review (${c.pairingConfidence.toFixed(2)})`
      : `ok (${c.pairingConfidence.toFixed(2)})`,
    baseIdentity: c.baseVsParallel.baseDisplayName ?? "unknown",
    parallel: c.baseVsParallel.parallelDisplayName ?? "unknown",
    confidence: `base ${c.baseVsParallel.baseConfidence.toFixed(2)} / parallel ${c.baseVsParallel.parallelConfidence.toFixed(2)}`,
    reviewStatus: `${c.reviewRoute} · ${c.reviewStatus}`,
    inventoryCandidate: c.physicalReimport
      ? "physical reimport — do not auto-add"
      : c.reviewStatus === "draft_ready"
        ? "draft staged"
        : "awaiting confirm",
  }));
}

export async function loadBatchTelemetry(batchId: string): Promise<ScanBatchTelemetry | null> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT telemetry FROM vault_media.scan_batch WHERE id = ${batchId}::uuid
  `);
  const row = (res.rows as Array<{ telemetry: unknown }>)[0];
  if (!row?.telemetry) return null;
  return ScanBatchTelemetrySchema.parse(row.telemetry);
}

function uploadInbox(): string {
  const inbox = process.env.VIP_SCAN_INBOX?.trim()
    ? process.env.VIP_SCAN_INBOX.trim()
    : join(REPO_ROOT, "data", "scan-inbox");
  return join(inbox, "uploads");
}

function safeUploadName(fileName: string): string {
  return basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function startUploadSession(): { sessionId: string; folder: string } {
  const sessionId = randomUUID();
  const folder = join(uploadInbox(), sessionId);
  mkdirSync(folder, { recursive: true });
  return { sessionId, folder };
}

export function writeUploadFile(
  sessionId: string,
  fileName: string,
  contentBase64: string,
): { fileName: string; bytes: number } {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new RicohIntakeError("invalid upload session");
  }
  const folder = join(uploadInbox(), sessionId);
  if (!existsSync(folder)) {
    throw new RicohIntakeError("upload session not found", 404);
  }
  const safe = safeUploadName(fileName);
  if (!safe) throw new RicohIntakeError("fileName required");
  const buf = Buffer.from(contentBase64, "base64");
  writeFileSync(join(folder, safe), buf);
  return { fileName: safe, bytes: buf.length };
}

export async function finishUploadSession(
  sessionId: string,
  req: Omit<RicohIntakeRequest, "folder">,
): Promise<RicohIntakeResult> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new RicohIntakeError("invalid upload session");
  }
  const folder = join(uploadInbox(), sessionId);
  if (!existsSync(folder)) {
    throw new RicohIntakeError("upload session not found", 404);
  }
  return ingestRicohBatch({ ...req, folder });
}

export async function ingestUploadedFiles(
  files: Array<{ fileName: string; contentBase64: string }>,
  req: Omit<RicohIntakeRequest, "folder">,
): Promise<RicohIntakeResult> {
  if (!files.length) {
    throw new RicohIntakeError("body.files required");
  }
  const started = startUploadSession();
  for (const file of files) {
    writeUploadFile(started.sessionId, file.fileName, file.contentBase64);
  }
  return finishUploadSession(started.sessionId, req);
}

export { resolveScanFolder };
