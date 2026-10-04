/**
 * Signals synthesis (pure planning). Decides which clusters and official
 * articles become signals, with what scores, and under which stable event key,
 * from a versioned synthesis profile (operator decisions 2026-10-04):
 *
 * - An official article alone becomes a signal when its theme is factual and
 *   actionable (profile.soloThemes); everything else needs a cluster of
 *   profile.minClusterItems; profile.neverThemes never become signals.
 * - An article joins at most one signal: the strongest cluster it belongs to.
 * - The event key is anchored on the earliest article, so a solo signal and
 *   the cluster that later grows from it are the same event.
 * - Scores: confidence = the best article's (source ceiling × hedge × rules
 *   confidence); impact and direction from the rule set; noise =
 *   single-source noise ^ independent sources. Priority and bands are read-time.
 */
import { z } from "zod";
import type { ClassifierRuleSet } from "../classifier/sports-headline.js";
import { clusterItems, type ClusterInputItem, type ItemCluster } from "../clustering/item-clusters.js";
import { SpineSignalTypeCodeSchema } from "../schemas/spine.js";

export const SYNTHESIS_VERSION = "signals-synthesis@0.1.0";

const ENTITY_KIND_RANK: Record<string, number> = { set: 0, product: 1, card: 2, pokemon: 3 };

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

export type SynthesisItem = ClusterInputItem & {
  hedged: boolean;
  rawDocumentId: string;
  provMethod: "inferred" | "opinion";
};

export type SynthesisCandidate = {
  eventKey: string;
  kind: "solo" | "cluster";
  theme: z.infer<typeof SpineSignalTypeCodeSchema>;
  entity: ItemCluster["entity"] | null;
  title: string;
  anchor: SynthesisItem;
  items: SynthesisItem[];
  independentSourceCount: number;
  groups: string[];
  scores: { baseConfidence: number; baseImpact: number; noiseProbability: number; direction: string };
  provMethod: "inferred" | "opinion";
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function keyEntity(e: ItemCluster["entity"] | null): string {
  return e ? `${e.kind}:${e.normalizedKey}` : "item";
}

function bestEntity(item: SynthesisItem): ItemCluster["entity"] | null {
  const sorted = [...item.entities].sort(
    (a, b) => (ENTITY_KIND_RANK[a.kind] ?? 9) - (ENTITY_KIND_RANK[b.kind] ?? 9) || a.normalizedKey.localeCompare(b.normalizedKey),
  );
  const e = sorted[0];
  return e ? { kind: e.kind, normalizedKey: e.normalizedKey, mention: e.mention, entityRef: e.entityRef } : null;
}

export function planSynthesis(
  items: ReadonlyArray<SynthesisItem>,
  opts: {
    at: Date;
    profile: SynthesisProfile;
    rules: ClassifierRuleSet;
    /** seed_confidence_ceiling per source key. */
    ceilings: Readonly<Record<string, number>>;
  },
): SynthesisCandidate[] {
  const { profile, rules } = opts;
  const typeEntry = (theme: string) =>
    (rules.types as Record<string, { direction: string; impact: { unknown: number } } | undefined>)[theme];
  const byId = new Map(items.map((i) => [i.id, i]));
  const eligible = items.filter((i) => i.theme && !profile.neverThemes.includes(i.theme as never) && typeEntry(i.theme));
  const confidence = (i: SynthesisItem) =>
    (opts.ceilings[i.sourceKey] ?? 0) * (i.hedged ? rules.scoring.hedgeFactor : 1) * rules.scoring.rulesConfidence;

  const build = (kind: "solo" | "cluster", theme: string, entity: ItemCluster["entity"] | null, members: SynthesisItem[]): SynthesisCandidate => {
    const sorted = [...members].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const anchor = sorted[0]!;
    const groups = [...new Set(sorted.map((m) => m.group))].sort();
    const type = typeEntry(theme)!;
    return {
      eventKey: `synth:${theme}:${keyEntity(entity)}:${anchor.id}`,
      kind,
      theme: theme as SynthesisCandidate["theme"],
      entity,
      title: kind === "solo" ? anchor.title : `${entity?.mention ?? anchor.title}: ${sorted.length} reports`,
      anchor,
      items: sorted,
      independentSourceCount: groups.length,
      groups,
      scores: {
        baseConfidence: round3(Math.max(...sorted.map(confidence))),
        baseImpact: round3(type.impact.unknown),
        noiseProbability: round3(rules.scoring.singleSourceNoise ** groups.length),
        direction: type.direction,
      },
      provMethod: sorted.every((m) => m.provMethod === "opinion") ? "opinion" : "inferred",
    };
  };

  const clusters = clusterItems(eligible, { at: opts.at, windowHours: profile.windowHours, minItems: profile.minClusterItems }).sort(
    (a, b) =>
      b.independentSourceCount - a.independentSourceCount ||
      b.mentionCount - a.mentionCount ||
      (ENTITY_KIND_RANK[a.entity.kind] ?? 9) - (ENTITY_KIND_RANK[b.entity.kind] ?? 9) ||
      a.entity.normalizedKey.localeCompare(b.entity.normalizedKey),
  );
  const claimed = new Set<string>();
  const out: SynthesisCandidate[] = [];
  for (const c of clusters) {
    const free = c.items.map((m) => byId.get(m.id)!).filter((m) => !claimed.has(m.id));
    if (free.length < profile.minClusterItems) continue;
    free.forEach((m) => claimed.add(m.id));
    out.push(build("cluster", c.theme, c.entity, free));
  }

  const start = opts.at.getTime() - profile.windowHours * 3600_000;
  for (const i of eligible) {
    if (claimed.has(i.id)) continue;
    const t = new Date(i.at).getTime();
    if (t < start || t > opts.at.getTime()) continue;
    if (!profile.officialSources.includes(i.sourceKey) || !profile.soloThemes.includes(i.theme as never)) continue;
    out.push(build("solo", i.theme!, bestEntity(i), [i]));
  }
  return out;
}
