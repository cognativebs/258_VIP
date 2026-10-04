-- Signals synthesis (PokéBeach connector step 9; operator decisions 2026-10-04).
-- 1. event_evidence uniqueness widens from (event, document) to (event, document, item), with NULLS NOT
--    DISTINCT so a document-level row (item_ref NULL) is still unique. Operator-approved: the old
--    constraint is dropped and the wider one added; every existing row satisfies it. Needed because
--    several homepage articles share one snapshot document.
-- 2. vault_core.signals_synthesis_profile: versioned rules for what becomes a signal (official solo
--    themes, cluster size, never-themes), how corroboration lowers noise, and read-time band cut-offs.
--    Seed pokemon-synthesis@0.1.0 · unverified.
-- No stored priority or band (ADR 0013: read time). Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'vault_signals.event_evidence'::regclass AND conname = 'event_evidence_item_once'
  ) THEN
    ALTER TABLE vault_signals.event_evidence DROP CONSTRAINT IF EXISTS event_evidence_document_once;
    ALTER TABLE vault_signals.event_evidence
      ADD CONSTRAINT event_evidence_item_once UNIQUE NULLS NOT DISTINCT (event_id, raw_document_id, item_ref);
  END IF;
END;
$$;

COMMENT ON CONSTRAINT event_evidence_item_once ON vault_signals.event_evidence IS
  'One evidence row per event, document and item (an article inside a multi-item snapshot). A document-level row has item_ref NULL and stays unique.';

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
