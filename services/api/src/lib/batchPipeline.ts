import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  BATCH_001_ID,
  BATCH_RUN_RULE,
  BatchDispositionSchema,
  BatchPipelineResultSchema,
  BatchRunSchema,
  InspectBatchItemBodySchema,
  identityDisagrees,
  type BatchDisposition,
  type BatchPipelineResult,
  type BatchRun,
  type ExpectedSportsIdentity,
  type MoneyFailureClass,
  type ParsedIdentitySlice,
} from "@vip/core-model";
import { markInferred } from "@vip/evidence";
import { ebayCredsFromEnv, parseSportsIdentity } from "@vip/scan-ingest";
import { getDb } from "../db/client.js";
import {
  BATCH_001_SPORTS_ROSTER,
  rosterBySlot,
  rosterByStem,
} from "./batch001SportsRoster.js";
import type { ApiHolding } from "./holdings.js";
import { queueListingDrafts } from "./listingQueue.js";
import { loadLiveRangeMap } from "./liveRange.js";
import { importFolderPages } from "./scanFolder.js";
import { openScanFromApi } from "./scanIngest.js";
import { persistBatch, resolveUnit } from "./scanStorePg.js";

/** 1×1 JPEG so PaperStream-shaped filenames have bytes before the scanner is live. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAf/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwD/2Q==",
  "base64",
);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const BATCH_001_SPORTS_DIR = join(REPO_ROOT, "data", "scan-inbox", "batch-001-sports");

export function decideDealerDisposition(input: {
  hasIdentity: boolean;
  confidence: number | null;
}): BatchDisposition {
  if (!input.hasIdentity || (input.confidence ?? 0) < 0.35) {
    return BatchDispositionSchema.parse({
      action: "Hold",
      reasonCode: "IDENTITY_TOO_WEAK",
      notes:
        "Identity is inferred · unverified and too weak to list. Review before churn.",
      confidence: 0.3,
      ruleOrModelVersion: BATCH_RUN_RULE,
      verificationStatus: "unverified",
    });
  }
  return BatchDispositionSchema.parse({
    action: "Sell",
    reasonCode: "DEALER_CHURN",
    notes:
      "Dealer Inventory — capital that exists to churn. LIVE is evidence, not a Hold reason.",
    confidence: 0.55,
    ruleOrModelVersion: BATCH_RUN_RULE,
    verificationStatus: "unverified",
  });
}

export function sliceFromCandidate(
  candidate: {
    catalogKey?: string | null;
    displayName?: string | null;
    year?: number | null;
    setName?: string | null;
    playerOrCharacter?: string | null;
    collectorNumber?: string | null;
    confidence?: number | null;
    matchReasons?: string[];
  } | null,
  fileStem: string,
): ParsedIdentitySlice {
  const parsed = parseSportsIdentity(fileStem);
  const reasons = candidate?.matchReasons ?? parsed?.matchReasons ?? [];
  return {
    catalogKey: candidate?.catalogKey ?? parsed?.displayName ?? null,
    displayName: candidate?.displayName ?? parsed?.displayName ?? null,
    year: candidate?.year ?? parsed?.year ?? null,
    brand: parsed?.brand ?? candidate?.setName ?? null,
    player: candidate?.playerOrCharacter ?? parsed?.player ?? null,
    collectorNumber: candidate?.collectorNumber ?? parsed?.collectorNumber ?? null,
    parallel: parsed?.parallel ?? null,
    serialMax: parsed?.serialMax ?? null,
    autograph: parsed?.autograph ?? false,
    relic: parsed?.relic ?? false,
    confidence: candidate?.confidence ?? parsed?.confidence ?? null,
    matchReasons: reasons,
  };
}

export function softwareFlagsFor(
  expected: ExpectedSportsIdentity,
  identity: ParsedIdentitySlice,
  liveLabel: string | null,
  dispositionAction: string | null,
  listingTitle: string | null,
): { flags: MoneyFailureClass[]; notes: string[] } {
  const flags = new Set<MoneyFailureClass>();
  const notes: string[] = [];
  for (const n of identityDisagrees(expected, identity)) {
    flags.add("identity");
    notes.push(n);
  }
  if (!liveLabel || liveLabel === "not fetched") {
    flags.add("pricing");
    notes.push("LIVE not fetched — no Browse listings · unverified range");
  }
  if (dispositionAction === "Hold" && expected.parallel) {
    flags.add("disposition");
    notes.push("Dealer messy card held — expected churn Sell");
  }
  if (listingTitle && expected.parallel && !listingTitle.toLowerCase().includes(expected.parallel.toLowerCase())) {
    flags.add("listing");
    notes.push(`Listing title dropped parallel ${expected.parallel}`);
  }
  return { flags: [...flags], notes };
}

function materializeSportsInbox(): { dir: string; fileCount: number } {
  mkdirSync(BATCH_001_SPORTS_DIR, { recursive: true });
  for (const row of BATCH_001_SPORTS_ROSTER) {
    const path = join(BATCH_001_SPORTS_DIR, `${row.fileStem}.jpg`);
    writeFileSync(path, Buffer.concat([TINY_JPEG, Buffer.from(`\n${row.fileStem}\n`)]));
  }
  return { dir: BATCH_001_SPORTS_DIR, fileCount: BATCH_001_SPORTS_ROSTER.length };
}

function stemFromRef(ref: string): string {
  const base = ref.split(/[\\/]/).pop() ?? ref;
  return base.replace(/\.(jpe?g|png|tiff?|webp)$/i, "").replace(/_front$/i, "");
}

async function upsertRunStatus(status: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO vault_collection.batch_run (id, label, status, notes)
    VALUES (
      ${BATCH_001_ID},
      ${"Batch 001 — 25 sports then 10 comics"},
      ${status},
      ${"Sports first. Dealer Inventory. Inspect every row."}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      updated_at = now()
  `);
}

async function persistItem(
  result: BatchPipelineResult,
  roster: ReturnType<typeof rosterBySlot>,
): Promise<void> {
  if (!roster) return;
  const db = getDb();
  await db.execute(sql`
    INSERT INTO vault_collection.batch_run_item
      (batch_id, slot, category, file_stem, unit_id, holding_id,
       holding_source_row_id, roster, pipeline_result, pipeline_elapsed_ms,
       prov_source, prov_method, prov_rule_version, prov_verification)
    VALUES (
      ${BATCH_001_ID}, ${result.slot}, ${roster.category}, ${roster.fileStem},
      ${result.unitId ? sql`${result.unitId}::uuid` : sql`NULL`},
      ${result.holdingId ? sql`${result.holdingId}::uuid` : sql`NULL`},
      ${result.holdingSourceRowId},
      ${JSON.stringify(roster)}::jsonb,
      ${JSON.stringify(result)}::jsonb,
      ${Math.round(result.pipelineElapsedMs)},
      ${"batch_001"}, ${"inferred"}, ${BATCH_RUN_RULE}, ${"unverified"}
    )
    ON CONFLICT (batch_id, slot) DO UPDATE SET
      unit_id = EXCLUDED.unit_id,
      holding_id = EXCLUDED.holding_id,
      holding_source_row_id = EXCLUDED.holding_source_row_id,
      pipeline_result = EXCLUDED.pipeline_result,
      pipeline_elapsed_ms = EXCLUDED.pipeline_elapsed_ms,
      updated_at = now()
  `);
}

function holdingForQueue(input: {
  holdingId: string;
  assetName: string;
  sourceRowId: string;
}): ApiHolding {
  return {
    id: input.holdingId,
    assetName: input.assetName,
    series: input.assetName,
    issue: "",
    publisher: "Scan intake (sports)",
    quantity: 1,
    pillar: "Scanned Intake",
    inventoryBucket: "dealer_inventory",
    inventoryBucketAssignment: "operator",
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: "Sell",
    sellPriority: "High",
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: "Batch 001 dealer intake · NM assumed · unverified",
    currentPrice: null,
    assumedGrade: "NM",
    gradeRating: null,
    coverImageUrl: null,
    cardName: input.assetName,
    rarity: null,
    externalIds: [{ source: "batch_001", externalValue: input.sourceRowId }],
    provenance: markInferred({
      source: "ricoh_fi8170",
      ruleOrModelVersion: BATCH_RUN_RULE,
      confidence: 0.45,
      notes: "Batch 001 sports · dealer_inventory · inferred identity until inspect",
    }),
  };
}

export async function runBatch001Sports(): Promise<BatchRun> {
  const started = Date.now();
  await upsertRunStatus("sports_running");
  const inbox = materializeSportsInbox();
  const imported = await importFolderPages({
    folder: inbox.dir,
    categoryHint: "sports",
    pairing: "filename_front_back",
    notes: "Batch 001 sports — messy dealer lot",
    maxFiles: 40,
  });
  if (!imported.ok) {
    throw new Error(imported.error);
  }

  const opened = await openScanFromApi({
    categoryHint: "sports",
    notes: "Batch 001 sports — ingest → identify → bucket → price → disposition → eBay-ready",
    pages: imported.pages,
    inventory: [],
    pairing: "filename_front_back",
  });
  await persistBatch(opened, { adapterId: "batch-001-sports", notes: "Batch 001" });

  const items: BatchRun["items"] = [];

  for (const unit of opened.batch.units) {
    const t0 = Date.now();
    const stem = stemFromRef(unit.frontStorageRef);
    const roster = rosterByStem(stem);
    const top = unit.candidates[0] ?? null;
    const identity = sliceFromCandidate(top, stem);
    const stages: BatchPipelineResult["stagesCompleted"] = ["ingest", "identify"];

    let holdingId: string | null = null;
    if (top && roster) {
      const resolved = await resolveUnit({
        unitId: unit.id,
        catalogKey: top.catalogKey,
        mode: "operator_confirmed",
        quantity: 1,
        acknowledgeDuplicates: true,
        assumedGrade: "NM",
        location: "batch-001-dealer",
      });
      if (resolved.ok) {
        holdingId = resolved.holdingId;
        stages.push("inventory_bucket");
        const db = getDb();
        await db.execute(sql`
          UPDATE vault_collection.holding
          SET inventory_bucket = 'dealer_inventory',
              inventory_bucket_source = 'operator',
              inventory_bucket_rule = 'inventory-bucket@0.1.0',
              collection_pillar = 'General Inventory',
              recommendation = 'Sell',
              sell_priority = 'High',
              updated_at = now()
          WHERE id = ${holdingId}::uuid
        `);
      }
    }

    const liveMap = await loadLiveRangeMap(
      holdingId ? [holdingId, unit.id] : [unit.id],
    );
    const live = liveMap.get(holdingId ?? unit.id) ?? liveMap.get(unit.id) ?? null;
    stages.push("price");

    const disposition = decideDealerDisposition({
      hasIdentity: Boolean(identity.displayName),
      confidence: identity.confidence,
    });
    stages.push("disposition");
    if (holdingId) {
      const db = getDb();
      await db.execute(sql`
        UPDATE vault_media.scan_unit
        SET decision_action = ${disposition.action}, updated_at = now()
        WHERE id = ${unit.id}::uuid
      `);
    }

    let listing: BatchPipelineResult["listing"] = {
      draftId: null,
      status: null,
      title: identity.displayName,
      categoryHint: "sports",
      condition: "NM assumed · unverified",
      askPrice: null,
      submitReady: false,
      emptyReason: holdingId ? null : "No holding — listing not queued",
      imageCount: unit.backStorageRef ? 2 : 1,
    };
    if (holdingId && disposition.action === "Sell") {
      const creds = ebayCredsFromEnv();
      const hasEbayCreds = Boolean(
        creds.oauthToken?.trim() || (creds.clientId?.trim() && creds.clientSecret?.trim()),
      );
      const queued = await queueListingDrafts(
        [
          holdingForQueue({
            holdingId,
            assetName: identity.displayName ?? stem,
            sourceRowId: unit.id,
          }),
        ],
        {
          holdingSourceRowIds: [holdingId],
          action: "Sell",
        },
        hasEbayCreds,
      );
      const draft = queued.drafts[0];
      listing = {
        draftId: draft?.id ?? null,
        status: draft?.status ?? "failed",
        title: draft?.title ?? identity.displayName,
        categoryHint: "sports",
        condition: "NM assumed · unverified",
        askPrice: draft?.askPrice ?? null,
        submitReady: Boolean(draft?.listingPayload?.submitReady),
        emptyReason: draft?.emptyReason ?? queued.rejected,
        imageCount: unit.backStorageRef ? 2 : 1,
      };
    }
    stages.push("ebay_ready");

    const flags = roster
      ? softwareFlagsFor(
          roster.expected,
          identity,
          live?.label ?? null,
          disposition.action,
          listing.title,
        )
      : { flags: [], notes: [] };

    const result = BatchPipelineResultSchema.parse({
      slot: roster?.slot ?? unit.unitIndex + 1,
      unitId: unit.id,
      holdingId,
      holdingSourceRowId: unit.id,
      stagesCompleted: stages,
      identity,
      inventoryBucket: holdingId ? "dealer_inventory" : null,
      liveRange: live,
      disposition,
      listing,
      softwareFlags: flags.flags,
      softwareFlagNotes: flags.notes,
      pipelineElapsedMs: Date.now() - t0,
    });
    await persistItem(result, roster);
    items.push({
      slot: result.slot,
      category: "sports",
      roster: roster ?? BATCH_001_SPORTS_ROSTER[0]!,
      result,
      inspection: null,
    });
  }

  await upsertRunStatus("sports_ready");
  void started;
  return loadBatch001();
}

export async function inspectBatch001Item(raw: unknown) {
  const body = InspectBatchItemBodySchema.parse(raw);
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute(sql`
    UPDATE vault_collection.batch_run_item
    SET failure_classes = ARRAY(
          SELECT jsonb_array_elements_text(${JSON.stringify(body.failureClasses)}::jsonb)
        ),
        inspect_notes = ${body.notes},
        human_seconds = ${body.humanSeconds},
        inspector = ${body.inspector},
        inspected_at = ${now}::timestamptz,
        updated_at = now()
    WHERE batch_id = ${BATCH_001_ID} AND slot = ${body.slot}
  `);
  return loadBatch001();
}

export async function loadBatch001(): Promise<BatchRun> {
  const db = getDb();
  const runRes = await db.execute(sql`
    SELECT id, label, status FROM vault_collection.batch_run WHERE id = ${BATCH_001_ID}
  `);
  const run = (runRes.rows as Array<Record<string, unknown>>)[0];
  const itemRes = await db.execute(sql`
    SELECT slot, category, file_stem, roster, pipeline_result,
           failure_classes, inspect_notes, human_seconds, inspector, inspected_at
    FROM vault_collection.batch_run_item
    WHERE batch_id = ${BATCH_001_ID}
    ORDER BY slot
  `);
  const bySlot = new Map<number, Record<string, unknown>>();
  for (const row of itemRes.rows as Array<Record<string, unknown>>) {
    bySlot.set(Number(row.slot), row);
  }

  const items = BATCH_001_SPORTS_ROSTER.map((roster) => {
    const row = bySlot.get(roster.slot);
    const inspection =
      row && (row.inspected_at || (Array.isArray(row.failure_classes) && (row.failure_classes as string[]).length))
        ? {
            failureClasses: (row.failure_classes as MoneyFailureClass[]) ?? [],
            notes: String(row.inspect_notes ?? ""),
            humanSeconds: Number(row.human_seconds ?? 0),
            inspectedAt: row.inspected_at ? String(row.inspected_at) : null,
            inspector: row.inspector ? String(row.inspector) : null,
          }
        : null;
    return {
      slot: roster.slot,
      category: roster.category,
      roster,
      result: row?.pipeline_result
        ? BatchPipelineResultSchema.parse(row.pipeline_result)
        : null,
      inspection,
    };
  });

  return BatchRunSchema.parse({
    id: BATCH_001_ID,
    label: String(run?.label ?? "Batch 001 — 25 sports then 10 comics"),
    status: (run?.status as BatchRun["status"]) ?? "not_started",
    sportsCount: 25,
    comicsCount: 10,
    items,
    provenance: {
      source: "batch_001",
      method: "inferred",
      ruleOrModelVersion: BATCH_RUN_RULE,
      verificationStatus: "unverified",
      notes:
        "Sports first. Comics half waits. Failures are money-affecting only. Human seconds are a baseline, not a KPI target.",
    },
  });
}

export function batch001InboxReady(): { dir: string; fileCount: number } {
  return materializeSportsInbox();
}

export function newInspectId(): string {
  return randomUUID();
}
