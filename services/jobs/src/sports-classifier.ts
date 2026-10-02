/**
 * Classify stored ESPN feed snapshots into SIGNALS events and signals.
 *
 * Reads raw_document rows still at extraction_status 'pending', re-parses each
 * immutable snapshot from disk, drops noise, classifies the rest (LLM when the
 * caller supplies one, keyword rules otherwise) and writes, per headline:
 * one event (event_key espn_rss:<guid>), one PRIMARY event_evidence row with
 * item_ref = guid, one signal with the three stored scores, and a player-name
 * text placeholder in signal_entity when the LLM named one. Scores come from
 * the current vault_core.signals_classifier_rule_set row and the source's
 * seed_confidence_ceiling. Nothing here writes vault_market.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LlmClassificationSchema,
  RssAdapter,
  compileRuleSet,
  decideByLlm,
  decideByRules,
  llmMessages,
  scoreDecision,
  type ClassifierRuleSet,
  type CompiledRuleSet,
  type Headline,
  type HeadlineDecision,
  type LlmClassification,
} from "@vip/signals";
import { ESPN_ATTRIBUTION, ESPN_SOURCE_KEY, STATE_DIR } from "./espn-sports.js";

export const SPORTS_CLASSIFIER_JOB_VERSION = "sports-classifier@0.1.0";
const RULE_SET_NAME = "sports-headline";
const INDEPENDENCE_GROUP = "espn";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Returns null on any failure; the rules then decide that headline. */
export type LlmClassifier = {
  model: string;
  classify: (headline: Headline, ruleSet: ClassifierRuleSet) => Promise<LlmClassification | null>;
};

export type SportsClassifierReport = {
  job: "sports-classifier";
  version: typeof SPORTS_CLASSIFIER_JOB_VERSION;
  ruleSet: string;
  method: "rules" | "llm";
  model: string | null;
  documents: { processed: number; missingSnapshot: string[] };
  items: {
    seen: number;
    alreadyClassified: number;
    quarantined: number;
    noise: number;
    noSignal: number;
    signals: number;
  };
  llm: { calls: number; failures: number };
  byType: Record<string, number>;
};

type Context = {
  compiled: CompiledRuleSet;
  ruleSetVersion: string;
  confidenceCeiling: number;
  weightSetId: string;
  signalTypeIds: Map<string, string>;
};

async function loadContext(db: Queryable): Promise<Context> {
  const rs = await db.query(
    `SELECT version, rules_json FROM vault_core.signals_classifier_rule_set WHERE name = $1 AND is_current`,
    [RULE_SET_NAME],
  );
  if (!rs.rows[0]) throw new Error(`no current ${RULE_SET_NAME} rule set (apply 20261001_01)`);
  const src = await db.query(
    `SELECT seed_confidence_ceiling FROM vault_core.signals_news_source WHERE source_key = $1`,
    [ESPN_SOURCE_KEY],
  );
  if (!src.rows[0]) throw new Error(`${ESPN_SOURCE_KEY} source row missing (apply 20260920_06)`);
  const ws = await db.query(`SELECT id FROM vault_signals.score_weight_set WHERE is_current`);
  if (!ws.rows[0]) throw new Error("no current score_weight_set (apply 20260924_01)");
  const types = await db.query(`SELECT id, code FROM vault_signals.signal_type`);
  return {
    compiled: compileRuleSet(rs.rows[0].rules_json),
    ruleSetVersion: `${RULE_SET_NAME}@${rs.rows[0].version}`,
    confidenceCeiling: Number(src.rows[0].seed_confidence_ceiling),
    weightSetId: ws.rows[0].id,
    signalTypeIds: new Map(types.rows.map((r) => [r.code as string, r.id as string])),
  };
}

