import { createHash, randomUUID } from "node:crypto";
import { markInferred, markObserved } from "@vip/evidence";
import {
  RICOH_FI8170_DEVICE,
  SCAN_HOLDING_SOURCE,
  SCAN_INGEST_RULE,
  SCAN_SNAPSHOT_SOURCE,
} from "./constants.js";
import { findDuplicates } from "./duplicates.js";
import {
  buildEbayListingDraft,
  ebayCredsFromEnv,
  type EbayListingCredentials,
} from "./ebay-listing.js";
import { identifyUnit } from "./identify.js";
import type {
  CatalogCard,
  ConfirmUnitRequest,
  EbayListingDraft,
  InventoryCommit,
  InventoryLookupRow,
  ScanBatch,
  ScanBatchInput,
  ScanUnit,
} from "./schemas.js";
import {
  ConfirmUnitRequestSchema,
  ScanBatchInputSchema,
  ScanBatchSchema,
} from "./schemas.js";
import { ScanSessionStore } from "./store.js";

export type OpenBatchResult = {
  batch: ScanBatch;
  /** One immutable snapshot descriptor per unit (front[+back] hashes). */
  rawSnapshots: Array<{
    id: string;
    source: string;
    contentHash: string;
    contentType: string;
    storageRef: string;
    byteLength: number;
    unitId: string;
  }>;
};

export type ConfirmUnitResult =
  | {
      ok: true;
      batch: ScanBatch;
      unit: ScanUnit;
      commit: InventoryCommit;
      ebayDraft: EbayListingDraft | null;
      decisionAction: "Hold";
    }
  | {
      ok: false;
      code: "UNIT_NOT_FOUND" | "CANDIDATE_NOT_FOUND" | "DUPLICATE_UNACKNOWLEDGED";
      message: string;
      duplicateAlert?: ScanUnit["duplicateAlert"];
    };

export type PipelineDeps = {
  store?: ScanSessionStore;
  catalog?: CatalogCard[];
  inventory?: InventoryLookupRow[];
  ebayCreds?: EbayListingCredentials;
  now?: () => Date;
};

/**
 * Scan → ID candidates → duplicate alert → verified inventory commit
 * → optional eBay listing draft (idle without tokens).
 *
 * Ends in a decision action: Hold (entered inventory) for the MVP path.
 * Sell/listing remains a draft until tokens + human price decision.
 */
export function openScanBatch(
  input: ScanBatchInput,
  deps: PipelineDeps = {},
): OpenBatchResult {
  const parsed = ScanBatchInputSchema.parse(input);
  const store = deps.store ?? new ScanSessionStore();
  const now = deps.now?.() ?? new Date();
  const batchId = randomUUID();
  const sessionId = randomUUID();

  const rawSnapshots: OpenBatchResult["rawSnapshots"] = [];
  const units: ScanUnit[] = parsed.units.map((unitIn) => {
    const unitId = randomUUID();
    const ocrText =
      [unitIn.front.ocrText, unitIn.back?.ocrText].filter(Boolean).join("\n") ||
      null;

    const snapshotId = randomUUID();
    const combinedHash = createHash("sha256")
      .update(unitIn.front.contentHash)
      .update(unitIn.back?.contentHash ?? "")
      .digest("hex");

    rawSnapshots.push({
      id: snapshotId,
      source: SCAN_SNAPSHOT_SOURCE,
      contentHash: combinedHash,
      contentType: "application/vip.scan-unit+json",
      storageRef: unitIn.front.storageRef,
      byteLength:
        (unitIn.front.byteLength ?? 0) + (unitIn.back?.byteLength ?? 0),
      unitId,
    });

    const base: ScanUnit = {
      id: unitId,
      batchId,
      unitIndex: unitIn.unitIndex,
      status: "captured",
      categoryHint: unitIn.categoryHint ?? parsed.categoryHint ?? null,
      frontStorageRef: unitIn.front.storageRef,
      frontContentHash: unitIn.front.contentHash,
      backStorageRef: unitIn.back?.storageRef ?? null,
      backContentHash: unitIn.back?.contentHash ?? null,
      ocrText,
      candidates: [],
      selectedCandidateKey: null,
      duplicateAlert: null,
      holdingId: null,
      rawSnapshotId: snapshotId,
      idObservationId: null,
      ebayListingDraftId: null,
      decisionAction: null,
      provenance: markObserved({
        source: SCAN_HOLDING_SOURCE,
        ruleOrModelVersion: SCAN_INGEST_RULE,
        confidence: 1,
        notes: `Captured on ${parsed.device} · intake quality (museum capture later)`,
      }),
      createdAt: now,
      updatedAt: now,
    };

    const candidates = identifyUnit(base, {
      catalog: deps.catalog,
      categoryHint: base.categoryHint,
    });
    base.candidates = candidates;
    base.status = candidates.length > 0 ? "identified" : "needs_review";

    if (candidates.length > 0 && deps.inventory) {
      const alert = findDuplicates(unitId, candidates, deps.inventory);
      if (alert) {
        base.duplicateAlert = alert;
        base.status = "duplicate_alert";
      }
    }

    base.updatedAt = now;
    return base;
  });

  const batch: ScanBatch = ScanBatchSchema.parse({
    id: batchId,
    sessionId,
    device: parsed.device || RICOH_FI8170_DEVICE,
    purpose: parsed.purpose,
    qualityTier: parsed.qualityTier,
    categoryHint: parsed.categoryHint ?? null,
    tenantId: parsed.tenantId ?? null,
    notes: parsed.notes,
    status: units.some((u) => u.status === "needs_review" || u.status === "duplicate_alert")
      ? "review"
      : "open",
    units,
    provenance: markObserved({
      source: SCAN_HOLDING_SOURCE,
      ruleOrModelVersion: SCAN_INGEST_RULE,
      confidence: 1,
      notes: parsed.notes ?? "Ricoh fi-8170 intake batch",
    }),
    createdAt: now,
    updatedAt: now,
  });

  store.putBatch(batch);
  return { batch, rawSnapshots };
}

