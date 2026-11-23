import { z } from "zod";
import { SourceRegistryEntrySchema } from "../types.js";

/** Optional contribution stats — never fake precision; omit when unknown. */
export const SourceStatsSchema = z.object({
  signalCount: z.number().int().nonnegative().optional(),
  quarantineRate: z.number().min(0).max(1).optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
  /** How the counts were attributed (provenance for a derived number). */
  method: z.string().min(1).optional(),
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
  /**
   * Jobs that read this source's toggle (finish plan Q12, owner 2026-11-23).
   * Empty means no job reads it yet: the toggle is saved but changes nothing.
   */
  readBy: z.array(z.string().min(1)).optional(),
});
export type ApiSourceEntry = z.infer<typeof ApiSourceEntrySchema>;

/** PATCH /api/sources/:id — the job feed registry toggle (sources-state.json). */
export const SourcePatchRequestSchema = z.object({ active: z.boolean() }).strict();
export type SourcePatchRequest = z.infer<typeof SourcePatchRequestSchema>;

export const SourcesListResponseSchema = z.object({ sources: z.array(ApiSourceEntrySchema) });
export type SourcesListResponse = z.infer<typeof SourcesListResponseSchema>;

// Re-export base schema for contracts-first consumers.
export { SourceRegistryEntrySchema };