/** storage_key is "jobs/.state/<path under STATE_DIR>". */
export function snapshotPathFor(storageKey: string, stateDir: string): string {
  return join(stateDir, storageKey.replace(/^jobs\/\.state\//, ""));
}

const sportFromKey = (storageKey: string) => /snapshots\/espn\/([a-z]+)\//.exec(storageKey)?.[1] ?? "unknown";

function parseFile(path: string, url: string, fetchedAt: Date, stateDir: string) {
  const rawXml = readFileSync(path, "utf8");
  return new RssAdapter({ feedUrl: "", sourceId: ESPN_SOURCE_KEY, rateLimitMs: 0, snapshotDir: stateDir }).parseSnapshot({
    url,
    fetchedAt: fetchedAt.toISOString(),
    rawXml,
    snapshotPath: path,
    byteLength: Buffer.byteLength(rawXml, "utf8"),
  });
}

export async function classifyPendingEspnDocuments(
  db: Queryable,
  opts: { stateDir?: string; llm?: LlmClassifier | null } = {},
): Promise<SportsClassifierReport> {
  const stateDir = opts.stateDir ?? STATE_DIR;
  const llm = opts.llm ?? null;
  const ctx = await loadContext(db);
  const report: SportsClassifierReport = {
    job: "sports-classifier",
    version: SPORTS_CLASSIFIER_JOB_VERSION,
    ruleSet: ctx.ruleSetVersion,
    method: llm ? "llm" : "rules",
    model: llm?.model ?? null,
    documents: { processed: 0, missingSnapshot: [] },
    items: { seen: 0, alreadyClassified: 0, quarantined: 0, noise: 0, noSignal: 0, signals: 0 },
    llm: { calls: 0, failures: 0 },
    byType: {},
  };

  const docs = await db.query(
    `SELECT d.id, d.fetched_at, d.source_url, s.storage_key
       FROM vault_signals.raw_document d
       JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id
      WHERE d.source_id = $1 AND d.extraction_status = 'pending'
      ORDER BY d.fetched_at, d.id`,
    [ESPN_SOURCE_KEY],
  );

  // Headlines that produced no signal leave no row, so remember what was already classified:
  // every guid seen this run, plus the guids in each feed's last extracted snapshot.
  const classifiedGuids = new Set<string>();
  const primedFeeds = new Set<string>();

  for (const doc of docs.rows) {
    const path = snapshotPathFor(doc.storage_key, stateDir);
    if (!existsSync(path)) {
      // Stays pending: the immutable snapshot lives in another checkout (set VIP_JOBS_STATE_DIR).
      report.documents.missingSnapshot.push(doc.storage_key);
      continue;
    }
    const fetchedAt = new Date(doc.fetched_at);
    if (!primedFeeds.has(doc.source_url)) {
      primedFeeds.add(doc.source_url);
      const prior = await db.query(
        `SELECT s.storage_key
           FROM vault_signals.raw_document d
           JOIN vault_signals.document_snapshot s ON s.raw_document_id = d.id
          WHERE d.source_id = $1 AND d.source_url = $2 AND d.extraction_status = 'extracted'
          ORDER BY d.fetched_at DESC, d.id DESC
          LIMIT 1`,
        [ESPN_SOURCE_KEY, doc.source_url],
      );
      const priorPath = prior.rows[0] ? snapshotPathFor(prior.rows[0].storage_key, stateDir) : null;
      if (priorPath && existsSync(priorPath)) {
        for (const item of parseFile(priorPath, doc.source_url, fetchedAt, stateDir)) classifiedGuids.add(item.guid);
      }
    }
    const items = parseFile(path, doc.source_url, fetchedAt, stateDir);
    const sport = sportFromKey(doc.storage_key);

    for (const item of items) {
      report.items.seen += 1;
      if (item.quarantineStatus !== "active") {
        report.items.quarantined += 1;
        continue;
      }
      if (classifiedGuids.has(item.guid)) {
        report.items.alreadyClassified += 1;
        continue;
      }
      classifiedGuids.add(item.guid);
      const eventKey = `${ESPN_SOURCE_KEY}:${item.guid}`;
      const existing = await db.query(`SELECT 1 FROM vault_signals.event WHERE event_key = $1`, [eventKey]);
      if (existing.rows.length) {
        report.items.alreadyClassified += 1;
        continue;
      }
      const headline: Headline = { title: item.title, description: item.body === item.title ? null : item.body };
      let decision: HeadlineDecision = decideByRules(headline, ctx.compiled);
      let modelTag = "rules";
      if (llm && decision.outcome !== "noise") {
        report.llm.calls += 1;
        const out = await llm.classify(headline, ctx.compiled.ruleSet);
        if (out) {
          decision = decideByLlm(headline, ctx.compiled, out);
          modelTag = `llm:${llm.model}`;
        } else {
          report.llm.failures += 1;
        }
      }
      if (decision.outcome === "noise") {
        report.items.noise += 1;
        continue;
      }
      if (decision.outcome === "no_signal") {
        report.items.noSignal += 1;
        continue;
      }

      const scores = scoreDecision(decision, ctx.compiled.ruleSet, ctx.confidenceCeiling);
      const typeId = ctx.signalTypeIds.get(decision.signalType);
      if (!typeId) throw new Error(`signal_type ${decision.signalType} missing (apply 20261001_01)`);
      const ruleVersion = `${ctx.ruleSetVersion}+${modelTag}`;
      const notes = [
        ESPN_ATTRIBUTION,
        sport,
        decision.severity ? `severity ${decision.severity}` : null,
        decision.hedged ? "hedged" : null,
        decision.evidence,
        item.sourceUrl,
      ]
        .filter(Boolean)
        .join(" · ");

      const event = await db.query(
        `INSERT INTO vault_signals.event (
           event_key, title, first_seen_at, event_type, primary_origin_document_id,
           prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
         ) VALUES ($1, $2, $3, $4, $5, $6, 'inferred', $7, $8, 'unverified', $9)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING id`,
        [eventKey, item.title, fetchedAt, decision.signalType, doc.id, ESPN_SOURCE_KEY, ruleVersion, scores.baseConfidence, notes],
      );
      if (!event.rows[0]) {
        report.items.alreadyClassified += 1;
        continue;
      }
      const eventId: string = event.rows[0].id;
      await db.query(
        `INSERT INTO vault_signals.event_evidence
           (event_id, raw_document_id, role, independence_group, detected_at, item_ref, source_item_url)
         VALUES ($1, $2, 'PRIMARY', $3, $4, $5, $6)`,
        [eventId, doc.id, INDEPENDENCE_GROUP, fetchedAt, item.guid, item.sourceUrl],
      );
      const signal = await db.query(
        `INSERT INTO vault_signals.signal (
           signal_type_id, domain, title, summary, direction, first_seen_at, event_id,
           base_confidence, base_impact, noise_probability, score_weight_set_id, created_by_version,
           prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
         ) VALUES ($1, 'sports_cards', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'inferred', $13, $14, 'unverified', $15)
         RETURNING id`,
        [
          typeId,
          item.title,
          item.body,
          scores.direction,
          fetchedAt,
          eventId,
          scores.baseConfidence,
          scores.baseImpact,
          scores.noiseProbability,
          ctx.weightSetId,
          SPORTS_CLASSIFIER_JOB_VERSION,
          ESPN_SOURCE_KEY,
          ruleVersion,
          decision.classifierConfidence,
          notes,
        ],
      );
      if (decision.subjectName) {
        // Text placeholder until the entity layer exists (P7). Not a key into anything.
        await db.query(
          `INSERT INTO vault_signals.signal_entity (signal_id, entity_ref, entity_kind)
           VALUES ($1, $2, 'player_name_text')
           ON CONFLICT DO NOTHING`,
          [signal.rows[0].id, decision.subjectName],
        );
      }
      report.items.signals += 1;
      report.byType[decision.signalType] = (report.byType[decision.signalType] ?? 0) + 1;
    }

    await db.query(`UPDATE vault_signals.raw_document SET extraction_status = 'extracted' WHERE id = $1`, [doc.id]);
    report.documents.processed += 1;
  }
  return report;
}

/** OpenAI chat completions in JSON mode, as scan-ingest does. Any failure returns null. */
export function openAiClassifier(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): LlmClassifier {
  const model = opts.model ?? "gpt-4o-mini";
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    model,
    async classify(headline, ruleSet) {
      const { system, user } = llmMessages(headline, ruleSet);
      try {
        const res = await doFetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const parsed = LlmClassificationSchema.safeParse(JSON.parse(body.choices?.[0]?.message?.content ?? "{}"));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

export function formatSportsClassifierReport(r: SportsClassifierReport): string {
  const types = Object.entries(r.byType)
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");
  return [
    `VIP Job — sports-classifier (${r.method}${r.model ? ` ${r.model}` : ""}) · ${r.ruleSet}`,
    `documents: ${r.documents.processed} processed, ${r.documents.missingSnapshot.length} missing snapshot`,
    ...r.documents.missingSnapshot.map((k) => `  missing (left pending; set VIP_JOBS_STATE_DIR): ${k}`),
    `items: ${r.items.seen} seen · ${r.items.noise} noise · ${r.items.noSignal} no signal · ${r.items.signals} signals · ${r.items.alreadyClassified} already classified · ${r.items.quarantined} quarantined`,
    r.method === "llm" ? `llm: ${r.llm.calls} calls, ${r.llm.failures} failed (rules used)` : null,
    `by type: ${types || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
