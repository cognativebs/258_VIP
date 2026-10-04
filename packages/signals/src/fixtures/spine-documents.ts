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
  { code: "PLAYER_DEATH", displayName: "Player death", defaultHalfLifeHours: 336, description: GUESS, halfLifeVerified: false },
  { code: "MILESTONE", displayName: "Milestone", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "TRANSACTION", displayName: "Transaction", defaultHalfLifeHours: 336, description: GUESS, halfLifeVerified: false },
  { code: "AWARD_RACE", displayName: "Award race", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "DISCIPLINE", displayName: "Discipline", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "RETIREMENT", displayName: "Retirement", defaultHalfLifeHours: 2160, description: GUESS, halfLifeVerified: false },
  { code: "MEDIA_ADAPTATION", displayName: "Media adaptation", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "GRADING_SERVICE_CHANGE", displayName: "Grading service change", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "TRADE_POLICY", displayName: "Trade policy", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "SHIPPING_CHANGE", displayName: "Shipping change", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "REGULATION", displayName: "Regulation", defaultHalfLifeHours: 2160, description: GUESS, halfLifeVerified: false },
  { code: "COMPANY_EVENT", displayName: "Company event", defaultHalfLifeHours: 336, description: GUESS, halfLifeVerified: false },
  { code: "MARKET_MOVE", displayName: "Market move", defaultHalfLifeHours: 72, description: GUESS, halfLifeVerified: false },
  { code: "CARD_REVEAL", displayName: "Card reveal", defaultHalfLifeHours: 168, description: GUESS, halfLifeVerified: false },
  { code: "PRODUCT_REVEAL", displayName: "Product reveal", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "PREORDER", displayName: "Preorder", defaultHalfLifeHours: 168, description: GUESS, halfLifeVerified: false },
  { code: "PULL_RATE", displayName: "Pull rate", defaultHalfLifeHours: 720, description: GUESS, halfLifeVerified: false },
  { code: "PROMOTION", displayName: "Promotion", defaultHalfLifeHours: 336, description: GUESS, halfLifeVerified: false },
  { code: "COMPETITIVE", displayName: "Competitive", defaultHalfLifeHours: 168, description: GUESS, halfLifeVerified: false },
];

export const SCORE_WEIGHT_SEED = {
  name: "spine-v0-product",
  version: "0.1.0",
  verified: false as const,
  isCurrent: true,
  weightsJson: {
    formula: "weighted_product_v1" as const,
    exponents: { base_confidence: 1, base_impact: 1, one_minus_noise: 1 },
    stored_inputs: ["base_confidence", "base_impact", "noise_probability"] as const,
    excluded_inputs: [
      "relevance",
      "novelty",
      "magnitude",
      "actionability",
      "source_quality",
      "attention",
    ],
    notes:
      "v0 exponents 1/1/1 · unverified. Not Section 5. Replace with a new row calibrated from resolved predictions (ADR 0013 G-5).",
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
