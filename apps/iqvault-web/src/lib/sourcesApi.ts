import { z } from "zod";
import { apiPatch } from "./api";

/**
 * IQVault Sources editor (backlog D).
 *
 * These are the @vip/signals SourceRegistry rows the jobs read from
 * sources-state.json (pokemon-drops, eBay comps). They are NOT the
 * vault_core.signals_news_source rows — news sources are enabled only by the
 * operator command `npm run news-source -- enable … --confirm-operator`.
 *
 * Mirrors ApiSourceEntrySchema in @vip/signals (the web app does not depend on
 * that package); parse at the boundary so a drifted API fails loudly.
 */

export const SourceStatsSchema = z.object({
  signalCount: z.number().int().nonnegative().optional(),
  quarantineRate: z.number().min(0).max(1).optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
  method: z.string().optional(),
});
export type SourceStats = z.infer<typeof SourceStatsSchema>;

export const SourceRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  label: z.string().min(1),
  authority: z.string(),
  accessMethod: z.string(),
  categoryCoverage: z.array(z.string()),
  terms: z.string(),
  historicalAccuracy: z.number().min(0).max(1),
  latencyHours: z.number().nonnegative(),
  active: z.boolean(),
  persistedAt: z.string().optional(),
  stats: SourceStatsSchema.optional(),
});
export type SourceRow = z.infer<typeof SourceRowSchema>;

export const SourcesListSchema = z.object({ sources: z.array(SourceRowSchema) });
export const SourcePatchResponseSchema = z.object({ source: SourceRowSchema });

/** Display copy for the three stats. Unknown stays unknown, never a zero. */
export function formatSourceStats(stats: SourceStats | undefined): {
  signals: string;
  quarantine: string;
  evidence: string;
  method: string;
} {
  if (!stats) {
    return {
      signals: "—",
      quarantine: "—",
      evidence: "—",
      method: "Not attributed: the signals feed does not tag rows with this source yet.",
    };
  }
  const rate = stats.quarantineRate;
  return {
    signals: stats.signalCount == null ? "—" : String(stats.signalCount),
    quarantine:
      rate == null || (stats.signalCount ?? 0) === 0 ? "—" : `${Math.round(rate * 100)}%`,
    evidence: stats.evidenceCount == null ? "—" : String(stats.evidenceCount),
    method: stats.method ?? "Method not reported.",
  };
}

/** Browser write: flip one job-feed source on or off. */
export async function setSourceActive(id: string, active: boolean): Promise<SourceRow> {
  const data = await apiPatch<unknown>(`/api/sources/${encodeURIComponent(id)}`, { active });
  return SourcePatchResponseSchema.parse(data).source;
}
