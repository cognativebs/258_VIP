-- Signals synthesis (PokéBeach connector step 9; operator decisions 2026-10-04).
-- vault_core.signals_synthesis_profile: versioned read-time rules for which stored cluster events
-- (PokéBeach cluster job, 20261004_01) surface — official solo themes, cluster size, never-themes —
-- and the band cut-offs. Seed pokemon-synthesis@0.1.0 · unverified. Writes no events or evidence.
-- No stored priority or band (ADR 0013: read time). Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

CREATE TABLE IF NOT EXISTS vault_core.signals_synthesis_profile (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    domain        TEXT NOT NULL,
    profile_json  JSONB NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT false,
    is_current    BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signals_synthesis_profile_version_unique UNIQUE (name, version),
    CONSTRAINT signals_synthesis_profile_identity CHECK (
      profile_json->>'name' = name AND profile_json->>'version' = version AND profile_json->>'domain' = domain
    )
);

COMMENT ON TABLE vault_core.signals_synthesis_profile IS
  'Versioned synthesis rules: which official themes stand alone, how many items make a cluster, which themes never surface, how corroboration lowers noise, and the read-time band cut-offs on signal_priority. Changing the current row re-bands at read time; stored scores are not rewritten.';

CREATE UNIQUE INDEX IF NOT EXISTS signals_synthesis_profile_one_current
  ON vault_core.signals_synthesis_profile (name)
  WHERE is_current;

INSERT INTO vault_core.signals_synthesis_profile (name, version, domain, profile_json, verified, is_current)
SELECT
  'pokemon-synthesis',
  '0.1.0',
  'collectibles',
  $profile${
  "schema": "vip_signals_synthesis_v1",
  "name": "pokemon-synthesis",
  "version": "0.1.0",
  "domain": "collectibles",
  "windowHours": 72,
  "minClusterItems": 2,
  "officialSources": [
    "pokebeach_official"
  ],
  "soloThemes": [
    "PREORDER",
    "PRODUCT_REVEAL",
    "SET_RELEASE",
    "PULL_RATE",
    "SUPPLY_CHANGE",
    "REPRINT",
    "PROMOTION"
  ],
  "neverThemes": [
    "COMPETITIVE"
  ],
  "corroboration": "single_source_noise_pow_independent_sources",
  "bands": [
    {
      "label": "watch",
      "minPriority": 0.05,
      "minIndependentSources": 1
    },
    {
      "label": "emerging",
      "minPriority": 0.12,
      "minIndependentSources": 1
    },
    {
      "label": "strong",
      "minPriority": 0.2,
      "minIndependentSources": 1
    },
    {
      "label": "high_conviction",
      "minPriority": 0.3,
      "minIndependentSources": 2
    }
  ],
  "notes": "Starting cut-offs 2026-10-04 · unverified. An official article stands alone only for factual, actionable themes; card reveals and chatter need a cluster; competitive news never surfaces. High Conviction needs 2+ independent sources (market confirmation joins later). Noise falls as 0.30^sources."
}$profile$::jsonb,
  false,
  NOT EXISTS (SELECT 1 FROM vault_core.signals_synthesis_profile WHERE name = 'pokemon-synthesis' AND is_current)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
