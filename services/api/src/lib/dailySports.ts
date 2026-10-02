/**
 * Daily Sports SIGNAL: the current daily-sports curation profile applied to
 * sports signals first seen in its window. Ranking is signal_influence at the
 * requested time (read-time priority after decay); the profile only decides
 * how many slots each sport gets. ESPN headlines are shown unmodified, credited,
 * and linked with the URL the feed gave. Read-only; never touches vault_market.
 */
import { z } from "zod";
import { curateDailySports, sportFromFeedUrl, type CurationCandidate } from "@vip/signals";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const DailySportsQuerySchema = z
  .object({ at: z.string().datetime({ offset: true }).optional() })
  .strict();

export type DailySportsCandidate = CurationCandidate & {
  signalType: string;
  signalTypeName: string;
  title: string;
  summary: string;
  player: string | null;
  sourceUrl: string | null;
  attribution: string;
  firstSeenAt: string;
  baseConfidence: number;
  baseImpact: number;
  noiseProbability: number;
  verification: string;
};

const ATTRIBUTION: Record<string, string> = { espn_rss: "Provided by ESPN" };

export async function buildDailySports(db: Queryable, at: Date = new Date()) {
  const prof = await db.query(
    `SELECT version, verified, profile_json FROM vault_core.signals_curation_profile
      WHERE name = 'daily-sports' AND is_current`,
  );
  if (!prof.rows[0]) throw new Error("no current daily-sports curation profile (apply 20261001_02)");
  const profileJson = prof.rows[0].profile_json as { windowHours: number };

  const rows = await db.query(
    `SELECT DISTINCT ON (s.id)
            s.id, s.title, s.summary, s.direction, s.first_seen_at,
            s.base_confidence::float AS base_confidence, s.base_impact::float AS base_impact,
            s.noise_probability::float AS noise_probability, s.prov_verification,
            t.code, t.display_name,
            vault_signals.signal_influence(s.id, $1)::float AS influence,
            d.source_id, d.source_url AS feed_url, ee.source_item_url,
            (SELECT se.entity_ref FROM vault_signals.signal_entity se
              WHERE se.signal_id = s.id AND se.entity_kind = 'player_name_text'
              ORDER BY se.entity_ref LIMIT 1) AS player
       FROM vault_signals.signal s
       JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
       JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id AND ee.role = 'PRIMARY'
       JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
      WHERE s.domain = 'sports_cards'
        AND s.first_seen_at <= $1
        AND s.first_seen_at > $1 - make_interval(hours => $2)
      ORDER BY s.id, ee.detected_at`,
    [at.toISOString(), profileJson.windowHours],
  );

  const candidates: DailySportsCandidate[] = rows.rows.map((r) => ({
    signalId: r.id,
    sport: sportFromFeedUrl(r.feed_url) ?? "unknown",
    direction: r.direction,
    influence: Number(r.influence ?? 0),
    signalType: r.code,
    signalTypeName: r.display_name,
    title: r.title,
    summary: r.summary,
    player: r.player,
    sourceUrl: r.source_item_url,
    attribution: ATTRIBUTION[r.source_id] ?? r.source_id,
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    baseConfidence: r.base_confidence,
    baseImpact: r.base_impact,
    noiseProbability: r.noise_probability,
    verification: r.prov_verification,
  }));

  const curated = curateDailySports(candidates, profileJson);
  return {
    at: at.toISOString(),
    profile: { ...curated.profile, verified: Boolean(prof.rows[0].verified) },
    groups: curated.groups,
    unfilled: curated.unfilled,
    outsideProfile: curated.outsideProfile,
    items: curated.items,
    provenance: {
      method: "curation",
      ruleVersion: `daily-sports@${prof.rows[0].version}`,
      verificationStatus: "unverified",
      notes:
        "Shares choose how many slots each sport gets; ranking is decayed read-time priority. Sell-window framing marks sports you are exiting; it is not a Sell recommendation and is not linked to holdings. News is never a price.",
    },
  };
}
