/**
 * Read-time clusters over source items (PokéBeach connector step 6). Items in
 * the window, their entities from the current extractor, and a theme from the
 * current collectibles-headline rules are grouped by entity + theme. Nothing
 * is stored; reading twice at the same time gives the same answer.
 */
import { z } from "zod";
import {
  CLUSTERING_VERSION,
  POKEMON_ENTITY_EXTRACTOR_VERSION,
  clusterItems,
  compileRuleSet,
  decideByRules,
  independenceGroup,
  type ClusterInputItem,
} from "@vip/signals";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const ClustersQuerySchema = z
  .object({
    at: z.string().datetime({ offset: true }).optional(),
    windowHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
    minItems: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

const THEME_RULE_SET = "collectibles-headline";

export async function buildClusters(
  db: Queryable,
  opts: { at?: Date; windowHours?: number; minItems?: number } = {},
) {
  const at = opts.at ?? new Date();
  const windowHours = opts.windowHours ?? 72;
  const rs = await db.query(
    `SELECT version, rules_json FROM vault_core.signals_classifier_rule_set WHERE name = $1 AND is_current`,
    [THEME_RULE_SET],
  );
  if (!rs.rows[0]) throw new Error(`no current ${THEME_RULE_SET} rule set`);
  const rules = compileRuleSet(rs.rows[0].rules_json);

  const rows = await db.query(
    `SELECT i.id, i.source_id, i.canonical_url, i.title, i.excerpt,
            coalesce(i.published_at, i.first_seen_at) AS at,
            e.entity_kind, e.normalized_key, e.mention, e.entity_ref
       FROM vault_signals.source_item i
       JOIN vault_signals.source_item_entity e
         ON e.source_item_id = i.id AND e.content_hash = i.content_hash AND e.extractor_version = $3
      WHERE coalesce(i.published_at, i.first_seen_at) > $1::timestamptz - make_interval(hours => $2)
        AND coalesce(i.published_at, i.first_seen_at) <= $1::timestamptz
      ORDER BY i.id`,
    [at.toISOString(), windowHours, POKEMON_ENTITY_EXTRACTOR_VERSION],
  );

  const items = new Map<string, ClusterInputItem>();
  let noise = 0;
  for (const r of rows.rows) {
    let item = items.get(r.id);
    if (!item) {
      const decision = decideByRules({ title: r.title, description: r.excerpt }, rules);
      if (decision.outcome === "noise") {
        noise += 1;
        items.set(r.id, { id: r.id, sourceKey: r.source_id, group: "", title: "", url: "", at: "", theme: null, entities: [] });
        continue;
      }
      item = {
        id: r.id,
        sourceKey: r.source_id,
        group: independenceGroup(r.source_id, r.canonical_url),
        title: r.title,
        url: r.canonical_url,
        at: new Date(r.at).toISOString(),
        theme: decision.outcome === "signal" ? decision.signalType : null,
        entities: [],
      };
      items.set(r.id, item);
    }
    if (!item.at) continue;
    item.entities.push({ kind: r.entity_kind, normalizedKey: r.normalized_key, mention: r.mention, entityRef: r.entity_ref });
  }

  const clusters = clusterItems(
    [...items.values()].filter((i) => i.at),
    { at, windowHours, minItems: opts.minItems ?? 2 },
  );
  return {
    at: at.toISOString(),
    windowHours,
    clusters,
    itemsInWindow: items.size,
    noiseItems: noise,
    provenance: {
      method: "read_time_clustering",
      ruleVersion: `${CLUSTERING_VERSION}; ${THEME_RULE_SET}@${rs.rows[0].version}; ${POKEMON_ENTITY_EXTRACTOR_VERSION}`,
      verificationStatus: "unverified",
      notes:
        "Clusters are recomputed on every read. independentSourceCount counts outlets (and later members or threads), never mentions: every PokéBeach route is one newsroom. A cluster is not a signal; synthesis decides what to surface.",
    },
  };
}
