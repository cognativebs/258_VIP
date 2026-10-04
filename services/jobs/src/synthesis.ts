/**
 * Signals synthesis job (PokéBeach connector step 9). Plans with
 * @vip/signals planSynthesis over source items in the profile's window, then
 * writes spine rows: one event + one signal per candidate, one PRIMARY
 * evidence row per article (item_ref = the article URL). An article already
 * in a synthesized event joins that event instead of starting another, so
 * nothing enters SIGNALS twice. Re-running only adds new articles and
 * re-scores; it never duplicates. Priority and bands stay read-time.
 */
import {
  POKEMON_ENTITY_EXTRACTOR_VERSION,
  SYNTHESIS_VERSION,
  SynthesisProfileSchema,
  compileRuleSet,
  decideByRules,
  independenceGroup,
  planSynthesis,
  type SynthesisCandidate,
  type SynthesisItem,
} from "@vip/signals";

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const SYNTHESIS_PROFILE = "pokemon-synthesis";
const THEME_RULE_SET = "collectibles-headline";
const OPINION_CLASSES = new Set(["creator_opinion", "community_opinion"]);

export type SynthesisReport = {
  job: "synthesis";
  version: typeof SYNTHESIS_VERSION;
  profile: string;
  ruleSet: string;
  at: string;
  dryRun: boolean;
  candidates: number;
  created: number;
  updated: number;
  unchanged: number;
  evidenceAdded: number;
  skippedNoDocument: number;
  signals: { eventKey: string; kind: string; theme: string; title: string; items: number; independent: number; action: string }[];
};

