/**
 * PokéBeach connector step 6: classify official items and cluster them onto
 * spine events (operator decisions 2026-10-04).
 *
 * Each article whose entities are extracted at its current version is
 * classified by the current collectibles-headline rules (title + publisher
 * summary). A signal either starts an event (one event, one PRIMARY evidence
 * row, one signal, as the headline classifiers write) or joins the earliest
 * event of the same type that shares a set or card reference within 72 hours.
 * A joining item adds a PRIMARY evidence row only: no second signal, nothing
 * moved. All official articles share one independence group, so a cluster of
 * PokéBeach articles still counts as one source. Linked comment threads are
 * added as DISCUSSION rows when the forum RSS snapshot that lists them is on
 * disk. Noise and no-signal items leave no row and are re-read next run (the
 * rules are deterministic). Nothing here writes vault_market.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  ITEM_CLUSTER_VERSION,
  POKEMON_ENTITY_EXTRACTOR_VERSION,
  ClusterEntitySchema,
  SourceItemKindSchema,
  clusterKeys,
  compileRuleSet,
  decideByRules,
  evidenceRoleFor,
  independenceGroupFor,
  parseForumThreads,
  pickCluster,
  scoreDecision,
} from "@vip/signals";
import { STATE_DIR } from "./espn-sports.js";
import { FORUM_RSS, OFFICIAL, type Queryable } from "./pokebeach.js";
import { snapshotPathFor } from "./sports-classifier.js";

export const POKEBEACH_CLUSTER_JOB_VERSION = "pokebeach-cluster@0.1.0";
const RULE_SET = "collectibles-headline";

export type ClusterReport = {
  job: "pokebeach-cluster";
  version: typeof POKEBEACH_CLUSTER_JOB_VERSION;
  ruleSet: string;
  items: {
    read: number;
    noise: number;
    noSignal: number;
    noRawDocument: number;
    eventsCreated: number;
    joined: number;
  };
  discussionLinked: number;
  byType: Record<string, number>;
};

const iso = (d: Date | string) => new Date(d).toISOString();

export async function clusterPokebeachItems(
  db: Queryable,
  opts: { sourceKey?: string; limit?: number; stateDir?: string; now?: Date } = {},
): Promise<ClusterReport> {
  const sourceKey = opts.sourceKey ?? OFFICIAL;
  const now = opts.now ?? new Date();
  const rs = await db.query(`SELECT version, rules_json FROM vault_core.signals_classifier_rule_set WHERE name = $1 AND is_current`, [RULE_SET]);
  if (!rs.rows[0]) throw new Error(`no current ${RULE_SET} rule set (apply 20261001_03)`);
  const compiled = compileRuleSet(rs.rows[0].rules_json);
  const ruleSetVersion = `${RULE_SET}@${rs.rows[0].version}`;
  const src = await db.query(`SELECT display_name, seed_confidence_ceiling FROM vault_core.signals_news_source WHERE source_key = $1`, [sourceKey]);
  if (!src.rows[0]) throw new Error(`${sourceKey} row missing (apply 20261003_01)`);
  const ceiling = Number(src.rows[0].seed_confidence_ceiling);
  const ws = await db.query(`SELECT id FROM vault_signals.score_weight_set WHERE is_current`);
  if (!ws.rows[0]) throw new Error("no current score_weight_set (apply 20260924_01)");
  const types = new Map((await db.query(`SELECT id, code FROM vault_signals.signal_type`)).rows.map((r) => [r.code as string, r.id as string]));

  const report: ClusterReport = {
    job: "pokebeach-cluster",
    version: POKEBEACH_CLUSTER_JOB_VERSION,
    ruleSet: ruleSetVersion,
    items: { read: 0, noise: 0, noSignal: 0, noRawDocument: 0, eventsCreated: 0, joined: 0 },
    discussionLinked: 0,
    byType: {},
  };

  const pending = await db.query(
    `SELECT i.id, i.item_kind, i.external_id, i.canonical_url, i.title, i.excerpt, i.author_name, i.author_ref,
            i.published_at, i.published_at_source, i.first_seen_at, i.content_hash,
            (SELECT r.raw_document_id FROM vault_signals.source_item_revision r
              WHERE r.source_item_id = i.id AND r.raw_document_id IS NOT NULL
              ORDER BY r.observed_at, r.id LIMIT 1) AS raw_document_id
       FROM vault_signals.source_item i
      WHERE i.source_id = $1 AND i.item_kind = 'article' AND i.published_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM vault_signals.source_item_extraction x
                     WHERE x.source_item_id = i.id AND x.content_hash = i.content_hash AND x.extractor_version = $2)
        AND NOT EXISTS (SELECT 1 FROM vault_signals.event_evidence ee
                         WHERE ee.source_item_id = i.id AND ee.role = 'PRIMARY')
      ORDER BY i.published_at, i.id
      LIMIT $3`,
    [sourceKey, POKEMON_ENTITY_EXTRACTOR_VERSION, opts.limit ?? 500],
  );

  for (const item of pending.rows) {
    report.items.read += 1;
    const decision = decideByRules({ title: item.title, description: item.excerpt }, compiled);
    if (decision.outcome === "noise") {
      report.items.noise += 1;
      continue;
    }
    if (decision.outcome === "no_signal") {
      report.items.noSignal += 1;
      continue;
    }
    if (!item.raw_document_id) {
      report.items.noRawDocument += 1;
      continue;
    }
    const entities = await db.query(
      `SELECT entity_kind AS kind, entity_ref AS "entityRef" FROM vault_signals.source_item_entity
        WHERE source_item_id = $1 AND content_hash = $2 AND extractor_version = $3`,
      [item.id, item.content_hash, POKEMON_ENTITY_EXTRACTOR_VERSION],
    );
    const keys = clusterKeys(entities.rows.map((r) => ClusterEntitySchema.parse(r)));
    const publishedAt = iso(item.published_at);
    const kind = SourceItemKindSchema.parse(item.item_kind);
    const evidence = {
      role: evidenceRoleFor(kind),
      group: independenceGroupFor({ sourceId: sourceKey, kind, authorRef: item.author_ref, authorName: item.author_name }),
      itemRef: item.external_id ?? item.id,
    };

    const candidates = await db.query(
      `SELECT e.id, e.event_type, min(i.published_at) AS anchor,
              coalesce(array_agg(DISTINCT se.entity_ref) FILTER (WHERE se.entity_ref IS NOT NULL), '{}') AS keys
         FROM vault_signals.event e
         JOIN vault_signals.event_evidence ee ON ee.event_id = e.id AND ee.role = 'PRIMARY' AND ee.source_item_id IS NOT NULL
         JOIN vault_signals.source_item i ON i.id = ee.source_item_id AND i.source_id = $1
         LEFT JOIN vault_signals.source_item_entity se
                ON se.source_item_id = i.id AND se.content_hash = i.content_hash AND se.entity_kind IN ('set', 'card')
        WHERE e.event_type = $2
        GROUP BY e.id, e.event_type
       HAVING min(i.published_at) BETWEEN $3::timestamptz - interval '72 hours' AND $3::timestamptz + interval '72 hours'`,
      [sourceKey, decision.signalType, publishedAt],
    );
    const cluster = pickCluster(
      { signalType: decision.signalType, publishedAt, keys },
      candidates.rows.map((r) => ({ eventId: r.id, eventType: r.event_type, anchorPublishedAt: iso(r.anchor), keys: r.keys })),
    );

    const insertEvidence = (eventId: string) =>
      db.query(
        `INSERT INTO vault_signals.event_evidence
           (event_id, raw_document_id, role, independence_group, detected_at, item_ref, source_item_url, source_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [eventId, item.raw_document_id, evidence.role, evidence.group, now, evidence.itemRef, item.canonical_url, item.id],
      );

    if (cluster) {
      await insertEvidence(cluster.eventId);
      report.items.joined += 1;
      continue;
    }

    const typeId = types.get(decision.signalType);
    if (!typeId) throw new Error(`signal_type ${decision.signalType} missing`);
    const scores = scoreDecision(decision, compiled.ruleSet, ceiling);
    const ruleVersion = `${ruleSetVersion}+rules+${ITEM_CLUSTER_VERSION}`;
    const notes = [
      src.rows[0].display_name,
      decision.hedged ? "hedged" : null,
      decision.evidence,
      keys.length ? `cluster keys ${keys.join(", ")}` : "no set or card reference: never clusters",
      `published_at from ${item.published_at_source}`,
      item.canonical_url,
    ]
      .filter(Boolean)
      .join(" · ");
    const event = await db.query(
      `INSERT INTO vault_signals.event (
         event_key, title, first_seen_at, event_type, primary_origin_document_id,
         prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, 'inferred', $7, $8, 'unverified', $9)
       RETURNING id`,
      [`${sourceKey}:${evidence.itemRef}`, item.title, item.first_seen_at, decision.signalType, item.raw_document_id, sourceKey, ruleVersion, scores.baseConfidence, notes],
    );
    const eventId: string = event.rows[0].id;
    await insertEvidence(eventId);
    await db.query(
      `INSERT INTO vault_signals.signal (
         signal_type_id, domain, title, summary, direction, first_seen_at, event_id,
         base_confidence, base_impact, noise_probability, score_weight_set_id, created_by_version,
         prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'inferred', $14, $15, 'unverified', $16)`,
      [
        typeId,
        compiled.ruleSet.domain,
        item.title,
        item.excerpt ?? item.title,
        scores.direction,
        item.first_seen_at,
        eventId,
        scores.baseConfidence,
        scores.baseImpact,
        scores.noiseProbability,
        ws.rows[0].id,
        POKEBEACH_CLUSTER_JOB_VERSION,
        sourceKey,
        ruleVersion,
        decision.classifierConfidence,
        notes,
      ],
    );
    report.items.eventsCreated += 1;
    report.byType[decision.signalType] = (report.byType[decision.signalType] ?? 0) + 1;
  }

  report.discussionLinked = await linkDiscussionThreads(db, sourceKey, opts.stateDir ?? STATE_DIR, now);
  return report;
}

/**
 * A DISCUSSION row cites the forum RSS snapshot that lists the thread, so it
 * needs that snapshot on disk; until then the item is retried next run.
 */