/**
 * Re-run duplicate detection after inventory changes or candidate selection.
 */
export function refreshDuplicateAlerts(
  batchId: string,
  inventory: InventoryLookupRow[],
  deps: PipelineDeps = {},
): ScanBatch {
  const store = deps.store;
  if (!store) throw new Error("refreshDuplicateAlerts requires deps.store");
  const now = deps.now?.() ?? new Date();

  return store.updateBatch(batchId, (batch) => ({
    ...batch,
    updatedAt: now,
    units: batch.units.map((unit) => {
      if (unit.status === "confirmed" || unit.status === "rejected") return unit;
      const alert = findDuplicates(unit.id, unit.candidates, inventory);
      if (!alert) {
        return {
          ...unit,
          duplicateAlert: null,
          status: unit.candidates.length > 0 ? "identified" : "needs_review",
          updatedAt: now,
        };
      }
      return {
        ...unit,
        duplicateAlert: alert,
        status: "duplicate_alert",
        updatedAt: now,
      };
    }),
    status: "review",
  }));
}

export function confirmScanUnit(
  request: ConfirmUnitRequest,
  deps: PipelineDeps = {},
): ConfirmUnitResult {
  const parsed = ConfirmUnitRequestSchema.parse(request);
  const store = deps.store;
  if (!store) {
    return {
      ok: false,
      code: "UNIT_NOT_FOUND",
      message: "confirmScanUnit requires deps.store",
    };
  }

  const found = store.findUnit(parsed.unitId);
  if (!found) {
    return { ok: false, code: "UNIT_NOT_FOUND", message: `Unit ${parsed.unitId} not found` };
  }

  const unit = found.batch.units[found.unitIndex]!;
  if (unit.status === "confirmed") {
    // Idempotent re-confirm: return existing commit shape.
    const candidate =
      unit.candidates.find((c) => c.catalogKey === unit.selectedCandidateKey) ??
      unit.candidates[0];
    if (!candidate || !unit.holdingId || !unit.rawSnapshotId) {
      return {
        ok: false,
        code: "CANDIDATE_NOT_FOUND",
        message: "Confirmed unit missing candidate/holding",
      };
    }
    return {
      ok: true,
      batch: found.batch,
      unit,
      commit: commitFromUnit(unit, candidate, parsed),
      ebayDraft: unit.ebayListingDraftId
        ? store.getDraft(unit.ebayListingDraftId) ?? null
        : null,
      decisionAction: "Hold",
    };
  }

  let candidate = unit.candidates.find(
    (c) => c.catalogKey === parsed.selectedCandidateKey,
  );

  // Allow operator to force a catalog key not in candidates (manual ID).
  if (!candidate) {
    candidate = {
      catalogKey: parsed.selectedCandidateKey,
      category: parsed.category ?? unit.categoryHint ?? "sports",
      displayName: parsed.confirmedDisplayName ?? parsed.selectedCandidateKey,
      setName: null,
      collectorNumber: null,
      playerOrCharacter: null,
      year: null,
      externalIds: [],
      confidence: 1,
      matchReasons: ["operator_override"],
      provenance: markObserved({
        source: SCAN_HOLDING_SOURCE,
        ruleOrModelVersion: SCAN_INGEST_RULE,
        confidence: 1,
        notes: "Operator-entered identity · verified by confirm",
      }),
    };
  }

  const inventory = deps.inventory ?? [];
  const alert = findDuplicates(unit.id, [candidate], inventory);
  if (alert && !parsed.acknowledgeDuplicates) {
    const now = deps.now?.() ?? new Date();
    store.updateBatch(found.batch.id, (b) => ({
      ...b,
      status: "review" as const,
      updatedAt: now,
      units: b.units.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              candidates:
                u.candidates.some((c) => c.catalogKey === candidate!.catalogKey)
                  ? u.candidates
                  : [...u.candidates, candidate!],
              duplicateAlert: alert,
              status: "duplicate_alert" as const,
              selectedCandidateKey: candidate!.catalogKey,
              updatedAt: now,
            }
          : u,
      ),
    }));
    return {
      ok: false,
      code: "DUPLICATE_UNACKNOWLEDGED",
      message:
        "Duplicate holdings found — set acknowledgeDuplicates:true to add another copy",
      duplicateAlert: alert,
    };
  }

  const now = deps.now?.() ?? new Date();
  const holdingId = randomUUID();
  const assetId = candidate.assetId ?? randomUUID();
  const idObservationId = randomUUID();
  const assumedGrade = parsed.assumedGrade ?? "NM";

  let ebayDraft: EbayListingDraft | null = null;

  const batch = store.updateBatch(found.batch.id, (b) => {
    const units = b.units.map((u) => {
      if (u.id !== unit.id) return u;
      const next: ScanUnit = {
        ...u,
        status: "confirmed",
        selectedCandidateKey: candidate!.catalogKey,
        candidates: u.candidates.some((c) => c.catalogKey === candidate!.catalogKey)
          ? u.candidates
          : [...u.candidates, candidate!],
        duplicateAlert: alert,
        holdingId,
        idObservationId,
        decisionAction: "Hold",
        provenance: markObserved({
          source: SCAN_HOLDING_SOURCE,
          ruleOrModelVersion: SCAN_INGEST_RULE,
          confidence: 1,
          notes: alert
            ? "Identity verified · duplicate acknowledged · entered inventory"
            : "Identity verified · entered inventory",
        }),
        updatedAt: now,
      };

      if (parsed.queueEbayListingDraft) {
        ebayDraft = buildEbayListingDraft(
          next,
          candidate!,
          deps.ebayCreds ?? ebayCredsFromEnv(),
          now,
        );
        store.putDraft(ebayDraft);
        next.ebayListingDraftId = ebayDraft.id;
        next.status = ebayDraft.status === "pending_credentials" ? "confirmed" : "listed_draft";
      }
      return next;
    });

    const allDone = units.every(
      (u) => u.status === "confirmed" || u.status === "rejected" || u.status === "listed_draft",
    );
    return {
      ...b,
      units,
      status: allDone ? "closed" : "review",
      updatedAt: now,
    };
  });

  const confirmed = batch.units.find((u) => u.id === unit.id)!;
  const commit = commitFromUnit(confirmed, candidate, parsed, assetId, assumedGrade);

  return {
    ok: true,
    batch,
    unit: confirmed,
    commit,
    ebayDraft,
    decisionAction: "Hold",
  };
}

function commitFromUnit(
  unit: ScanUnit,
  candidate: { catalogKey: string; displayName: string; assetId?: string | null },
  req: ConfirmUnitRequest,
  assetId?: string,
  assumedGrade?: string | null,
): InventoryCommit {
  const grade = assumedGrade ?? req.assumedGrade ?? "NM";
  return {
    holdingId: unit.holdingId!,
    assetId: assetId ?? candidate.assetId ?? randomUUID(),
    source: SCAN_HOLDING_SOURCE,
    sourceRowId: unit.id,
    rawSnapshotId: unit.rawSnapshotId!,
    quantity: req.quantity,
    assumedGrade: grade,
    needsVerification: false,
    verificationNotes: unit.duplicateAlert
      ? `Duplicate acknowledged (${unit.duplicateAlert.duplicates.length} existing)`
      : `Scan ID confirmed as ${candidate.displayName}`,
    duplicateAcknowledged: Boolean(unit.duplicateAlert),
    provenance: markInferred({
      source: SCAN_HOLDING_SOURCE,
      ruleOrModelVersion: SCAN_INGEST_RULE,
      confidence: 0.5,
      notes: `${grade} assumed · unverified condition (intake scan, not museum/grading capture)`,
    }),
  };
}
