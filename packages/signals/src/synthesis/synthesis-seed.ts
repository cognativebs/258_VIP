/**
 * pokemon-synthesis@0.1.0 (operator decisions 2026-10-04). Every cut-off is a
 * starting choice · unverified, to be recalibrated from resolved predictions.
 * Migration 20261004_03 embeds this object; a test fails if the two drift.
 */
import type { SynthesisProfile } from "./synthesis.js";

export const POKEMON_SYNTHESIS_PROFILE_SEED: SynthesisProfile = {
  schema: "vip_signals_synthesis_v1",
  name: "pokemon-synthesis",
  version: "0.1.0",
  domain: "collectibles",
  windowHours: 72,
  minClusterItems: 2,
  officialSources: ["pokebeach_official"],
  soloThemes: ["PREORDER", "PRODUCT_REVEAL", "SET_RELEASE", "PULL_RATE", "SUPPLY_CHANGE", "REPRINT", "PROMOTION"],
  neverThemes: ["COMPETITIVE"],
  corroboration: "single_source_noise_pow_independent_sources",
  bands: [
    { label: "watch", minPriority: 0.05, minIndependentSources: 1 },
    { label: "emerging", minPriority: 0.12, minIndependentSources: 1 },
    { label: "strong", minPriority: 0.2, minIndependentSources: 1 },
    { label: "high_conviction", minPriority: 0.3, minIndependentSources: 2 },
  ],
  notes:
    "Starting cut-offs 2026-10-04 · unverified. An official article stands alone only for factual, actionable themes; card reveals and chatter need a cluster; competitive news never surfaces. High Conviction needs 2+ independent sources (market confirmation joins later). Noise falls as 0.30^sources.",
};
