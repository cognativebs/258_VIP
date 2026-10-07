import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  INGEST_DESTINATIONS,
  INGEST_METHODS,
  applyLifecycle,
  assertDestinationChoice,
  assertMethod,
  batchVisible,
  commitAllowed,
  deriveStages,
  fixturesVisible,
  isStale,
  mapColumns,
  normalizeGtin,
  parseCsv,
  thinComps,
  upcIdentityViolation,
  type EvidenceClass,
  type IngestDestinationId,
  type IngestMethodKey,
  type IngestSubtargetKind,
  type Lifecycle,
} from "./ingestRules.js";

const RULE = "ingest-flow@1";

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type BatchRow = {
  id: string;
  name: string | null;
  device: string;
  lifecycle: Lifecycle;
  destination: IngestDestinationId | null;
  subtargetKind: IngestSubtargetKind | null;
  subtargetId: string | null;
  ingestMethod: IngestMethodKey | null;
  evidenceClass: EvidenceClass | null;
  createdAt: string;
  lastActivityAt: string;
  isFixture: boolean;
  scanUnits: number;
  ingestRows: number;
  identified: number;
  review: number;
  stale: boolean;
};

function num(value: unknown): number {
  return Number(value ?? 0);
}

function mapBatch(row: Record<string, unknown>): BatchRow {
  const last = String(row.last_activity_at ?? row.created_at);
  return {
    id: String(row.id),
    name: row.name == null ? null : String(row.name),
    device: String(row.device),
    lifecycle: String(row.lifecycle) as Lifecycle,
    destination: (row.destination as IngestDestinationId | null) ?? null,
    subtargetKind: (row.subtarget_kind as IngestSubtargetKind | null) ?? null,
    subtargetId: row.subtarget_id == null ? null : String(row.subtarget_id),
    ingestMethod: (row.ingest_method as IngestMethodKey | null) ?? null,
    evidenceClass: (row.evidence_class as EvidenceClass | null) ?? null,
    createdAt: String(row.created_at),
    lastActivityAt: last,
    isFixture: Boolean(row.is_fixture),
    scanUnits: num(row.scan_units),
    ingestRows: num(row.ingest_rows),
    identified: num(row.identified),
    review: num(row.review),
    stale: isStale(last),
  };
}

const BATCH_SELECT = sql`
  SELECT b.id, b.name, b.device, b.lifecycle, b.destination, b.subtarget_kind, b.subtarget_id,
         b.ingest_method, b.evidence_class, b.created_at, b.last_activity_at, b.is_fixture,
         (SELECT count(*) FROM vault_media.scan_unit u WHERE u.batch_id = b.id) AS scan_units,
         (SELECT count(*) FROM vault_media.ingest_row r WHERE r.batch_id = b.id AND r.voided = FALSE) AS ingest_rows,
         (
           (SELECT count(*) FROM vault_media.scan_unit u
             WHERE u.batch_id = b.id AND u.status IN ('identified', 'confirmed'))
           + (SELECT count(*) FROM vault_media.ingest_row r
             WHERE r.batch_id = b.id AND r.voided = FALSE AND r.asset_id IS NOT NULL AND r.needs_review = FALSE)
         ) AS identified,
         (
           (SELECT count(*) FROM vault_media.scan_unit u
             WHERE u.batch_id = b.id AND u.status IN ('needs_review', 'duplicate_alert'))
           + (SELECT count(*) FROM vault_media.ingest_row r
             WHERE r.batch_id = b.id AND r.voided = FALSE AND r.needs_review = TRUE AND r.committed_at IS NULL)
         ) AS review
  FROM vault_media.scan_batch b
`;