async function linkDiscussionThreads(db: Queryable, sourceKey: string, stateDir: string, now: Date): Promise<number> {
  const open = await db.query(
    `SELECT ee.event_id, i.id AS source_item_id, i.discussion_url
       FROM vault_signals.event_evidence ee
       JOIN vault_signals.source_item i ON i.id = ee.source_item_id
      WHERE ee.role = 'PRIMARY' AND i.source_id = $1 AND i.discussion_url IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vault_signals.event_evidence d
                         WHERE d.source_item_id = i.id AND d.role = 'DISCUSSION')`,
    [sourceKey],
  );
  if (!open.rows.length) return 0;
  const feeds = await db.query(
    `SELECT d.id, s.storage_key
       FROM vault_signals.raw_document d
       JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id
      WHERE d.source_id = $1
      ORDER BY d.fetched_at DESC, d.id DESC
      LIMIT 20`,
    [FORUM_RSS],
  );
  const threadDoc = new Map<string, string>();
  for (const f of [...feeds.rows].reverse()) {
    const path = snapshotPathFor(f.storage_key, stateDir);
    if (!existsSync(path)) continue;
    for (const t of parseForumThreads(readFileSync(path, "utf8"))) threadDoc.set(t.url, f.id);
  }
  let linked = 0;
  for (const r of open.rows) {
    const docId = threadDoc.get(r.discussion_url);
    if (!docId) continue;
    await db.query(
      `INSERT INTO vault_signals.event_evidence
         (event_id, raw_document_id, role, independence_group, detected_at, item_ref, source_item_url, source_item_id)
       VALUES ($1, $2, 'DISCUSSION', NULL, $3, NULL, $4, $5)
       ON CONFLICT DO NOTHING`,
      [r.event_id, docId, now, r.discussion_url, r.source_item_id],
    );
    linked += 1;
  }
  return linked;
}

export function formatClusterReport(r: ClusterReport): string {
  const types = Object.entries(r.byType)
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");
  return [
    `VIP Job — pokebeach-cluster (${r.version}) · ${r.ruleSet}`,
    `items read ${r.items.read} · noise ${r.items.noise} · no signal ${r.items.noSignal} · new events ${r.items.eventsCreated} · joined an event ${r.items.joined}` +
      (r.items.noRawDocument ? ` · ${r.items.noRawDocument} without a raw document (skipped)` : "") +
      (r.discussionLinked ? ` · discussion threads linked ${r.discussionLinked}` : ""),
    `new events by type: ${types || "(none)"}`,
  ].join("\n");
}
