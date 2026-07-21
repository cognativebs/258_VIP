import { z } from "zod";
import { BaseRecordSchema } from "./base.js";

/**
 * Immutable import payload. DB must forbid UPDATE on snapshot rows.
 * Processed holdings/assets are always regenerable from this.
 */
export const RawSnapshotSchema = BaseRecordSchema.extend({
  source: z.string().min(1),
  contentHash: z.string().min(1),
  contentType: z.string().min(1).default("application/xml"),
  /** Inline for small fixtures; production may use storageRef only. */
  payload: z.string().optional(),
  storageRef: z.string().optional(),
  byteLength: z.number().int().nonnegative(),
  ingestedAt: z.coerce.date(),
  recordCount: z.number().int().nonnegative().optional(),
}).refine((row) => Boolean(row.payload || row.storageRef), {
  message: "RawSnapshot requires payload or storageRef",
});
export type RawSnapshot = z.infer<typeof RawSnapshotSchema>;
