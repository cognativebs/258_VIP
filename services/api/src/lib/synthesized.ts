/**
 * Synthesized signals for a domain: the PokéBeach cluster job's stored events
 * (connector step 6), read back with read-time priority, decayed influence,
 * whether the current synthesis profile surfaces them, and a band. Every
 * signal lists its evidence: each article with its outlet, time and link.
 */
import { z } from "zod";
import { SynthesisProfileSchema, bandFor, orchestr8Question, proposeForSignal, surfaceFor, type GuideRange } from "@vip/signals";
import type { Hunt } from "../seeds/hunts.js";
import { buildPokemonFmv } from "./pokemonFmv.js";
import { exposureFor, huntTexts, loadBinderSlots } from "./signalExposure.js";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const SynthesizedQuerySchema = z
  .object({
    at: z.string().datetime({ offset: true }).optional(),
    includeNoise: z.enum(["true", "false"]).optional(),
  })
  .strict();

const PROFILE = "pokemon-synthesis";
const BAND_ORDER = ["high_conviction", "strong", "emerging", "watch", "noise"];
/** Signals written by the PokéBeach cluster job (services/jobs/src/pokebeach-cluster.ts). */
const CLUSTER_JOB = "pokebeach-cluster@%";
/** Exposure matches the most specific entity first. */
const ENTITY_KIND_ORDER = "CASE se.entity_kind WHEN 'set' THEN 0 WHEN 'product' THEN 1 WHEN 'card' THEN 2 WHEN 'pokemon' THEN 3 ELSE 9 END";