/** windowHours overrides the profile's window for one run (a backfill); the profile is unchanged. */
export async function synthesizeSignals(
  db: Queryable,
  opts: { at?: Date; dryRun?: boolean; windowHours?: number } = {},
): Promise<SynthesisReport> {
  const at = opts.at ?? new Date();
  const prof = await db.query(
    `SELECT version, profile_json FROM vault_core.signals_synthesis_profile WHERE name = $1 AND is_current`,
    [SYNTHESIS_PROFILE],
  );
  if (!prof.rows[0]) throw new Error(`no current ${SYNTHESIS_PROFILE} profile (apply 20261004_02)`);
  const stored = SynthesisProfileSchema.parse(prof.rows[0].profile_json);
  const profile = opts.windowHours ? { ...stored, windowHours: opts.windowHours } : stored;
  const rs = await db.query(
    `SELECT version, rules_json FROM vault_core.signals_classifier_rule_set WHERE name = $1 AND is_current`,
    [THEME_RULE_SET],
  );
  if (!rs.rows[0]) throw new Error(`no current ${THEME_RULE_SET} rule set`);
  const compiled = compileRuleSet(rs.rows[0].rules_json);
  const ruleVersion =
    `${SYNTHESIS_VERSION}; ${SYNTHESIS_PROFILE}@${prof.rows[0].version}; ${THEME_RULE_SET}@${rs.rows[0].version}` +
    (opts.windowHours ? `; window override ${opts.windowHours}h` : "");

  const sources = await db.query(`SELECT source_key, seed_confidence_ceiling, seed_evidence_class FROM vault_core.signals_news_source`);
  const ceilings: Record<string, number> = {};
  const opinion = new Set<string>();
  for (const s of sources.rows) {
    ceilings[s.source_key] = Number(s.seed_confidence_ceiling);
    if (OPINION_CLASSES.has(s.seed_evidence_class)) opinion.add(s.source_key);
  }

  const rows = await db.query(
    `SELECT i.id, i.source_id, i.canonical_url, i.title, i.excerpt,
            coalesce(i.published_at, i.first_seen_at) AS at,
            (SELECT r.raw_document_id FROM vault_signals.source_item_revision r
              WHERE r.source_item_id = i.id AND r.raw_document_id IS NOT NULL
              ORDER BY r.observed_at DESC LIMIT 1) AS raw_document_id,
            e.entity_kind, e.normalized_key, e.mention, e.entity_ref
       FROM vault_signals.source_item i
       LEFT JOIN vault_signals.source_item_entity e
         ON e.source_item_id = i.id AND e.content_hash = i.content_hash AND e.extractor_version = $3
      WHERE coalesce(i.published_at, i.first_seen_at) > $1::timestamptz - make_interval(hours => $2)
        AND coalesce(i.published_at, i.first_seen_at) <= $1::timestamptz
      ORDER BY i.id`,
    [at.toISOString(), profile.windowHours, POKEMON_ENTITY_EXTRACTOR_VERSION],
  );

  const report: SynthesisReport = {
    job: "synthesis",
    version: SYNTHESIS_VERSION,
    profile: `${SYNTHESIS_PROFILE}@${prof.rows[0].version}`,
    ruleSet: `${THEME_RULE_SET}@${rs.rows[0].version}`,
    at: at.toISOString(),
    dryRun: Boolean(opts.dryRun),
    candidates: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    evidenceAdded: 0,
    skippedNoDocument: 0,
    signals: [],
  };

  const items = new Map<string, SynthesisItem>();
  for (const r of rows.rows) {
    let item = items.get(r.id);
    if (!item) {
      if (!r.raw_document_id) {
        report.skippedNoDocument += 1;
        continue;
      }
      const d = decideByRules({ title: r.title, description: r.excerpt }, compiled);
      item = {
        id: r.id,
        sourceKey: r.source_id,
        group: independenceGroup(r.source_id, r.canonical_url),
        title: r.title,
        url: r.canonical_url,
        at: new Date(r.at).toISOString(),
        theme: d.outcome === "signal" ? d.signalType : null,
        hedged: d.outcome === "signal" ? d.hedged : false,
        entities: [],
        rawDocumentId: r.raw_document_id,
        provMethod: opinion.has(r.source_id) ? "opinion" : "inferred",
      };
      items.set(r.id, item);
    }
    if (r.entity_kind) item.entities.push({ kind: r.entity_kind, normalizedKey: r.normalized_key, mention: r.mention, entityRef: r.entity_ref });
  }

  const candidates = planSynthesis([...items.values()], { at, profile, rules: compiled.ruleSet, ceilings });
  report.candidates = candidates.length;
  if (opts.dryRun) {
    report.signals = candidates.map((c) => ({ eventKey: c.eventKey, kind: c.kind, theme: c.theme, title: c.title, items: c.items.length, independent: c.independentSourceCount, action: "planned" }));
    return report;
  }
  const weightSet = await db.query(`SELECT id FROM vault_signals.score_weight_set WHERE is_current`);
  if (!weightSet.rows[0]) throw new Error("no current score_weight_set");
  const typeIds = new Map((await db.query(`SELECT id, code FROM vault_signals.signal_type`)).rows.map((r) => [r.code, r.id]));
  for (const c of candidates) {
    const action = await writeCandidate(db, c, { at, ruleVersion, weightSetId: weightSet.rows[0].id, typeId: typeIds.get(c.theme), singleSourceNoise: compiled.ruleSet.scoring.singleSourceNoise, report });
    report.signals.push({ eventKey: c.eventKey, kind: c.kind, theme: c.theme, title: c.title, items: c.items.length, independent: c.independentSourceCount, action });
  }
  return report;
}

