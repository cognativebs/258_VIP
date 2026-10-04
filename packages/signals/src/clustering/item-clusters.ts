/**
 * Read-time clustering of source items (pure). A cluster is every item in a
 * rolling window that mentions the same entity under the same theme. Nothing
 * is stored: clusters are recomputed whenever they are read, like priority and
 * decay. Corroboration is independent_source_count — distinct independence
 * groups (an outlet; later a member or a thread) — never the mention count:
 * five articles from one newsroom are one source.
 */
import { z } from "zod";
import { EntityKindSchema } from "../entities/pokemon-entities.js";

export const CLUSTERING_VERSION = "item-clusters@0.1.0";
export const NO_THEME = "UNCLASSIFIED";

export type ClusterInputItem = {
  id: string;
  sourceKey: string;
  /** Independence group: who could have said this independently (outlet, member, thread). */
  group: string;
  title: string;
  url: string;
  /** Publish time when known, else first-seen; used for the window. */
  at: string;
  theme: string | null;
  entities: { kind: z.infer<typeof EntityKindSchema>; normalizedKey: string; mention: string; entityRef: string | null }[];
};

export const ItemClusterSchema = z
  .object({
    entity: z
      .object({ kind: EntityKindSchema, normalizedKey: z.string(), mention: z.string(), entityRef: z.string().nullable() })
      .strict(),
    theme: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    mentionCount: z.number().int().positive(),
    independentSourceCount: z.number().int().positive(),
    groups: z.array(z.string()),
    sources: z.array(z.string()),
    firstAt: z.string(),
    lastAt: z.string(),
    corroboration: z.enum(["single_source", "corroborated"]),
    items: z.array(
      z
        .object({ id: z.string(), sourceKey: z.string(), group: z.string(), title: z.string(), url: z.string(), at: z.string() })
        .strict(),
    ),
  })
  .strict();
export type ItemCluster = z.infer<typeof ItemClusterSchema>;

export type ClusterOptions = {
  at: Date;
  windowHours?: number;
  /** Smallest cluster returned. One item is not a cluster. */
  minItems?: number;
  /** Generic entities that would tie unrelated items together. */
  excludeEntityKeys?: ReadonlyArray<string>;
};

/** Product types that appear in many unrelated headlines; clustering on them would merge everything. */
export const DEFAULT_EXCLUDED_ENTITY_KEYS: ReadonlyArray<string> = ["product:promo", "product:accessory"];

export function clusterItems(items: ReadonlyArray<ClusterInputItem>, opts: ClusterOptions): ItemCluster[] {
  const windowHours = opts.windowHours ?? 72;
  const end = opts.at.getTime();
  const start = end - windowHours * 3600_000;
  const excluded = new Set(opts.excludeEntityKeys ?? DEFAULT_EXCLUDED_ENTITY_KEYS);
  const buckets = new Map<string, { entity: ClusterInputItem["entities"][number]; theme: string; items: ClusterInputItem[] }>();

  for (const item of items) {
    const t = new Date(item.at).getTime();
    if (Number.isNaN(t) || t < start || t > end) continue;
    const theme = item.theme ?? NO_THEME;
    const seen = new Set<string>();
    for (const e of item.entities) {
      const ek = `${e.kind}:${e.normalizedKey}`;
      if (excluded.has(ek) || seen.has(ek)) continue;
      seen.add(ek);
      const key = `${ek}|${theme}`;
      const b = buckets.get(key) ?? { entity: e, theme, items: [] };
      // Prefer a mention that carries an IQVault identity.
      if (!b.entity.entityRef && e.entityRef) b.entity = e;
      b.items.push(item);
      buckets.set(key, b);
    }
  }

  const out: ItemCluster[] = [];
  for (const b of buckets.values()) {
    if (b.items.length < (opts.minItems ?? 2)) continue;
    const sorted = [...b.items].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
    const groups = [...new Set(sorted.map((i) => i.group))].sort();
    out.push(
      ItemClusterSchema.parse({
        entity: { kind: b.entity.kind, normalizedKey: b.entity.normalizedKey, mention: b.entity.mention, entityRef: b.entity.entityRef },
        theme: b.theme,
        windowStart: new Date(start).toISOString(),
        windowEnd: new Date(end).toISOString(),
        mentionCount: sorted.length,
        independentSourceCount: groups.length,
        groups,
        sources: [...new Set(sorted.map((i) => i.sourceKey))].sort(),
        firstAt: sorted[0]!.at,
        lastAt: sorted.at(-1)!.at,
        corroboration: groups.length > 1 ? "corroborated" : "single_source",
        items: sorted.map(({ id, sourceKey, group, title, url, at }) => ({ id, sourceKey, group, title, url, at })),
      }),
    );
  }
  return out.sort(
    (a, b) =>
      b.independentSourceCount - a.independentSourceCount ||
      b.mentionCount - a.mentionCount ||
      b.lastAt.localeCompare(a.lastAt) ||
      `${a.entity.normalizedKey}|${a.theme}`.localeCompare(`${b.entity.normalizedKey}|${b.theme}`),
  );
}

/** Hosts that carry many independent voices; there the channel (source key) is the voice, not the host. */
const PLATFORM_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be"]);

/**
 * Who counts as independent: the publishing outlet, by host. Every PokéBeach
 * route (homepage, community feed, a GDELT pickup) is pokebeach.com, one
 * newsroom. On a platform such as YouTube the channel is the voice. Tracked
 * members (later) group by author.
 */
export function independenceGroup(sourceKey: string, url: string | null): string {
  if (!url) return sourceKey;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return PLATFORM_HOSTS.has(host) ? sourceKey : host;
  } catch {
    return sourceKey;
  }
}
