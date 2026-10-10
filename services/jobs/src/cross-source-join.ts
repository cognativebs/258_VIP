/**
 * Cross-source corroboration (operator decision 2026-10-10): a headline from another outlet
 * (ComicsBeat, PSA, TAG, Alpha Investments, GDELT business) that names the same Pokémon set or
 * card, under the same theme, within 72 hours of an existing Pokémon event joins that event as
 * PRIMARY evidence in its own independence group — so the event's independent-source count, and
 * with it the synthesis band, can rise.
 *
 * Join only: an outlet item never starts an event here. Those outlets already get their own
 * signals from their headline classifiers, so creating events too would count one article twice.
 * Nothing here writes vault_market.
 */
import {
  ClusterEntitySchema,
  SourceItemKindSchema,
  clusterKeys,
  compileRuleSet,
  decideByRules,
  evidenceRoleFor,
  independenceGroupFor,
  pickCluster,
  POKEMON_ENTITY_EXTRACTOR_VERSION,
} from "@vip/signals";
import type { Queryable } from "./pokebeach.js";
import { INDEXED_FEED_SOURCES } from "./source-items.js";

export const CROSS_SOURCE_JOIN_VERSION = "cross-source-join@0.1.0";
const RULE_SET = "collectibles-headline";

export type CrossSourceJoinReport = {
  job: "cross-source-join";
  version: typeof CROSS_SOURCE_JOIN_VERSION;
  read: number;
  noKeys: number;
  noSignal: number;
  noMatch: number;
  joined: number;
  bySource: Record<string, number>;
};

const iso = (d: Date | string) => new Date(d).toISOString();

export async function joinOutletItems(
  db: Queryable,
  opts: { sourceKeys?: ReadonlyArray<string>; now?: Date; limit?: number } = {},
): Promise<CrossSourceJoinReport> {
  const now = opts.now ?? new Date();
  const report: CrossSourceJoinReport = {
    job: "cross-source-join",
    version: CROSS_SOURCE_JOIN_VERSION,
    read: 0,
    noKeys: 0,
    noSignal: 0,
    noMatch: 0,
    joined: 0,
    bySource: {},
  };
  const rs = await db.query(`SELECT rules_json FROM vault_core.signals_classifier_rule_set WHERE name = $1 AND is_current`, [RULE_SET]);
  if (!rs.rows[0]) return report;
  const compiled = compileRuleSet(rs.rows[0].rules_json);

  const pending = await db.query(
    `SELECT i.id, i.source_id, i.item_kind, i.external_id, i.canonical_url, i.title, i.excerpt, i.author_name, i.author_ref,
            coalesce(i.published_at, i.first_seen_at) AS at, i.content_hash,
            (SELECT r.raw_document_id FROM vault_signals.source_item_revision r
              WHERE r.source_item_id = i.id AND r.raw_document_id IS NOT NULL
              ORDER BY r.observed_at, r.id LIMIT 1) AS raw_document_id
       FROM vault_signals.source_item i
      WHERE i.source_id = ANY($1::text[]) AND i.item_kind = 'article'
        AND EXISTS (SELECT 1 FROM vault_signals.source_item_extraction x
                     WHERE x.source_item_id = i.id AND x.content_hash = i.content_hash AND x.extractor_version = $2)
        AND NOT EXISTS (SELECT 1 FROM vault_signals.event_evidence ee WHERE ee.source_item_id = i.id AND ee.role = 'PRIMARY')
        AND coalesce(i.published_at, i.first_seen_at) > $3::timestamptz - interval '14 days'
      ORDER BY 11, i.id
      LIMIT $4`,
    [[...(opts.sourceKeys ?? INDEXED_FEED_SOURCES)], POKEMON_ENTITY_EXTRACTOR_VERSION, now.toISOString(), opts.limit ?? 500],
  );

  for (const item of pending.rows) {
    report.read += 1;
    const entities = await db.query(
      `SELECT entity_kind AS kind, entity_ref AS "entityRef" FROM vault_signals.source_item_entity
        WHERE source_item_id = $1 AND content_hash = $2 AND extractor_version = $3`,
      [item.id, item.content_hash, POKEMON_ENTITY_EXTRACTOR_VERSION],
    );
    const keys = clusterKeys(entities.rows.map((r) => ClusterEntitySchema.parse(r)));
    if (!keys.length || !item.raw_document_id) {
      report.noKeys += 1;
      continue;
    }
    const decision = decideByRules({ title: item.title, description: item.excerpt }, compiled);
    if (decision.outcome !== "signal") {
      report.noSignal += 1;
      continue;
    }
    const publishedAt = iso(item.at);
    // Candidate events from any source, anchored by their earliest PRIMARY item.
    const candidates = await db.query(
      `SELECT e.id, e.event_type, min(coalesce(i.published_at, i.first_seen_at)) AS anchor,
              coalesce(array_agg(DISTINCT se.entity_ref) FILTER (WHERE se.entity_ref IS NOT NULL), '{}') AS keys
         FROM vault_signals.event e
         JOIN vault_signals.event_evidence ee ON ee.event_id = e.id AND ee.role = 'PRIMARY' AND ee.source_item_id IS NOT NULL
         JOIN vault_signals.source_item i ON i.id = ee.source_item_id
         LEFT JOIN vault_signals.source_item_entity se
                ON se.source_item_id = i.id AND se.content_hash = i.content_hash AND se.entity_kind IN ('set', 'card')
        WHERE e.event_type = $1
        GROUP BY e.id, e.event_type
       HAVING min(coalesce(i.published_at, i.first_seen_at)) BETWEEN $2::timestamptz - interval '72 hours' AND $2::timestamptz + interval '72 hours'`,
      [decision.signalType, publishedAt],
    );
    const cluster = pickCluster(
      { signalType: decision.signalType, publishedAt, keys },
      candidates.rows.map((r) => ({ eventId: r.id, eventType: r.event_type, anchorPublishedAt: iso(r.anchor), keys: r.keys })),
    );
    if (!cluster) {
      report.noMatch += 1;
      continue;
    }
    const kind = SourceItemKindSchema.parse(item.item_kind);
    await db.query(
      `INSERT INTO vault_signals.event_evidence
         (event_id, raw_document_id, role, independence_group, detected_at, item_ref, source_item_url, source_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        cluster.eventId,
        item.raw_document_id,
        evidenceRoleFor(kind),
        independenceGroupFor({ sourceId: item.source_id, kind, authorRef: item.author_ref, authorName: item.author_name }),
        now,
        item.external_id ?? item.id,
        item.canonical_url,
        item.id,
      ],
    );
    report.joined += 1;
    report.bySource[item.source_id] = (report.bySource[item.source_id] ?? 0) + 1;
  }
  return report;
}

export function formatCrossSourceJoinReport(r: CrossSourceJoinReport): string {
  const by = Object.entries(r.bySource).map(([s, n]) => `${s} ${n}`).join(", ");
  return [
    `VIP Job — cross-source-join (${r.version})`,
    `outlet items read ${r.read} · no set/card ${r.noKeys} · no signal ${r.noSignal} · no matching event ${r.noMatch} · joined ${r.joined}${by ? ` (${by})` : ""}`,
  ].join("\n");
}