export async function ingestWorkspace(query = "") {
  const db = getDb();
  const show = fixturesVisible();
  const q = query.trim();
  const batches = await db.execute(sql`
    ${BATCH_SELECT}
    WHERE (${show} OR b.is_fixture = FALSE)
      AND (
        ${q} = ''
        OR coalesce(b.name, '') ILIKE ${"%" + q + "%"}
        OR coalesce(b.destination, '') ILIKE ${"%" + q + "%"}
        OR coalesce(b.ingest_method, '') ILIKE ${"%" + q + "%"}
        OR b.lifecycle ILIKE ${"%" + q + "%"}
        OR b.created_at::text ILIKE ${"%" + q + "%"}
      )
    ORDER BY b.last_activity_at DESC NULLS LAST, b.created_at DESC
    LIMIT 40
  `);
  const binders = await db.execute(sql`
    SELECT id, name FROM vault_tcg.binder ORDER BY name
  `);
  const hunts = await db.execute(sql`
    SELECT id::text AS id, name FROM vault_hunt.collection_hunt
    WHERE status = 'active'
    ORDER BY name
  `);
  const presets = await db.execute(sql`
    SELECT id, label, column_map FROM vault_media.ingest_csv_preset ORDER BY label
  `);
  return {
    destinations: INGEST_DESTINATIONS,
    methods: INGEST_METHODS,
    batches: (batches.rows as Array<Record<string, unknown>>)
      .map(mapBatch)
      .filter((batch) => batchVisible(batch.isFixture, show)),
    binders: (binders.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    })),
    hunts: (hunts.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    })),
    presets: (presets.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      columnMap: row.column_map as Record<string, string>,
    })),
  };
}

async function loadBatch(id: string): Promise<BatchRow> {
  const db = getDb();
  const result = await db.execute(sql`
    ${BATCH_SELECT}
    WHERE b.id = ${id}::uuid
  `);
  const row = (result.rows as Array<Record<string, unknown>>)[0];
  if (!row) throw new IngestError("Batch not found.", 404);
  const batch = mapBatch(row);
  if (!batchVisible(batch.isFixture)) throw new IngestError("Batch not found.", 404);
  return batch;
}

export async function getIngestBatch(id: string) {
  const batch = await loadBatch(id);
  const db = getDb();
  const newestFirst = batch.ingestMethod === "scanner_hid" || batch.ingestMethod === "scanner_batch";
  const order = newestFirst
    ? sql`r.created_at DESC, r.id DESC`
    : sql`r.created_at ASC, r.id ASC`;
  const rows = await db.execute(sql`
    SELECT r.id, r.ingest_method, r.evidence_class, r.raw_code, r.gtin14, r.quantity, r.product_label,
           r.asset_id::text, r.cost_basis, r.acquired_on, r.assumed_grade, r.slot_id, r.needs_review,
           r.review_reason, r.committed_at, r.created_at, r.voided,
           CASE
             WHEN r.gtin14 IS NULL THEN r.quantity
             ELSE SUM(CASE WHEN r.voided THEN 0 ELSE r.quantity END) OVER (PARTITION BY r.gtin14)
           END AS rollup
    FROM vault_media.ingest_row r
    WHERE r.batch_id = ${id}::uuid
    ORDER BY ${order}
  `);
  const total = await db.execute(sql`
    SELECT coalesce(sum(quantity), 0)::int AS n
    FROM vault_media.ingest_row
    WHERE batch_id = ${id}::uuid AND voided = FALSE
  `);
  const stages = deriveStages({
    lifecycle: batch.lifecycle,
    captured: batch.scanUnits + batch.ingestRows,
    identified: batch.identified,
    review: batch.review,
    acceptingRows: batch.lifecycle === "active",
  });
  return {
    batch,
    rows: rows.rows,
    stages,
    batchTotal: num((total.rows[0] as { n: number } | undefined)?.n),
    methodNote: batch.ingestMethod ? null : "Method was not recorded on this batch.",
  };
}

