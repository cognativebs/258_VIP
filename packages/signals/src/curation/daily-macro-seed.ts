/**
 * Daily lists over the macro domain (2026-10-01). Lanes are GDELT query lanes
 * (snapshots/gdelt_doc_v2/<lane>/). Shares are starting choices · unverified;
 * the operator adjusts them. Migration 20261001_04 embeds both objects; a test
 * fails if they drift.
 */
import type { DailySportsProfile } from "./daily-sports.js";

export const DAILY_HEADLINES_PROFILE_SEED: DailySportsProfile = {
  schema: "vip_signals_curation_v1",
  name: "daily-headlines",
  version: "0.1.0",
  domain: "macro",
  slots: 20,
  windowHours: 24,
  groups: [
    { key: "us", label: "US news", share: 0.6, lanes: ["us"], stance: "collect" },
    { key: "world", label: "World news", share: 0.4, lanes: ["world"], stance: "collect" },
  ],
  backfillOrder: ["us", "world"],
  notes:
    "Starting shares 2026-10-01 (US 60, world 40) · unverified. US means a US outlet (GDELT sourcecountry), not a US topic. Only headlines that change a collector's costs, demand or channels become signals.",
};

export const DAILY_MARKETS_PROFILE_SEED: DailySportsProfile = {
  schema: "vip_signals_curation_v1",
  name: "daily-markets",
  version: "0.1.0",
  domain: "macro",
  slots: 20,
  windowHours: 24,
  groups: [{ key: "business", label: "Business & markets", share: 1, lanes: ["business"], stance: "collect" }],
  backfillOrder: ["business"],
  notes:
    "One lane for now (GDELT business query: collectibles companies, marketplaces, markets). SEC filings and finance newsletters join as their own lanes in a later version · unverified.",
};
