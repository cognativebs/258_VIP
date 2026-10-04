/**
 * Source-item clustering onto spine events (pure). Operator decisions
 * 2026-10-04 (PokéBeach connector step 6):
 * - An item joins an existing event only when both carry the same signal type,
 *   share a set or card entity_ref, and the item was published within 72 hours
 *   of the event's first item. Pokémon species (pokemon:dex:N) and product
 *   types (product:etb) name categories, not one thing, so they never cluster.
 * - The first event wins: a later item is attached as evidence and nothing is
 *   moved or merged.
 * - Independence: one group per outlet for official news (two staff writers
 *   are one source), one group per member for community activity, and comment
 *   threads are DISCUSSION, which never corroborates.
 * Grouping is inferred · unverified until a person confirms it.
 */
import { z } from "zod";
import { EntityKindSchema } from "../entities/pokemon-entities.js";
import type { EvidenceRole } from "../schemas/spine.js";

export const ITEM_CLUSTER_VERSION = "item-clusters@0.1.0";
export const CLUSTER_WINDOW_HOURS = 72;
export const CLUSTER_ENTITY_KINDS = ["set", "card"] as const;

export const SourceItemKindSchema = z.enum(["article", "thread", "forum_post", "member_activity"]);
export type SourceItemKind = z.infer<typeof SourceItemKindSchema>;

export const ClusterEntitySchema = z
  .object({
    kind: EntityKindSchema,
    entityRef: z.string().min(1).nullable(),
  })
  .strict();
export type ClusterEntity = z.infer<typeof ClusterEntitySchema>;

export const ClusterItemSchema = z
  .object({
    signalType: z.string().min(1),
    publishedAt: z.string().datetime(),
    keys: z.array(z.string().min(1)),
  })
  .strict();
export type ClusterItem = z.infer<typeof ClusterItemSchema>;

export const ExistingClusterSchema = z
  .object({
    eventId: z.string().uuid(),
    eventType: z.string().min(1),
    /** Publish time of the event's first item; the window is measured from here so a cluster never drifts. */
    anchorPublishedAt: z.string().datetime(),
    keys: z.array(z.string().min(1)),
  })
  .strict();
export type ExistingCluster = z.infer<typeof ExistingClusterSchema>;

/** Identity-bearing references only: matched sets and cards. */
export function clusterKeys(entities: ReadonlyArray<ClusterEntity>): string[] {
  const kinds: ReadonlySet<string> = new Set(CLUSTER_ENTITY_KINDS);
  return [...new Set(entities.filter((e) => e.entityRef && kinds.has(e.kind)).map((e) => e.entityRef!))].sort();
}

/**
 * The event this item joins, or null when it starts a new one. Among matches
 * the earliest anchor wins (then the lowest id), so the result does not
 * depend on query order.
 */
export function pickCluster(item: ClusterItem, clusters: ReadonlyArray<ExistingCluster>): ExistingCluster | null {
  if (!item.keys.length) return null;
  const at = Date.parse(item.publishedAt);
  const windowMs = CLUSTER_WINDOW_HOURS * 3600 * 1000;
  const keys = new Set(item.keys);
  const matches = clusters.filter(
    (c) =>
      c.eventType === item.signalType &&
      Math.abs(at - Date.parse(c.anchorPublishedAt)) <= windowMs &&
      c.keys.some((k) => keys.has(k)),
  );
  matches.sort((a, b) => Date.parse(a.anchorPublishedAt) - Date.parse(b.anchorPublishedAt) || a.eventId.localeCompare(b.eventId));
  return matches[0] ?? null;
}

export function evidenceRoleFor(kind: SourceItemKind): EvidenceRole {
  return kind === "thread" ? "DISCUSSION" : "PRIMARY";
}

/** independent_source_count counts these groups on PRIMARY rows. null for DISCUSSION. */
export function independenceGroupFor(item: {
  sourceId: string;
  kind: SourceItemKind;
  authorRef: string | null;
  authorName: string | null;
}): string | null {
  if (item.kind === "thread") return null;
  if (item.kind === "article") return item.sourceId;
  const handle = item.authorRef ?? item.authorName;
  if (!handle) throw new Error(`${item.kind} item from ${item.sourceId} has no author; a member post needs one to count as independent`);
  return `${item.sourceId}:member:${handle}`;
}