export async function createIngestBatch(input: {
  destination: string;
  subtargetKind?: string | null;
  subtargetId?: string | null;
  method: string;
  name?: string | null;
}) {
  const dest = assertDestinationChoice(input.destination, input.subtargetKind ?? null);
  if (!dest.ok) throw new IngestError(dest.reason, 400);
  const method = assertMethod(input.method);
  if (!method.ok) throw new IngestError(method.reason, method.status);
  if (dest.subtargetKind && !input.subtargetId) {
    throw new IngestError("Choose the binder or hunt this batch belongs to.", 400);
  }
  const db = getDb();
  const label =
    input.name?.trim() ||
    `${INGEST_DESTINATIONS.find((d) => d.id === dest.destination)?.label} · ${method.method.label}`;

  return db.transaction(async (tx) => {
    const paused = await tx.execute(sql`
      UPDATE vault_media.scan_batch
      SET lifecycle = 'paused', last_activity_at = now()
      WHERE destination = ${dest.destination}
        AND lifecycle = 'active'
        AND is_fixture = FALSE
      RETURNING id, name
    `);
    const session = await tx.execute(sql`
      INSERT INTO vault_media.capture_session
        (device, model_version, purpose, quality_tier, prov_source, prov_rule_version)
      VALUES (
        ${method.method.key}, ${RULE}, 'inventory_intake', 'intake', 'operator', ${RULE}
      )
      RETURNING id
    `);
    const sessionId = String((session.rows[0] as { id: string }).id);
    const inserted = await tx.execute(sql`
      INSERT INTO vault_media.scan_batch
        (session_id, device, status, lifecycle, destination, subtarget_kind, subtarget_id,
         ingest_method, evidence_class, name, last_activity_at, is_fixture)
      VALUES (
        ${sessionId}::uuid, ${method.method.key}, 'open', 'active',
        ${dest.destination}, ${dest.subtargetKind}, ${input.subtargetId ?? null},
        ${method.method.key}, ${method.method.evidenceClass}, ${label}, now(), FALSE
      )
      RETURNING id
    `);
    const id = String((inserted.rows[0] as { id: string }).id);
    const pausedRow = paused.rows[0] as { id: string; name: string | null } | undefined;
    return {
      id,
      paused: pausedRow
        ? {
            id: String(pausedRow.id),
            name: pausedRow.name,
            notice: "The previous active batch for this destination was paused.",
          }
        : null,
    };
  });
}

async function requireActive(id: string): Promise<BatchRow> {
  const batch = await loadBatch(id);
  if (batch.lifecycle !== "active") {
    throw new IngestError("Capture is open only on an active batch.", 409);
  }
  return batch;
}

