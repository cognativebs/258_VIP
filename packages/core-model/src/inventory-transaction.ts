import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";
import { InventoryBucketSchema } from "./inventory-bucket.js";

/** Operator-captured inventory event — not a marketplace sold-comp row. */
export const InventoryTransactionKindSchema = z.enum(["buy", "sell", "transfer_bucket"]);
export type InventoryTransactionKind = z.infer<typeof InventoryTransactionKindSchema>;

export const INVENTORY_TRANSACTION_RULE = "inventory-transaction@0.1.0";

export const InventoryTransactionSchema = BaseRecordSchema.extend({
  holdingId: UuidSchema.nullable(),
  holdingSourceRowId: z.string().min(1),
  kind: InventoryTransactionKindSchema,
  amount: z.number().nonnegative().nullable(),
  currency: z.string().length(3).default("USD"),
  occurredAt: z.coerce.date(),
  inventoryBucket: InventoryBucketSchema,
  notes: z.string().nullable().optional(),
});
export type InventoryTransaction = z.infer<typeof InventoryTransactionSchema>;

export const InventoryTransactionCreateSchema = z.object({
  holdingId: UuidSchema.nullable().optional(),
  holdingSourceRowId: z.string().min(1),
  kind: InventoryTransactionKindSchema,
  amount: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).optional(),
  occurredAt: z.coerce.date().optional(),
  inventoryBucket: InventoryBucketSchema,
  notes: z.string().nullable().optional(),
});
export type InventoryTransactionCreate = z.infer<typeof InventoryTransactionCreateSchema>;
