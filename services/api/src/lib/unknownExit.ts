import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  UNKNOWN_EXIT_RULE,
  UnknownExitCreateSchema,
  UnknownExitEventSchema,
  catalogSliceFromPillars,
  evaluateUnknownExitImpact,
  type UnknownExitCatalogSlice,
  type UnknownExitCreate,
  type UnknownExitEvent,
  type UnknownExitImpact,
} from "@vip/core-model";
import { markInferred } from "@vip/evidence";
import { getDb } from "../db/client.js";

export type UnknownExitPayload = {
  event: UnknownExitEvent | null;
  impact: UnknownExitImpact | null;
  catalog: UnknownExitCatalogSlice;
};

export type UnknownExitStore = {
  load: () => Promise<UnknownExitPayload>;
  create: (raw: unknown) => Promise<UnknownExitPayload>;
};

function eventFromRow(row: Record<string, unknown>): UnknownExitEvent {
  return UnknownExitEventSchema.parse({
    id: String(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scope: row.scope,
    estimatedQty: Number(row.estimated_qty),
    estimatedValueLow: row.estimated_value_low == null ? null : Number(row.estimated_value_low),
    estimatedValueHigh: row.estimated_value_high == null ? null : Number(row.estimated_value_high),
    currency: String(row.currency ?? "USD"),
    titlesRecorded: false,
    recipientNote: row.recipient_note == null ? null : String(row.recipient_note),
    occurredAt: row.occurred_at,
    status: row.status,
    holdingsTouched: false,
    provenance: {
      source: String(row.prov_source),
      method: String(row.prov_method),
      ruleOrModelVersion: String(row.prov_rule_version),
      confidence: Number(row.prov_confidence),
      verificationStatus: String(row.prov_verification),
      notes: row.prov_notes == null ? undefined : String(row.prov_notes),
    },
  });
}

export async function loadUnknownExitCatalog(): Promise<UnknownExitCatalogSlice> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE dropped_at IS NULL) AS catalog_holdings,
      COALESCE(
        SUM(COALESCE(current_price_snapshot, 0) * COALESCE(quantity, 1))
        FILTER (WHERE dropped_at IS NULL),
        0
      ) AS catalog_value,
      COUNT(*) FILTER (
        WHERE dropped_at IS NULL AND collection_pillar = 'General Inventory'
      ) AS scope_holdings,
      COALESCE(
        SUM(COALESCE(current_price_snapshot, 0) * COALESCE(quantity, 1))
        FILTER (WHERE dropped_at IS NULL AND collection_pillar = 'General Inventory'),
        0
      ) AS scope_value
    FROM vault_collection.holding
    WHERE source = 'clz_import'
  `);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    catalogHoldings: Number(row.catalog_holdings ?? 0),
    catalogValue: Number(row.catalog_value ?? 0),
    scopeName: "General Inventory",
    scopeHoldings: Number(row.scope_holdings ?? 0),
    scopeValue: Number(row.scope_value ?? 0),
  };
}

export async function loadOpenUnknownExit(): Promise<UnknownExitEvent | null> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT *
    FROM vault_collection.unknown_exit
    WHERE status = 'open'
    ORDER BY occurred_at DESC
    LIMIT 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? eventFromRow(row) : null;
}

export async function loadUnknownExitPayload(): Promise<UnknownExitPayload> {
  const catalog = await loadUnknownExitCatalog();
  const event = await loadOpenUnknownExit();
  return {
    event,
    impact: event ? evaluateUnknownExitImpact(catalog, event.estimatedQty) : null,
    catalog,
  };
}

export async function createUnknownExit(raw: unknown): Promise<UnknownExitPayload> {
  const parsed = UnknownExitCreateSchema.parse(raw);
  const catalog = await loadUnknownExitCatalog();
  if (catalog.scopeHoldings <= 0) {
    throw new Error("No General Inventory holdings to scope this exit against");
  }
  const impact = evaluateUnknownExitImpact(catalog, parsed.estimatedQty);
  const now = new Date();
  const provenance = markInferred({
    source: "operator_report",
    ruleOrModelVersion: UNKNOWN_EXIT_RULE,
    confidence: 0.4,
    confidenceBand: "low",
    notes: `Unrecorded bulk exit · titles unknown · holdings not deleted. ${parsed.recipientNote ?? ""}`.trim(),
  });
  const row: UnknownExitEvent = UnknownExitEventSchema.parse({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    provenance,
    scope: parsed.scope,
    estimatedQty: parsed.estimatedQty,
    estimatedValueLow: parsed.estimatedValueLow ?? impact.physicalValueLow,
    estimatedValueHigh: parsed.estimatedValueHigh ?? impact.physicalValueHigh,
    currency: "USD",
    titlesRecorded: false,
    recipientNote: parsed.recipientNote || null,
    occurredAt: parsed.occurredAt ?? now,
    status: "open",
    holdingsTouched: false,
  });

  const db = getDb();
  await db.execute(sql`
    UPDATE vault_collection.unknown_exit
       SET status = 'superseded', updated_at = now()
     WHERE status = 'open'
  `);
  await db.execute(sql`
    INSERT INTO vault_collection.unknown_exit
      (id, scope, estimated_qty, estimated_value_low, estimated_value_high,
       titles_recorded, recipient_note, occurred_at, status, holdings_touched,
       prov_source, prov_method, prov_rule_version, prov_confidence,
       prov_verification, prov_notes)
    VALUES (
      ${row.id}::uuid,
      ${row.scope},
      ${row.estimatedQty},
      ${row.estimatedValueLow},
      ${row.estimatedValueHigh},
      FALSE,
      ${row.recipientNote ?? null},
      ${row.occurredAt.toISOString()}::timestamptz,
      'open',
      FALSE,
      ${row.provenance.source},
      ${row.provenance.method}::vault_evidence.provenance_method,
      ${row.provenance.ruleOrModelVersion},
      ${row.provenance.confidence},
      ${row.provenance.verificationStatus}::vault_evidence.verification_status,
      ${row.provenance.notes ?? null}
    )
  `);
  return { event: row, impact, catalog };
}

export function postgresUnknownExitStore(): UnknownExitStore {
  return {
    load: loadUnknownExitPayload,
    create: createUnknownExit,
  };
}

export function memoryUnknownExitStore(
  initial?: Partial<UnknownExitCatalogSlice>,
): UnknownExitStore {
  let open: UnknownExitEvent | null = null;
  const catalog: UnknownExitCatalogSlice = {
    catalogHoldings: initial?.catalogHoldings ?? 2700,
    catalogValue: initial?.catalogValue ?? 24238,
    scopeName: initial?.scopeName ?? "General Inventory",
    scopeHoldings: initial?.scopeHoldings ?? 1044,
    scopeValue: initial?.scopeValue ?? 3640,
  };
  return {
    async load() {
      return {
        event: open,
        impact: open ? evaluateUnknownExitImpact(catalog, open.estimatedQty) : null,
        catalog,
      };
    },
    async create(raw: unknown) {
      const parsed = UnknownExitCreateSchema.parse(raw);
      const impact = evaluateUnknownExitImpact(catalog, parsed.estimatedQty);
      const now = new Date();
      open = UnknownExitEventSchema.parse({
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        provenance: markInferred({
          source: "operator_report",
          ruleOrModelVersion: UNKNOWN_EXIT_RULE,
          confidence: 0.4,
          notes: "memory fixture",
        }),
        scope: parsed.scope,
        estimatedQty: parsed.estimatedQty,
        estimatedValueLow: impact.physicalValueLow,
        estimatedValueHigh: impact.physicalValueHigh,
        currency: "USD",
        titlesRecorded: false,
        recipientNote: parsed.recipientNote || null,
        occurredAt: parsed.occurredAt ?? now,
        status: "open",
        holdingsTouched: false,
      });
      return { event: open, impact, catalog };
    },
  };
}

export { catalogSliceFromPillars, evaluateUnknownExitImpact };
