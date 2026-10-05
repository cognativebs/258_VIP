/**
 * Signals synthesis (pure, read-time). The PokéBeach cluster job stores the
 * clusters as spine events (connector step 6, PR #98); synthesis decides at
 * read time which of those events surface, from a versioned synthesis profile
 * (operator decisions 2026-10-04):
 *
 * - An event with profile.minClusterItems or more PRIMARY items is a cluster
 *   and surfaces whatever its theme.
 * - A single official article surfaces alone only when its theme is factual
 *   and actionable (profile.soloThemes); otherwise it waits for a cluster.
 * - profile.neverThemes never surface.
 * - Bands come from signal_priority and independent sources, also read-time.
 *
 * Nothing here writes: no event, no signal, no score.
 */
import { z } from "zod";
import { SpineSignalTypeCodeSchema } from "../schemas/spine.js";

export const SYNTHESIS_VERSION = "signals-synthesis@0.2.0";

export const SynthesisProfileSchema = z
  .object({
    schema: z.literal("vip_signals_synthesis_v1"),
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    domain: z.enum(["sports_cards", "collectibles", "macro"]),
    windowHours: z.number().int().positive(),
    minClusterItems: z.number().int().min(2),
    /** Sources whose single article may stand alone as a signal. */
    officialSources: z.array(z.string().min(1)).min(1),
    soloThemes: z.array(SpineSignalTypeCodeSchema),
    neverThemes: z.array(SpineSignalTypeCodeSchema),
    corroboration: z.literal("single_source_noise_pow_independent_sources"),
    /** Read-time bands on signal_priority, ascending. Below the first is noise. */
    bands: z
      .array(
        z
          .object({
            label: z.enum(["watch", "emerging", "strong", "high_conviction"]),
            minPriority: z.number().min(0).max(1),
            minIndependentSources: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.bands.forEach((b, i) => {
      if (i > 0 && b.minPriority < p.bands[i - 1]!.minPriority) {
        ctx.addIssue({ code: "custom", path: ["bands", i], message: "bands must ascend by minPriority" });
      }
    });
    for (const t of p.soloThemes) {
      if (p.neverThemes.includes(t)) ctx.addIssue({ code: "custom", path: ["soloThemes"], message: `${t} is both solo and never` });
    }
  });
export type SynthesisProfile = z.infer<typeof SynthesisProfileSchema>;

export type Band = "noise" | SynthesisProfile["bands"][number]["label"];

/** Read-time band: the highest band whose priority and independence floors are both met. */
export function bandFor(priority: number, independentSources: number, profile: SynthesisProfile): Band {
  let out: Band = "noise";
  for (const b of profile.bands) {
    if (priority >= b.minPriority && independentSources >= b.minIndependentSources) out = b.label;
  }
  return out;
}

export type SurfaceDecision = {
  surfaced: boolean;
  kind: "solo" | "cluster";
  reason: string;
};

/** Whether a stored event surfaces under the profile, and why. */
export function surfaceFor(
  event: { theme: string; primaryItems: number; sourceKeys: ReadonlyArray<string> },
  profile: SynthesisProfile,
): SurfaceDecision {
  const kind = event.primaryItems >= profile.minClusterItems ? "cluster" : "solo";
  if (profile.neverThemes.includes(event.theme as never)) {
    return { surfaced: false, kind, reason: `${event.theme} never surfaces (${profile.name}@${profile.version})` };
  }
  if (kind === "cluster") return { surfaced: true, kind, reason: `cluster of ${event.primaryItems} articles` };
  const official = event.sourceKeys.some((k) => profile.officialSources.includes(k));
  if (official && profile.soloThemes.includes(event.theme as never)) {
    return { surfaced: true, kind, reason: `official ${event.theme} article stands alone` };
  }
  return {
    surfaced: false,
    kind,
    reason: `${event.theme} needs a cluster (${event.primaryItems} of ${profile.minClusterItems} articles)`,
  };
}