export async function buildSynthesized(
  db: Queryable,
  opts: { at?: Date; includeNoise?: boolean; hunts?: ReadonlyArray<Hunt> } = {},
) {
  const at = opts.at ?? new Date();
  const prof = await db.query(
    `SELECT version, profile_json FROM vault_core.signals_synthesis_profile WHERE name = $1 AND is_current`,
    [PROFILE],
  );
  if (!prof.rows[0]) throw new Error(`no current ${PROFILE} profile`);
  const profile = SynthesisProfileSchema.parse(prof.rows[0].profile_json);

  const sigs = await db.query(
    `SELECT s.id, s.event_id, s.title, s.direction, s.first_seen_at, s.last_updated_at, s.prov_method::text AS method,
            s.base_confidence::float AS conf, s.base_impact::float AS impact, s.noise_probability::float AS noise,
            t.code, t.display_name,
            vault_signals.signal_priority(s.id)::float AS priority,
            vault_signals.signal_influence(s.id, $1)::float AS influence,
            vault_signals.independent_source_count(s.event_id) AS independent,
            (SELECT count(*) FROM vault_signals.event_evidence ee
              WHERE ee.event_id = s.event_id AND ee.role = 'PRIMARY' AND ee.source_item_id IS NOT NULL)::int AS primary_items,
            (SELECT coalesce(array_agg(DISTINCT i.source_id), '{}') FROM vault_signals.event_evidence ee
               JOIN vault_signals.source_item i ON i.id = ee.source_item_id
              WHERE ee.event_id = s.event_id AND ee.role = 'PRIMARY') AS source_keys,
            (SELECT se.entity_ref FROM vault_signals.event_evidence ee
               JOIN vault_signals.source_item i ON i.id = ee.source_item_id
               JOIN vault_signals.source_item_entity se ON se.source_item_id = i.id AND se.content_hash = i.content_hash
              WHERE ee.event_id = s.event_id AND ee.role = 'PRIMARY' AND se.entity_ref IS NOT NULL
              ORDER BY ${ENTITY_KIND_ORDER}, se.entity_ref LIMIT 1) AS entity
       FROM vault_signals.signal s
       JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
      WHERE s.created_by_version LIKE $3 AND s.domain = $2 AND s.first_seen_at <= $1
      ORDER BY influence DESC, s.id`,
    [at.toISOString(), profile.domain, CLUSTER_JOB],
  );
  const evidence = await db.query(
    `SELECT ee.event_id, ee.role, ee.independence_group, ee.source_item_url, ee.detected_at,
            i.title, i.author_name, i.source_id, coalesce(i.published_at, i.first_seen_at) AS at, i.published_at_source
       FROM vault_signals.event_evidence ee
       LEFT JOIN vault_signals.source_item i ON i.id = ee.source_item_id
      WHERE ee.event_id = ANY($1::uuid[])
      ORDER BY ee.role DESC, at`,
    [sigs.rows.map((r) => r.event_id)],
  );

  // Exposure is read now, so a proposal changes the moment the Binder or a hunt does.
  const binder = await loadBinderSlots(db).catch(() => []);
  const hunts = huntTexts(opts.hunts ?? []);
  const exposures = sigs.rows.map((r) => exposureFor(r.entity, binder, hunts));

  // Guide prices for the matched cards (operator 2026-10-06: evidence only, never unlocks an action).
  // A card whose PriceCharting match still needs review contributes nothing.
  const cardIds = [...new Set(exposures.flatMap((e) => e.cardIds ?? []))].slice(0, 200);
  const fmv = cardIds.length ? await buildPokemonFmv(db, { externalIds: cardIds, asOf: at }).catch(() => null) : null;
  const guideByCard = new Map<string, GuideRange[]>();
  for (const c of fmv?.cards ?? []) {
    if (!c.match || c.match.needsReview) continue;
    guideByCard.set(
      c.externalId,
      c.fmv.map((f) => ({
        externalId: c.externalId,
        card: c.name,
        condition: f.condition,
        conditionAssumed: f.conditionAssumed,
        low: f.low,
        high: f.high,
        snapshots: f.snapshots,
        recencyDays: f.recencyDays,
        confidence: f.confidence,
      })),
    );
  }

  const signals = sigs.rows
    .map((r, i) => {
      const independent = Number(r.independent);
      const surface = surfaceFor({ theme: r.code, primaryItems: Number(r.primary_items), sourceKeys: r.source_keys ?? [] }, profile);
      const band = surface.surfaced ? bandFor(Number(r.priority), independent, profile) : "noise";
      const exposure = exposures[i]!;
      const guide = (exposure.cardIds ?? []).slice(0, 3).flatMap((id) => guideByCard.get(id) ?? []);
      const input = {
        title: r.title,
        theme: r.code,
        band,
        direction: r.direction,
        independentSourceCount: independent,
        method: r.method,
        baseConfidence: r.conf,
        exposure,
        marketConfirmed: false,
        guide,
      };
      const proposal = proposeForSignal(input);
      return {
        exposure,
        proposal,
        orchestr8Question: orchestr8Question(input, proposal),
        signalId: r.id,
        title: r.title,
        theme: r.code,
        themeName: r.display_name,
        entity: r.entity,
        direction: r.direction,
        method: r.method,
        band,
        surface,
        priority: Number(r.priority),
        influence: Number(r.influence),
        scores: { baseConfidence: r.conf, baseImpact: r.impact, noiseProbability: r.noise },
        independentSourceCount: independent,
        firstSeenAt: new Date(r.first_seen_at).toISOString(),
        lastUpdatedAt: new Date(r.last_updated_at).toISOString(),
        evidence: evidence.rows
          .filter((e) => e.event_id === r.event_id)
          .map((e) => ({
            role: e.role,
            title: e.role === "DISCUSSION" ? "Forum discussion" : e.title,
            author: e.author_name,
            sourceKey: e.source_id,
            outlet: e.independence_group,
            url: e.source_item_url,
            at: e.at ? new Date(e.at).toISOString() : null,
            timeSource: e.published_at_source,
          })),
      };
    })
    .filter((s) => opts.includeNoise || s.band !== "noise")
    .sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || b.influence - a.influence);

  return {
    at: at.toISOString(),
    profile: { name: PROFILE, version: prof.rows[0].version, bands: profile.bands },
    signals,
    provenance: {
      method: "synthesis",
      verificationStatus: "unverified",
      notes:
        "Clusters are the PokéBeach cluster job's stored events; whether one surfaces and its band are read-time from the current profile and signal_priority; High Conviction needs 2+ independent sources. Every conclusion lists its articles. A signal proposes; Orchestr8 decides. News is never a price.",
    },
  };
}
