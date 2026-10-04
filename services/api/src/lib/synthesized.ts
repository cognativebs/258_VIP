/**
 * Synthesized signals for a domain, read back with read-time priority,
 * decayed influence and a band from the current synthesis profile. Every
 * signal lists its evidence: each article with its outlet, time and link.
 */
import { z } from "zod";
import { SynthesisProfileSchema, bandFor, orchestr8Question, proposeForSignal } from "@vip/signals";
import type { Hunt } from "../seeds/hunts.js";
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
            (SELECT se.entity_ref FROM vault_signals.signal_entity se WHERE se.signal_id = s.id ORDER BY se.entity_ref LIMIT 1) AS entity
       FROM vault_signals.signal s
       JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
      WHERE s.prov_source = 'signals_synthesis' AND s.domain = $2 AND s.first_seen_at <= $1
      ORDER BY influence DESC, s.id`,
    [at.toISOString(), profile.domain],
  );
  const evidence = await db.query(
    `SELECT ee.event_id, ee.independence_group, ee.source_item_url, ee.detected_at,
            i.title, i.author_name, i.source_id, coalesce(i.published_at, i.first_seen_at) AS at, i.published_at_source
       FROM vault_signals.event_evidence ee
       LEFT JOIN vault_signals.source_item i ON i.canonical_url = ee.source_item_url
      WHERE ee.event_id = ANY($1::uuid[])
      ORDER BY at`,
    [sigs.rows.map((r) => r.event_id)],
  );

  // Exposure is read now, so a proposal changes the moment the Binder or a hunt does.
  const binder = await loadBinderSlots(db).catch(() => []);
  const hunts = huntTexts(opts.hunts ?? []);

  const signals = sigs.rows
    .map((r) => {
      const independent = Number(r.independent);
      const band = bandFor(Number(r.priority), independent, profile);
      const exposure = exposureFor(r.entity, binder, hunts);
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
        priority: Number(r.priority),
        influence: Number(r.influence),
        scores: { baseConfidence: r.conf, baseImpact: r.impact, noiseProbability: r.noise },
        independentSourceCount: independent,
        firstSeenAt: new Date(r.first_seen_at).toISOString(),
        lastUpdatedAt: new Date(r.last_updated_at).toISOString(),
        evidence: evidence.rows
          .filter((e) => e.event_id === r.event_id)
          .map((e) => ({
            title: e.title,
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
        "Bands are read-time from signal_priority and the current profile; High Conviction needs 2+ independent sources. Every conclusion lists its articles. A signal proposes; Orchestr8 decides. News is never a price.",
    },
  };
}
