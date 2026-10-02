/**
 * daily-collectibles@0.1.0 (2026-10-01). Lanes are source keys. Shares are a
 * starting choice weighted toward what the collector owns and hunts (comics,
 * Pokémon) · unverified; the operator adjusts them. Migration 20261001_03
 * embeds this object; a test fails if the two drift.
 */
import type { DailySportsProfile } from "./daily-sports.js";

export const DAILY_COLLECTIBLES_PROFILE_SEED: DailySportsProfile = {
  schema: "vip_signals_curation_v1",
  name: "daily-collectibles",
  version: "0.1.0",
  domain: "collectibles",
  slots: 20,
  windowHours: 24,
  groups: [
    { key: "comics", label: "Comics", share: 0.4, lanes: ["comicsbeat_rss"], stance: "collect" },
    { key: "pokemon", label: "Pokémon / TCG", share: 0.35, lanes: ["pokebeach_rss"], stance: "collect" },
    { key: "grading", label: "Grading (PSA, TAG)", share: 0.15, lanes: ["psa_news", "tag_news"], stance: "collect" },
    { key: "creator", label: "Creator commentary", share: 0.1, lanes: ["alpha_investments_youtube"], stance: "collect" },
  ],
  backfillOrder: ["comics", "pokemon", "grading"],
  notes:
    "Starting shares 2026-10-01 (comics 40, Pokémon 35, grading 15, creator commentary 10) · unverified. Shares choose slots only; they never change a signal's scores. Creator commentary is opinion and is never backfilled into.",
};
