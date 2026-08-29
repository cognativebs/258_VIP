import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  INVENTORY_TRANSACTION_RULE,
  InventoryTransactionCreateSchema,
  InventoryTransactionSchema,
  type InventoryTransaction,
} from "@vip/core-model";
import { markObserved } from "@vip/evidence";
import { getDb } from "../db/client.js";

export async function createInventoryTransaction(
  raw: unknown,
): Promise<{ ok: true; row: InventoryTransaction } | { ok: false; status: 400; error: string }> {
  const parsed = InventoryTransactionCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid transaction",
    };
  }
  const now = new Date();
  const occurredAt = parsed.data.occurredAt ?? now;
  const provenance = markObserved({
    source: "operator_capture",
    ruleOrModelVersion: INVENTORY_TRANSACTION_RULE,
    confidence: 1,
    notes: parsed.data.notes ?? "Operator-captured inventory event · not a marketplace sold comp",
  });
  const row = InventoryTransactionSchema.parse({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    provenance,
    holdingId: parsed.data.holdingId ?? null,
    holdingSourceRowId: parsed.data.holdingSourceRowId,
    kind: parsed.data.kind,
    amount: parsed.data.amount ?? null,
    currency: parsed.data.currency ?? "USD",
    occurredAt,
    inventoryBucket: parsed.data.inventoryBucket,
    notes: parsed.data.notes ?? null,
  });

  const db = getDb();
  await db.execute(sql`
    INSERT INTO vault_collection.inventory_transaction
      (id, holding_id, holding_source_row_id, kind, amount, currency, occurred_at,
       inventory_bucket, notes, prov_source, prov_method, prov_rule_version,
       prov_confidence, prov_verification, prov_notes)
    VALUES (
      ${row.id}::uuid,
      ${row.holdingId ? sql`${row.holdingId}::uuid` : sql`NULL`},
      ${row.holdingSourceRowId},
      ${row.kind},
      ${row.amount},
      ${row.currency},
      ${row.occurredAt.toISOString()}::timestamptz,
      ${row.inventoryBucket},
      ${row.notes ?? null},
      ${row.provenance.source},
      ${row.provenance.method}::vault_evidence.provenance_method,
      ${row.provenance.ruleOrModelVersion},
      ${row.provenance.confidence},
      ${row.provenance.verificationStatus}::vault_evidence.verification_status,
      ${row.provenance.notes ?? null}
    )
  `);
  return { ok: true, row };
}

export async function listInventoryTransactions(): Promise<InventoryTransaction[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT *
    FROM vault_collection.inventory_transaction
    ORDER BY occurred_at DESC
    LIMIT 200
  `);
  return (result.rows as Record<string, unknown>[]).map((row) =>
    InventoryTransactionSchema.parse({
      id: String(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      holdingId: row.holding_id ? String(row.holding_id) : null,
      holdingSourceRowId: String(row.holding_source_row_id),
      kind: row.kind,
      amount: row.amount == null ? null : Number(row.amount),
      currency: String(row.currency ?? "USD"),
      occurredAt: row.occurred_at,
      inventoryBucket: row.inventory_bucket,
      notes: row.notes == null ? null : String(row.notes),
      provenance: {
        source: String(row.prov_source),
        method: String(row.prov_method),
        ruleOrModelVersion: String(row.prov_rule_version),
        confidence: Number(row.prov_confidence),
        verificationStatus: String(row.prov_verification),
        notes: row.prov_notes == null ? undefined : String(row.prov_notes),
      },
    }),
  );
}
