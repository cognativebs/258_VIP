import { z } from "zod";
import { SourceRegistryEntrySchema } from "../types.js";

/** Optional contribution stats — never fake precision; omit when unknown. */
export const SourceStatsSchema = z.object({
  signalCount: z.number().int().nonnegative().optional(),
  quarantineRate: z.number().min(0).max(1).optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
});
export type SourceStats = z.infer<typeof SourceStatsSchema>;

export const SourceRegistryPersistedEntrySchema = z.object({
  active: z.boolean(),
  persistedAt: z.string().optional(),
});
export type SourceRegistryPersistedEntry = z.infer<typeof SourceRegistryPersistedEntrySchema>;

export const SourceRegistryPersistedSchema = z.record(
  z.string(),
  SourceRegistryPersistedEntrySchema,
);
export type SourceRegistryPersisted = z.infer<typeof SourceRegistryPersistedSchema>;

/** API-facing source row: registry entry + label alias + stats. */
export const ApiSourceEntrySchema = SourceRegistryEntrySchema.extend({
  label: z.string().min(1),
  stats: SourceStatsSchema.optional(),
  persistedAt: z.string().optional(),
});
export type ApiSourceEntry = z.infer<typeof ApiSourceEntrySchema>;

// Re-export base schema for contracts-first consumers.
export { SourceRegistryEntrySchema };
