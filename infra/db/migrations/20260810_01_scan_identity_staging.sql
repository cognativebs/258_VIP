-- ============================================================================
-- ADR 0009 — uncertain identification must never reach canonical inventory.
--
-- Candidate identities become rows (not a single text column) so confidence,
-- match reasons, and provenance stay queryable, and so a scan_unit can hold
-- several competing hypotheses without any of them touching vault_core.asset
-- or vault_collection.holding before resolution.
-- ============================================================================

SET search_path TO vault_media, vault_evidence, vault_core, public;

-- How a unit left the review queue. NULL = still staged.
DO $$ BEGIN
  CREATE TYPE vault_media.scan_resolution_mode AS ENUM (
    'operator_confirmed',
    'auto_high_confidence',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vault_media.scan_unit_candidate (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    unit_id         UUID NOT NULL
                    REFERENCES vault_media.scan_unit(id) ON DELETE CASCADE,

    -- Stable catalog key; asset_id is a HYPOTHESIS only until resolution.
    catalog_key     TEXT NOT NULL,
    asset_id        UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,

    category        TEXT,
    display_name    TEXT NOT NULL,
    set_name        TEXT,
    collector_number TEXT,
    player_or_character TEXT,
    release_year    SMALLINT,
    external_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Which adapter produced this row, and how well it scored.
    adapter_id      TEXT NOT NULL DEFAULT 'fixture-catalog',
    confidence      NUMERIC(4,3) NOT NULL
                    CHECK (confidence >= 0 AND confidence <= 1),
    match_reasons   TEXT[] NOT NULL DEFAULT '{}',
    rank            SMALLINT,

    -- Candidates are inferred by construction (rule 2).
    prov_source     TEXT NOT NULL DEFAULT 'scan_id_matcher',
    prov_method     vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.400
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'unverified',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (unit_id, catalog_key)
);

CREATE INDEX IF NOT EXISTS idx_scan_candidate_unit
  ON vault_media.scan_unit_candidate (unit_id, confidence DESC);

-- Resolution attribution on the unit itself.
ALTER TABLE vault_media.scan_unit
  ADD COLUMN IF NOT EXISTS resolution_mode vault_media.scan_resolution_mode,
  ADD COLUMN IF NOT EXISTS resolution_rule_version TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_asset_id UUID
      REFERENCES vault_core.asset(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS top_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS confidence_band TEXT;

-- A resolved unit must say how it was resolved; an unresolved one must not
-- claim a canonical asset. This is the ADR 0009 boundary in the schema.
--
-- CASE, not OR: a CHECK passes when it evaluates to NULL, and an OR chain over
-- a NULL resolution_mode yields NULL, which would silently allow a staged unit
-- to carry confirmed_asset_id. Every CASE branch returns a real boolean.
ALTER TABLE vault_media.scan_unit
  DROP CONSTRAINT IF EXISTS scan_unit_resolution_consistent;

ALTER TABLE vault_media.scan_unit
  ADD CONSTRAINT scan_unit_resolution_consistent CHECK (
    CASE
      WHEN resolution_mode IS NULL
        THEN confirmed_asset_id IS NULL AND holding_id IS NULL
      WHEN resolution_mode = 'rejected'
        THEN confirmed_asset_id IS NULL AND holding_id IS NULL
      ELSE confirmed_asset_id IS NOT NULL
           AND holding_id IS NOT NULL
           AND resolution_rule_version IS NOT NULL
    END
  );

CREATE INDEX IF NOT EXISTS idx_scan_unit_unresolved
  ON vault_media.scan_unit (created_at DESC)
  WHERE resolution_mode IS NULL;

COMMENT ON TABLE vault_media.scan_unit_candidate IS
  'ADR 0009: competing identity hypotheses for a scanned card. asset_id here is a hypothesis, never ownership.';
COMMENT ON COLUMN vault_media.scan_unit.resolution_mode IS
  'NULL while staged. operator_confirmed | auto_high_confidence | rejected.';
COMMENT ON COLUMN vault_media.scan_unit.confirmed_asset_id IS
  'Canonical asset, set only at resolution together with holding_id.';
