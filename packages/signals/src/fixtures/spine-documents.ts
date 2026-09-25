import type { EvidenceRole, OriginRelation, SpineSignalTypeCode } from "../schemas/spine.js";

/**
 * Fixture documents for the spine acceptance cases.
 * Hashes are labels, not fetched bytes. No network.
 */
export type SpineFixtureDocument = {
  key: string;
  sourceKey: string;
  sourceUrl: string;
  contentHash: string;
  eventKey: string | null;
  role: EvidenceRole | null;
  independenceGroup: string | null;
  notes: string;
};

export type SpineFixtureOrigin = {
  fromKey: string;
  toKey: string;
  relation: OriginRelation;
};

const GUESS = "Starting guess · unverified. Not a measured half-life.";

export const SIGNAL_TYPE_SEED: ReadonlyArray<{
  code: SpineSignalTypeCode;
  displayName: string;
  defaultHalfLifeHours: number;
  description: string;
  halfLifeVerified: false;
}> = [
  { code: "PLAYER_INJURY", displayName: "Player injury", defaultHalfLifeHours: 48, description: GUESS, halfLifeVerified: false },
  { code: "RESTOCK", displayName: "Restock", defaultHalfLifeHours: 336, description: GUESS, halfLifeVerified: false },
  { code: "AUCTION_RESULT", displayName: "Auction result", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "SET_RELEASE", displayName: "Set release", defaultHalfLifeHours: 2880, description: GUESS, halfLifeVerified: false },
  { code: "REPRINT", displayName: "Reprint", defaultHalfLifeHours: 2160, description: GUESS, halfLifeVerified: false },
  { code: "LICENSE_CHANGE", displayName: "License change", defaultHalfLifeHours: 8760, description: GUESS, halfLifeVerified: false },
  { code: "HOF_ANNOUNCEMENT", displayName: "Hall of fame announcement", defaultHalfLifeHours: 4320, description: GUESS, halfLifeVerified: false },
  { code: "MACRO_TREND", displayName: "Macro trend", defaultHalfLifeHours: 4320, description: GUESS, halfLifeVerified: false },
  { code: "SUPPLY_CHANGE", displayName: "Supply change", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
];

export const SCORE_WEIGHT_SEED = {
  name: "spine-structural-stand-in",
  version: "0.0.0",
  verified: false as const,
  weightsJson: {
    status: "coefficients_withheld" as const,
    reason:
      "Architecture note Section 5 was not in the repository at build time. No coefficients were invented.",
    stored_inputs: ["base_confidence", "base_impact", "noise_probability"] as const,
    excluded_inputs: [
      "relevance",
      "novelty",
      "magnitude",
      "actionability",
      "source_quality",
      "attention",
    ],
    generated_expression: "base_confidence * base_impact * (1 - noise_probability)",
    generated_expression_status:
      "structural stand-in so priority_score can be GENERATED. Not Section 5. verified=false.",
  },
};

const NEWSLETTER_URL =
  "https://example.com/brief/2026-09-20?utm_source=newsletter&utm_medium=email&recipient=reader@example.com&id=42";

export const SPINE_FIXTURE_DOCUMENTS: readonly SpineFixtureDocument[] = [
  {
    key: "press-release",
    sourceKey: "comicsbeat_rss",
    sourceUrl: "https://example.com/press/license-2026",
    contentHash: "hash-press-release",
    eventKey: "evt-press",
    role: "PRIMARY",
    independenceGroup: "press-1",
    notes: "One press release. The only independent source on evt-press.",
  },
  {
    key: "deriv-1",
    sourceKey: "polygon_rss",
    sourceUrl: "https://example.com/rewrite/license-1",
    contentHash: "hash-deriv-1",
    eventKey: "evt-press",
    role: "DERIVATIVE",
    independenceGroup: "press-1",
    notes: "Derivative of the press release.",
  },
  {
    key: "deriv-2",
    sourceKey: "exec_sum",
    sourceUrl: "https://example.com/rewrite/license-2",
    contentHash: "hash-deriv-2",
    eventKey: "evt-press",
    role: "DERIVATIVE",
    independenceGroup: "press-1",
    notes: "Derivative of the press release.",
  },
  {
    key: "deriv-3",
    sourceKey: "gdelt_doc_v2",
    sourceUrl: "https://example.com/rewrite/license-3",
    contentHash: "hash-deriv-3",
    eventKey: "evt-press",
    role: "DERIVATIVE",
    independenceGroup: "press-1",
    notes: "Derivative of the press release.",
  },
  {
    key: "deriv-4",
    sourceKey: "sherwood_news",
    sourceUrl: "https://example.com/rewrite/license-4",
    contentHash: "hash-deriv-4",
    eventKey: "evt-press",
    role: "DERIVATIVE",
    independenceGroup: "press-1",
    notes: "Fourth derivative. Corroboration stays 1.",
  },
  {
    key: "ind-a",
    sourceKey: "sec_edgar_fts",
    sourceUrl: "https://example.com/filings/a",
    contentHash: "hash-ind-a",
    eventKey: "evt-two-source",
    role: "PRIMARY",
    independenceGroup: "ind-a",
    notes: "First independent report.",
  },
  {
    key: "ind-b",
    sourceKey: "fred",
    sourceUrl: "https://example.com/series/b",
    contentHash: "hash-ind-b",
    eventKey: "evt-two-source",
    role: "PRIMARY",
    independenceGroup: "ind-b",
    notes: "Second independent report.",
  },
  {
    key: "ind-deriv-1",
    sourceKey: "daily_upside",
    sourceUrl: "https://example.com/echo/a1",
    contentHash: "hash-ind-deriv-1",
    eventKey: "evt-two-source",
    role: "DERIVATIVE",
    independenceGroup: "ind-a",
    notes: "Derivative. Does not add a source.",
  },
  {
    key: "ind-deriv-2",
    sourceKey: "the_ai_report",
    sourceUrl: "https://example.com/echo/b1",
    contentHash: "hash-ind-deriv-2",
    eventKey: "evt-two-source",
    role: "DERIVATIVE",
    independenceGroup: "ind-b",
    notes: "Derivative. Does not add a source.",
  },
  {
    key: "ind-deriv-3",
    sourceKey: "milk_road",
    sourceUrl: "https://example.com/echo/a2",
    contentHash: "hash-ind-deriv-3",
    eventKey: "evt-two-source",
    role: "DERIVATIVE",
    independenceGroup: "ind-a",
    notes: "Third derivative on the two-source event.",
  },
  {
    key: "newsletter",
    sourceKey: "stratechery",
    sourceUrl: NEWSLETTER_URL,
    contentHash: "hash-newsletter",
    eventKey: null,
    role: null,
    independenceGroup: null,
    notes: "Newsletter link with tracking params and a recipient address.",
  },
  {
    key: "exact-duplicate",
    sourceKey: "comicsbeat_rss",
    sourceUrl: "https://example.com/press/license-2026?utm_source=copy",
    contentHash: "hash-press-release",
    eventKey: null,
    role: null,
    independenceGroup: null,
    notes: "Same source and content hash as the press release. The unique key rejects it.",
  },
  {
    key: "unrelated-1",
    sourceKey: "espn_rss",
    sourceUrl: "https://example.com/sports/injury-rumor",
    contentHash: "hash-unrelated-1",
    eventKey: "evt-unrelated-1",
    role: "PRIMARY",
    independenceGroup: "unrelated-1",
    notes: "Not part of the press release or the two-source event.",
  },
  {
    key: "unrelated-2",
    sourceKey: "wizards_dailymtg",
    sourceUrl: "https://example.com/mtg/reprint-note",
    contentHash: "hash-unrelated-2",
    eventKey: "evt-unrelated-2",
    role: "PRIMARY",
    independenceGroup: "unrelated-2",
    notes: "Second unrelated document.",
  },
];

export const SPINE_FIXTURE_ORIGINS: readonly SpineFixtureOrigin[] = [
  { fromKey: "deriv-1", toKey: "press-release", relation: "SYNDICATES" },
  { fromKey: "deriv-2", toKey: "press-release", relation: "REWRITES" },
  { fromKey: "deriv-3", toKey: "press-release", relation: "QUOTES" },
  { fromKey: "deriv-4", toKey: "press-release", relation: "LINKS_TO" },
];

export const NEWSLETTER_FIXTURE_URL = NEWSLETTER_URL;
