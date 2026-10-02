/**
 * Daily SIGNAL lists: a current curation profile (daily-sports,
 * daily-collectibles, ...) applied to signals of its domain first seen in its
 * window. Ranking is signal_influence at the requested time (read-time priority
 * after decay); the profile only decides how many slots each group gets.
 * Headlines are shown unmodified, credited, and linked with the URL the feed
 * gave. Read-only; never touches vault_market.
 */
import { z } from "zod";
import { curateDailySports, sportFromFeedUrl, type CurationCandidate } from "@vip/signals";

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const DailySportsQuerySchema = z
  .object({ at: z.string().datetime({ offset: true }).optional() })
  .strict();

export const DailyProfileNameSchema = z.string().regex(/^daily-[a-z0-9-]+$/);

export type DailyCandidate = CurationCandidate & {
  sourceKey: string;
  signalType: string;
  signalTypeName: string;
  title: string;
  summary: string;
  subject: string | null;
  /** Kept for the sports page; the same value as subject when the subject is a player. */
  player: string | null;
  sourceUrl: string | null;
  attribution: string;
  firstSeenAt: string;
  baseConfidence: number;
  baseImpact: number;
  noiseProbability: number;
  method: string;
  verification: string;
};
export type DailySportsCandidate = DailyCandidate;

const ESPN_ATTRIBUTION = "Provided by ESPN";

export class DailyProfileNotFoundError extends Error {}

/** ESPN items sit in a sport lane (nfl, mlb, ...); every other source is its own lane. */
function laneFor(sourceKey: string, feedUrl: string | null): string {
  return sourceKey === "espn_rss" ? (sportFromFeedUrl(feedUrl) ?? "unknown") : sourceKey;
}

export async function buildDaily(db: Queryable, name: string, at: Date = new Date()) {
  const profileName = DailyProfileNameSchema.parse(name);
  const prof = await db.query(
    `SELECT version, verified, domain, profile_json FROM vault_core.signals_curation_profile
      WHERE name = $1 AND is_current`,
    [profileName],
  );
  if (!prof.rows[0]) throw new DailyProfileNotFoundError(`no current ${profileName} curation profile`);
  const profileJson = prof.rows[0].profile_json as { windowHours: number };

  const rows = await db.query(
    `SELECT DISTINCT ON (s.id)
            s.id, s.title, s.summary, s.direction, s.first_seen_at,
            s.base_confidence::float AS base_confidence, s.base_impact::float AS base_impact,
            s.noise_probability::float AS noise_probability, s.prov_method, s.prov_verification,
            t.code, t.display_name,
            vault_signals.signal_influence(s.id, $1)::float AS influence,
            d.source_id, d.source_url AS feed_url, ee.source_item_url, src.display_name AS source_name,
            (SELECT se.entity_ref || '|' || se.entity_kind FROM vault_signals.signal_entity se
              WHERE se.signal_id = s.id AND se.entity_kind LIKE '%\\_name\\_text'
              ORDER BY se.entity_ref LIMIT 1) AS subject
       FROM vault_signals.signal s
       JOIN vault_signals.signal_type t ON t.id = s.signal_type_id
       JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id AND ee.role = 'PRIMARY'
       JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
       LEFT JOIN vault_core.signals_news_source src ON src.source_key = d.source_id
      WHERE s.domain = $3
        AND s.first_seen_at <= $1
        AND s.first_seen_at > $1 - make_interval(hours => $2)
      ORDER BY s.id, ee.detected_at`,
    [at.toISOString(), profileJson.windowHours, prof.rows[0].domain],
  );

  const candidates: DailyCandidate[] = rows.rows.map((r) => {
    const [subject, kind] = typeof r.subject === "string" ? (r.subject.split("|") as [string, string]) : [null, null];
    return {
      signalId: r.id,
      lane: laneFor(r.source_id, r.feed_url),
      direction: r.direction,
      influence: Number(r.influence ?? 0),
      sourceKey: r.source_id,
      signalType: r.code,
      signalTypeName: r.display_name,
      title: r.title,
      summary: r.summary,
      subject,
      player: kind === "player_name_text" ? subject : null,
      sourceUrl: r.source_item_url,
      attribution: r.source_id === "espn_rss" ? ESPN_ATTRIBUTION : (r.source_name ?? r.source_id),
      firstSeenAt: new Date(r.first_seen_at).toISOString(),
      baseConfidence: r.base_confidence,
      baseImpact: r.base_impact,
      noiseProbability: r.noise_probability,
      method: r.prov_method,
      verification: r.prov_verification,
    };
  });

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
      ruleVersion: `${profileName}@${prof.rows[0].version}`,
      verificationStatus: "unverified",
      notes:
        "Shares choose how many slots each group gets; ranking is decayed read-time priority. Sell-window framing marks groups you are exiting; it is not a Sell recommendation and is not linked to holdings. Opinion sources are labeled. News is never a price.",
    },
  };
}

export function buildDailySports(db: Queryable, at: Date = new Date()) {
  return buildDaily(db, "daily-sports", at);
}
