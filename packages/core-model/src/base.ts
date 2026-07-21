import { z } from "zod";
import { ProvenanceSchema } from "@vip/evidence";

export const UuidSchema = z.string().uuid();

/** Every persisted VIP record. Provenance is mandatory on derived data. */
export const BaseRecordSchema = z.object({
  id: UuidSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  provenance: ProvenanceSchema,
});
export type BaseRecord = z.infer<typeof BaseRecordSchema>;