export async function setBatchLifecycle(id: string, action: "pause" | "abandon" | "resume") {
  const batch = await loadBatch(id);
  const next = applyLifecycle(batch.lifecycle, action === "resume" ? "resume" : action);
  if (!next.ok) throw new IngestError(next.reason, 409);
  const db = getDb();
  if (action === "resume") {
    if (!batch.destination) throw new IngestError("This batch has no destination, so it cannot become active.", 409);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE vault_media.scan_batch
        SET lifecycle = 'paused', last_activity_at = now()
        WHERE destination = ${batch.destination}
          AND lifecycle = 'active'
          AND id <> ${id}::uuid
      `);
      await tx.execute(sql`
        UPDATE vault_media.scan_batch
        SET lifecycle = 'active', last_activity_at = now()
        WHERE id = ${id}::uuid
      `);
    });
    return getIngestBatch(id);
  }
  await db.execute(sql`
    UPDATE vault_media.scan_batch
    SET lifecycle = ${next.to}, last_activity_at = now()
    WHERE id = ${id}::uuid
  `);
  return getIngestBatch(id);
}

type CaptureResult =
  | { kind: "rejected"; reason: string }
  | { kind: "duplicate"; rowId: string; gtin14: string; quantity: number }
  | { kind: "known"; rowId: string; gtin14: string; productLabel: string | null; quantity: number; thinComps: boolean }
  | { kind: "unknown"; rowId: string; gtin14: string; quantity: number };

export async function captureCodes(
  batchId: string,
  codes: string[],
  body: Record<string, unknown> = {},
): Promise<CaptureResult[]> {
  const batch = await requireActive(batchId);
  if (batch.ingestMethod !== "scanner_hid" && batch.ingestMethod !== "scanner_batch") {
    throw new IngestError("This batch is not a scanner batch.", 409);
  }
  const violation = upcIdentityViolation(body);
  if (violation) throw new IngestError(violation, 400);
  const results: CaptureResult[] = [];
  for (const code of codes) {
    results.push(await captureOne(batch, code));
  }
  return results;
}

async function captureOne(batch: BatchRow, code: string): Promise<CaptureResult> {
  const parsed = normalizeGtin(code);
  if (!parsed.ok) return { kind: "rejected", reason: parsed.reason };
  const db = getDb();
  const prior = await db.execute(sql`
    SELECT coalesce(sum(quantity), 0)::int AS n
    FROM vault_media.ingest_row
    WHERE batch_id = ${batch.id}::uuid AND gtin14 = ${parsed.gtin14} AND voided = FALSE
  `);
  const already = num((prior.rows[0] as { n: number }).n);
  const mapped = await db.execute(sql`
    SELECT asset_id::text, product_label, needs_review, release_on
    FROM vault_catalog.gtin_map
    WHERE gtin14 = ${parsed.gtin14}
  `);
  const map = mapped.rows[0] as
    | { asset_id: string | null; product_label: string | null; needs_review: boolean; release_on: string | null }
    | undefined;
  const confirmed = Boolean(map?.asset_id) && map?.needs_review === false;
  const inserted = await db.execute(sql`
    INSERT INTO vault_media.ingest_row
      (batch_id, ingest_method, evidence_class, raw_code, gtin14, quantity, product_label,
       asset_id, needs_review, review_reason, voided)
    VALUES (
      ${batch.id}::uuid, ${batch.ingestMethod}, ${batch.evidenceClass}, ${code.trim()},
      ${parsed.gtin14}, 1, ${map?.product_label ?? null},
      ${confirmed ? map?.asset_id : null}::uuid,
      ${confirmed ? false : true},
      ${confirmed ? null : "Unknown GTIN. Confirm the product. A UPC does not set condition."},
      FALSE
    )
    RETURNING id
  `);
  await touch(batch.id);
  const rowId = String((inserted.rows[0] as { id: string }).id);
  const quantity = already + 1;
  if (!confirmed) return { kind: already > 0 ? "duplicate" : "unknown", rowId, gtin14: parsed.gtin14, quantity };
  if (already > 0) return { kind: "duplicate", rowId, gtin14: parsed.gtin14, quantity };
  return {
    kind: "known",
    rowId,
    gtin14: parsed.gtin14,
    productLabel: map?.product_label ?? null,
    quantity,
    thinComps: thinComps(map?.release_on ?? null),
  };
}

/** Marks the newest open scan event voided. The row stays. */
export async function undoLastScan(batchId: string) {
  const batch = await requireActive(batchId);
  if (batch.ingestMethod !== "scanner_hid" && batch.ingestMethod !== "scanner_batch") {
    throw new IngestError("Undo last applies to a scanner batch.", 409);
  }
  const db = getDb();
  const updated = await db.execute(sql`
    UPDATE vault_media.ingest_row
    SET voided = TRUE, voided_at = now()
    WHERE id = (
      SELECT id FROM vault_media.ingest_row
      WHERE batch_id = ${batch.id}::uuid
        AND voided = FALSE
        AND committed_at IS NULL
        AND ingest_method IN ('scanner_hid', 'scanner_batch')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    RETURNING id
  `);
  if (!updated.rows[0]) throw new IngestError("Nothing to undo.", 409);
  await touch(batch.id);
  return getIngestBatch(batch.id);
}

export async function confirmGtin(input: {
  batchId: string;
  rowId: string;
  productLabel: string;
  assetId?: string | null;
  confirmedBy?: string | null;
}) {
  const batch = await requireActive(input.batchId);
  if (!input.productLabel.trim()) throw new IngestError("A product name is required.", 400);
  const db = getDb();
  const confirmed = Boolean(input.assetId);
  await db.execute(sql`
    UPDATE vault_media.ingest_row
    SET product_label = ${input.productLabel.trim()},
        asset_id = ${input.assetId ?? null}::uuid,
        needs_review = ${confirmed ? false : true},
        review_reason = ${confirmed ? null : "Product name is asserted. The catalog asset is not confirmed."}
    WHERE batch_id = ${batch.id}::uuid
      AND voided = FALSE
      AND (
        id = ${input.rowId}::uuid
        OR gtin14 = (SELECT gtin14 FROM vault_media.ingest_row WHERE id = ${input.rowId}::uuid)
      )
  `);
  if (confirmed) {
    const row = await db.execute(sql`
      SELECT gtin14 FROM vault_media.ingest_row WHERE id = ${input.rowId}::uuid
    `);
    const gtin14 = (row.rows[0] as { gtin14: string } | undefined)?.gtin14;
    if (gtin14) {
      await db.execute(sql`
        INSERT INTO vault_catalog.gtin_map
          (gtin14, asset_id, product_label, confirmed_by, confirmed_at, needs_review, source_tier)
        VALUES (
          ${gtin14}, ${input.assetId}::uuid, ${input.productLabel.trim()},
          ${input.confirmedBy ?? "operator"}, now(), FALSE, 'operator'
        )
        ON CONFLICT (gtin14) DO UPDATE
        SET asset_id = EXCLUDED.asset_id,
            product_label = EXCLUDED.product_label,
            confirmed_by = EXCLUDED.confirmed_by,
            confirmed_at = EXCLUDED.confirmed_at,
            needs_review = FALSE,
            updated_at = now()
      `);
    }
  }
  await touch(batch.id);
  return getIngestBatch(batch.id);
}

export async function addManualRow(input: {
  batchId: string;
  productLabel: string;
  quantity: number;
  costBasis?: number | null;
  acquiredOn?: string | null;
  assumedGrade?: string | null;
  assetId?: string | null;
}) {
  const batch = await requireActive(input.batchId);
  if (batch.ingestMethod !== "manual") throw new IngestError("This batch is not a manual batch.", 409);
  if (!input.productLabel.trim()) throw new IngestError("A product name is required.", 400);
  const confirmed = Boolean(input.assetId);
  const db = getDb();
  await db.execute(sql`
    INSERT INTO vault_media.ingest_row
      (batch_id, ingest_method, evidence_class, quantity, product_label, asset_id,
       cost_basis, acquired_on, assumed_grade, needs_review, review_reason)
    VALUES (
      ${batch.id}::uuid, ${batch.ingestMethod}, ${batch.evidenceClass}, ${Math.max(1, input.quantity)},
      ${input.productLabel.trim()}, ${input.assetId ?? null}::uuid,
      ${input.costBasis ?? null}, ${isoDateOrNull(input.acquiredOn ?? "")}::date,
      ${input.assumedGrade ?? null}, ${!confirmed},
      ${confirmed ? null : "Manual entry is asserted, not device-captured."}
    )
  `);
  await touch(batch.id);
  return getIngestBatch(batch.id);
}

export async function queueNames(batchId: string, names: string[]) {
  const batch = await requireActive(batchId);
  if (batch.evidenceClass !== "image_identification") {
    throw new IngestError("This batch does not queue images.", 409);
  }
  const db = getDb();
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    await db.execute(sql`
      INSERT INTO vault_media.ingest_row
        (batch_id, ingest_method, evidence_class, product_label, needs_review, review_reason)
      VALUES (
        ${batch.id}::uuid, ${batch.ingestMethod}, ${batch.evidenceClass}, ${name}, TRUE,
        'Queued. Identification is not connected.'
      )
    `);
  }
  await touch(batch.id);
  return getIngestBatch(batch.id);
}

export async function previewCsv(input: { text: string; presetId?: string | null; columnMap?: Record<string, string> | null }) {
  const db = getDb();
  let columnMap = input.columnMap ?? null;
  let presetLabel: string | null = null;
  if (input.presetId) {
    const preset = await db.execute(sql`
      SELECT label, column_map FROM vault_media.ingest_csv_preset WHERE id = ${input.presetId}
    `);
    const row = preset.rows[0] as { label: string; column_map: Record<string, string> } | undefined;
    if (!row) throw new IngestError("Preset not found.", 404);
    columnMap = row.column_map;
    presetLabel = row.label;
  }
  if (!columnMap) throw new IngestError("Choose a preset or a column map.", 400);
  const table = parseCsv(input.text);
  if (table.length < 2) throw new IngestError("The file needs a header row and one data row.", 400);
  const headers = table[0] ?? [];
  const mapped = mapColumns(headers, columnMap);
  const externalHeader = mapped.external_id;
  const barcodeHeader = mapped.barcode;
  const preview = table.slice(1, 6).map((cells) => {
    const read = (index: number | null) => (index == null ? "" : (cells[index] ?? ""));
    return {
      name: read(mapped.name ?? null),
      quantity: read(mapped.quantity ?? null),
      barcode: read(barcodeHeader ?? null),
      externalId: read(externalHeader ?? null),
    };
  });
  const externalIds = table.slice(1).map((cells) => (externalHeader == null ? "" : cells[externalHeader] ?? "")).filter(Boolean);
  let duplicates = 0;
  if (externalIds.length) {
    const ids = sql.join(
      externalIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const found = await db.execute(sql`
      SELECT count(*)::int AS n FROM vault_collection.holding
      WHERE source_row_id IN (${ids})
    `);
    duplicates = num((found.rows[0] as { n: number }).n);
  }
  return { presetLabel, headers, mapped, preview, dataRows: table.length - 1, duplicates };
}

export async function storeCsv(batchId: string, input: { text: string; presetId?: string | null; columnMap?: Record<string, string> | null }) {
  const batch = await requireActive(batchId);
  if (batch.ingestMethod !== "csv_import") throw new IngestError("This batch is not a CSV batch.", 409);
  const preview = await previewCsv(input);
  const columnMap = input.columnMap ?? (await presetMap(input.presetId));
  const table = parseCsv(input.text);
  const headers = table[0] ?? [];
  const mapped = mapColumns(headers, columnMap);
  const db = getDb();
  for (const cells of table.slice(1)) {
    const read = (key: string) => {
      const index = mapped[key];
      return index == null ? "" : (cells[index] ?? "").trim();
    };
    const barcode = read("barcode");
    const gtin = barcode ? normalizeGtin(barcode) : null;
    const quantity = Math.max(1, Number(read("quantity")) || 1);
    const name = [read("name"), read("issue"), read("set_name"), read("number")].filter(Boolean).join(" · ");
    await db.execute(sql`
      INSERT INTO vault_media.ingest_row
        (batch_id, ingest_method, evidence_class, raw_code, gtin14, quantity, product_label,
         cost_basis, acquired_on, assumed_grade, needs_review, review_reason)
      VALUES (
        ${batch.id}::uuid, ${batch.ingestMethod}, ${batch.evidenceClass},
        ${barcode || null}, ${gtin && gtin.ok ? gtin.gtin14 : null}, ${quantity},
        ${name || "Unnamed import row"},
        ${read("cost") ? Number(read("cost")) : null},
        ${isoDateOrNull(read("acquired_on"))}::date,
        ${read("condition") || null},
        TRUE,
        ${gtin && !gtin.ok ? gtin.reason : "Imported row waits for product confirmation and dedup."}
      )
    `);
  }
  await touch(batch.id);
  return { ...(await getIngestBatch(batch.id)), preview };
}

async function presetMap(presetId?: string | null): Promise<Record<string, string>> {
  if (!presetId) throw new IngestError("Choose a preset or a column map.", 400);
  const db = getDb();
  const preset = await db.execute(sql`
    SELECT column_map FROM vault_media.ingest_csv_preset WHERE id = ${presetId}
  `);
  const row = preset.rows[0] as { column_map: Record<string, string> } | undefined;
  if (!row) throw new IngestError("Preset not found.", 404);
  return row.column_map;
}

export async function commitBatch(batchId: string, partial: boolean) {
  const batch = await loadBatch(batchId);
  const next = applyLifecycle(batch.lifecycle, "commit");
  if (!next.ok && batch.lifecycle !== "active" && batch.lifecycle !== "paused") {
    throw new IngestError(next.reason, 409);
  }
  if (!batch.destination) throw new IngestError("This batch has no destination.", 409);
  const destination = batch.destination;
  const db = getDb();
  const pending = await db.execute(sql`
    SELECT id, asset_id::text, cost_basis, acquired_on::text, quantity, needs_review,
           product_label, slot_id, assumed_grade, gtin14, ingest_method
    FROM vault_media.ingest_row
    WHERE batch_id = ${batchId}::uuid AND committed_at IS NULL AND voided = FALSE
  `);
  const lines = pending.rows as Array<Record<string, unknown>>;
  const ready: Array<Record<string, unknown>> = [];
  const blocked: { id: string; reason: string }[] = [];
  for (const line of lines) {
    const gate = commitAllowed({
      destination,
      assetId: (line.asset_id as string | null) ?? null,
      costBasis: line.cost_basis == null ? null : Number(line.cost_basis),
      acquiredOn: (line.acquired_on as string | null) ?? null,
      quantity: num(line.quantity),
      needsReview: Boolean(line.needs_review),
      subtargetKind: batch.subtargetKind,
      slotId: (line.slot_id as string | null) ?? null,
    });
    if (gate.ok) ready.push(line);
    else blocked.push({ id: String(line.id), reason: gate.reason });
  }
  if (!partial && blocked.length > 0) {
    return { committed: [], blocked, lifecycle: batch.lifecycle, partial: false };
  }
  const committed: string[] = [];
  for (const line of ready) {
    const outcome = await commitLine(batch, line);
    if (outcome.ok) committed.push(String(line.id));
    else blocked.push({ id: String(line.id), reason: outcome.reason });
  }
  const stillOpen = await db.execute(sql`
    SELECT count(*)::int AS n FROM vault_media.ingest_row
    WHERE batch_id = ${batchId}::uuid AND committed_at IS NULL AND voided = FALSE
  `);
  const open = num((stillOpen.rows[0] as { n: number }).n);
  const scanLeft = batch.scanUnits;
  const lifecycle = open === 0 && scanLeft === 0 ? "committed" : batch.lifecycle;
  if (lifecycle === "committed") {
    await db.execute(sql`
      UPDATE vault_media.scan_batch
      SET lifecycle = 'committed', status = 'closed', last_activity_at = now()
      WHERE id = ${batchId}::uuid
    `);
  } else {
    await touch(batchId);
  }
  return {
    committed,
    blocked,
    lifecycle,
    partial: partial && blocked.length > 0,
    dealerNote:
      destination === "dealer_inventory"
        ? "Cost basis is recorded. Margin and listing readiness are not computed in this pass."
        : null,
  };
}

async function commitLine(
  batch: BatchRow,
  line: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const assetId = String(line.asset_id);
  const destination = batch.destination as IngestDestinationId;
  if (batch.subtargetKind === "hunt" && batch.subtargetId) {
    const items = await db.execute(sql`
      SELECT i.id, i.status
      FROM vault_hunt.hunt_item i
      JOIN vault_hunt.hunt_section s ON s.id = i.section_id
      WHERE s.hunt_id = ${batch.subtargetId}::uuid AND i.asset_id = ${assetId}::uuid
    `);
    const item = items.rows[0] as { id: string; status: string } | undefined;
    if (!item) return { ok: false, reason: "No hunt slot matches this product." };
    if (item.status === "owned") {
      await db.execute(sql`
        UPDATE vault_media.ingest_row
        SET needs_review = TRUE, review_reason = 'Duplicate. This hunt slot is already filled.'
        WHERE id = ${String(line.id)}::uuid
      `);
      return { ok: false, reason: "Duplicate. This hunt slot is already filled." };
    }
    await db.execute(sql`
      UPDATE vault_hunt.hunt_item SET status = 'owned', updated_at = now() WHERE id = ${item.id}::uuid
    `);
    await db.execute(sql`
      UPDATE vault_hunt.collection_hunt h
      SET completion_pct = sub.pct, updated_at = now()
      FROM (
        SELECT round(100.0 * count(*) FILTER (WHERE i.status = 'owned') / NULLIF(count(*), 0), 2) AS pct
        FROM vault_hunt.hunt_item i
        JOIN vault_hunt.hunt_section s ON s.id = i.section_id
        WHERE s.hunt_id = ${batch.subtargetId}::uuid
      ) sub
      WHERE h.id = ${batch.subtargetId}::uuid
    `);
  }
  if (batch.subtargetKind === "binder") {
    const slotId = String(line.slot_id);
    const slot = await db.execute(sql`
      SELECT s.id, s.owned, s.card_name
      FROM vault_tcg.binder_slot s
      JOIN vault_tcg.binder_page p ON p.id = s.page_id
      WHERE s.id = ${slotId} AND p.binder_id = ${batch.subtargetId}
    `);
    const found = slot.rows[0] as { id: string; owned: boolean; card_name: string | null } | undefined;
    if (!found) return { ok: false, reason: "The slot is not in this binder." };
    if (found.owned || (found.card_name && found.card_name.trim())) {
      await db.execute(sql`
        UPDATE vault_media.ingest_row
        SET needs_review = TRUE, review_reason = 'Slot is already filled.'
        WHERE id = ${String(line.id)}::uuid
      `);
      return { ok: false, reason: "Slot is already filled." };
    }
    await db.execute(sql`
      UPDATE vault_tcg.binder_slot
      SET owned = TRUE,
          card_name = ${String(line.product_label ?? "Ingested copy")},
          provenance_source = 'ingest',
          provenance_method = 'operator',
          verification_status = 'unverified',
          added_at = ${Date.now()}
      WHERE id = ${slotId}
    `);
  }
  const existing = await db.execute(sql`
    SELECT id, quantity FROM vault_collection.holding
    WHERE asset_id = ${assetId}::uuid AND inventory_bucket = ${destination}
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  const held = existing.rows[0] as { id: string; quantity: number } | undefined;
  let holdingId: string;
  if (held) {
    holdingId = String(held.id);
    await db.execute(sql`
      UPDATE vault_collection.holding
      SET quantity = quantity + ${num(line.quantity)},
          updated_at = now(),
          verification_notes = concat_ws(' ', verification_notes, 'Quantity increased by ingest. Condition was not re-verified.')
      WHERE id = ${holdingId}::uuid
    `);
  } else {
    const inserted = await db.execute(sql`
      INSERT INTO vault_collection.holding
        (asset_id, quantity, purchase_price, purchase_date, assumed_grade, needs_verification,
         verification_notes, source, source_row_id, inventory_bucket, inventory_bucket_source,
         inventory_bucket_rule)
      VALUES (
        ${assetId}::uuid, ${num(line.quantity)}, ${line.cost_basis ?? null},
        ${line.acquired_on ?? null}::date, ${line.assumed_grade ?? null}, TRUE,
        ${line.assumed_grade ? "Condition from import · unverified" : "Condition not captured at ingest"},
        'ingest', ${String(line.id)}, ${destination}, 'operator', ${RULE}
      )
      RETURNING id
    `);
    holdingId = String((inserted.rows[0] as { id: string }).id);
  }
  await db.execute(sql`
    UPDATE vault_media.ingest_row
    SET committed_at = now(), holding_id = ${holdingId}::uuid, needs_review = FALSE
    WHERE id = ${String(line.id)}::uuid
  `);
  return { ok: true };
}

function isoDateOrNull(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function touch(batchId: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE vault_media.scan_batch SET last_activity_at = now() WHERE id = ${batchId}::uuid
  `);
}