async function writeCandidate(
  db: Queryable,
  c: SynthesisCandidate,
  ctx: { at: Date; ruleVersion: string; weightSetId: string; typeId: string | undefined; singleSourceNoise: number; report: SynthesisReport },
): Promise<"created" | "updated" | "unchanged"> {
  if (!ctx.typeId) throw new Error(`signal_type ${c.theme} missing (apply 20261004_01)`);
  // An article already inside a synthesized event pulls the whole candidate into that event.
  const existing = await db.query(
    `SELECT e.id FROM vault_signals.event e
      WHERE e.prov_source = 'signals_synthesis'
        AND (e.event_key = $1 OR EXISTS (
          SELECT 1 FROM vault_signals.event_evidence ee
           WHERE ee.event_id = e.id AND ee.item_ref = ANY($2::text[])))
      ORDER BY e.first_seen_at, e.id LIMIT 1`,
    [c.eventKey, c.items.map((i) => i.url)],
  );
  let eventId: string = existing.rows[0]?.id;
  const notes = `${c.kind} · ${c.items.length} article(s) · ${c.independentSourceCount} independent source(s): ${c.groups.join(", ")}`;
  if (!eventId) {
    const ins = await db.query(
      `INSERT INTO vault_signals.event (
         event_key, title, first_seen_at, event_type, primary_origin_document_id,
         prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
       ) VALUES ($1, $2, $3, $4, $5, 'signals_synthesis', $6, $7, $8, 'unverified', $9)
       RETURNING id`,
      [c.eventKey, c.title, c.anchor.at, c.theme, c.anchor.rawDocumentId, c.provMethod, ctx.ruleVersion, c.scores.baseConfidence, notes],
    );
    eventId = ins.rows[0].id;
  }
  for (const i of c.items) {
    const added = await db.query(
      `INSERT INTO vault_signals.event_evidence
         (event_id, raw_document_id, role, independence_group, detected_at, item_ref, source_item_url)
       VALUES ($1, $2, 'PRIMARY', $3, $4, $5, $5)
       ON CONFLICT ON CONSTRAINT event_evidence_item_once DO NOTHING
       RETURNING id`,
      [eventId, i.rawDocumentId, i.group, ctx.at, i.url],
    );
    ctx.report.evidenceAdded += added.rows.length;
  }

  // Score from all evidence the event now has, not just this run's articles.
  const groups = Number((await db.query(`SELECT vault_signals.independent_source_count($1) AS n`, [eventId])).rows[0].n);
  const noise = Math.round(ctx.singleSourceNoise ** Math.max(1, groups) * 1000) / 1000;
  const current = await db.query(
    `SELECT id, base_confidence::float AS conf, noise_probability::float AS noise FROM vault_signals.signal WHERE event_id = $1`,
    [eventId],
  );
  if (!current.rows[0]) {
    const sig = await db.query(
      `INSERT INTO vault_signals.signal (
         signal_type_id, domain, title, summary, direction, first_seen_at, event_id,
         base_confidence, base_impact, noise_probability, score_weight_set_id, created_by_version,
         prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
       ) VALUES ($1, 'collectibles', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'signals_synthesis', $12, $13, $7, 'unverified', $14)
       RETURNING id`,
      [ctx.typeId, c.title, c.items.map((i) => i.title).join(" · ").slice(0, 2000), c.scores.direction, c.anchor.at, eventId, c.scores.baseConfidence, c.scores.baseImpact, noise, ctx.weightSetId, SYNTHESIS_VERSION, c.provMethod, ctx.ruleVersion, notes],
    );
    if (c.entity) {
      await db.query(
        `INSERT INTO vault_signals.signal_entity (signal_id, entity_ref, entity_kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [sig.rows[0].id, c.entity.entityRef ?? `${c.entity.kind}:${c.entity.normalizedKey}`, `${c.entity.kind}_name_text`],
      );
    }
    ctx.report.created += 1;
    return "created";
  }
  const conf = Math.max(current.rows[0].conf, c.scores.baseConfidence);
  if (conf === current.rows[0].conf && noise === current.rows[0].noise) {
    ctx.report.unchanged += 1;
    return "unchanged";
  }
  await db.query(
    `UPDATE vault_signals.signal
        SET base_confidence = $2, noise_probability = $3, last_updated_at = $4, prov_notes = $5, prov_rule_version = $6
      WHERE id = $1`,
    [current.rows[0].id, conf, noise, ctx.at, notes, ctx.ruleVersion],
  );
  ctx.report.updated += 1;
  return "updated";
}

export function formatSynthesisReport(r: SynthesisReport): string {
  return [
    `VIP Job — synthesis${r.dryRun ? " (dry run)" : ""} · ${r.profile} · ${r.ruleSet} · at ${r.at}`,
    `candidates ${r.candidates} · created ${r.created} · updated ${r.updated} · unchanged ${r.unchanged} · evidence rows added ${r.evidenceAdded}` +
      (r.skippedNoDocument ? ` · ${r.skippedNoDocument} items without a source document skipped` : ""),
    ...r.signals.map((s) => `  ${s.action.padEnd(9)} ${s.kind.padEnd(7)} ${s.theme.padEnd(15)} ${s.items} article(s), ${s.independent} source(s) · ${s.title}`),
  ].join("\n");
}
