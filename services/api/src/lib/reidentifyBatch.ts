import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { sql } from "drizzle-orm";
import {
  assessCandidates,
  baseVsParallelFromEvidence,
  identifyFromPairedImages,
  policyFromEnv,
  routeReview,
  thresholdsFromEnv,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";
import {
  catalogResolverEnabled,
  getCatalogResolver,
  invalidateIdentificationCache,
} from "./catalogLive.js";
import { getStagedBatch, type StagedBatchRow } from "./scanStorePg.js";

export class ReidentifyError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.status = status;
  }
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Drop cached IDs for this batch and re-run CatalogResolver against the
 * preserved master images. Confirmed units are left alone.
 */
export async function reidentifyStagedBatch(
  batchId: string,
  opts: { unitId?: string } = {},
): Promise<{
  batchId: string;
  categoryHint: string | null;
  reidentified: number;
  skippedConfirmed: number;
  skippedMissing: number;
  catalogSource: string;
  batch: StagedBatchRow;
}> {
  const existing = await getStagedBatch(batchId);
  if (!existing) {
    throw new ReidentifyError(`Scan batch ${batchId} not found`, 404);
  }
  const category = (existing.categoryHint ?? null) as
    | "sports"
    | "pokemon"
    | "mtg"
    | null;
  if (!catalogResolverEnabled(category)) {
    throw new ReidentifyError(
      `Re-identify uses the live catalog for Pokémon/Magic. This batch is "${category ?? "uncategorized"}". Set category to Pokemon TCG and import again, or keep Edit/Confirm.`,
    );
  }

  const hashes: string[] = [];
  for (const unit of existing.units) {
    const front = unit.normalizedFrontRef ?? unit.frontStorageRef;
    if (existsSync(front)) hashes.push(fileHash(front));
  }
  await invalidateIdentificationCache(hashes);

  const resolver = getCatalogResolver();
  const thresholds = thresholdsFromEnv();
  const policy = policyFromEnv();
  const db = getDb();
  let reidentified = 0;
  let skippedConfirmed = 0;
  let skippedMissing = 0;

  for (const unit of existing.units) {
    if (opts.unitId && unit.id !== opts.unitId) continue;
    if (unit.resolutionMode) {
      skippedConfirmed += 1;
      continue;
    }
    const front = unit.normalizedFrontRef ?? unit.frontStorageRef;
    const back = unit.normalizedBackRef ?? unit.backStorageRef;
    if (!existsSync(front)) {
      skippedMissing += 1;
      continue;
    }
    const frontHash = fileHash(front);
    const backHash = back && existsSync(back) ? fileHash(back) : undefined;
    const pixelId = await identifyFromPairedImages({
      frontPath: front,
      backPath: back && existsSync(back) ? back : null,
      frontHash,
      backHash,
      frontFileName: basename(front),
      backFileName: back ? basename(back) : "",
      categoryHint: category,
      resolver,
    });
    const evidence = pixelId.evidence;
    const split = baseVsParallelFromEvidence(evidence);
    const assessment = assessCandidates(pixelId.candidates, { policy });
    const route = routeReview({
      baseConfidence: split.baseConfidence,
      conflict: evidence.conflictNotes.length > 0,
      pairingNeedsReview: unit.pairingNeedsReview,
      thresholds,
    });

    await db.execute(sql`
      DELETE FROM vault_media.scan_unit_candidate WHERE unit_id = ${unit.id}::uuid
    `);
    for (const [rank, candidate] of pixelId.candidates.entries()) {
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
          ${candidate.adapterId ?? "tcgdex"}, ${candidate.confidence},
          ARRAY(
            SELECT jsonb_array_elements_text(${JSON.stringify(candidate.matchReasons)}::jsonb)
          ),
          ${rank},
          ${candidate.provenance.ruleOrModelVersion},
          ${candidate.provenance.confidence ?? candidate.confidence}
        )
      `);
    }

    const reviewStatus =
      route === "CONFLICT" || route === "LOW" || unit.pairingNeedsReview
        ? "needs_review"
        : route === "HIGH"
          ? "draft_ready"
          : "needs_confirmation";

    await db.execute(sql`
      UPDATE vault_media.scan_unit
      SET ocr_text = ${[pixelId.frontText, pixelId.backText].filter(Boolean).join("\n") || null},
          identification_status = ${split.baseDisplayName ? "inferred" : "unknown"},
          review_status = ${reviewStatus},
          review_route = ${route},
          identity_evidence = ${JSON.stringify(evidence)}::jsonb,
          base_vs_parallel = ${JSON.stringify(split)}::jsonb,
          top_confidence = ${assessment.topConfidence},
          confidence_band = ${assessment.band},
          status = ${pixelId.candidates.length > 0 ? "identified" : "needs_review"},
          updated_at = now()
      WHERE id = ${unit.id}::uuid
    `);
    reidentified += 1;
  }

  const batch = await getStagedBatch(batchId);
  if (!batch) {
    throw new ReidentifyError(`Scan batch ${batchId} disappeared`, 404);
  }
  return {
    batchId,
    categoryHint: category,
    reidentified,
    skippedConfirmed,
    skippedMissing,
    catalogSource: "tcgdex",
    batch,
  };
}
