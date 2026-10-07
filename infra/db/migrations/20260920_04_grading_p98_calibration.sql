-- First P(9.8) calibration set. Frozen inputs for later returned-grade scoring.
-- Not signals_normalized. Phase 2 stays off.

BEGIN;

SET search_path TO vault_core, vault_collection, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_core.grading_p98_calibration (
    id                                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    set_key                            TEXT NOT NULL,
    set_frozen_at                      TIMESTAMPTZ NOT NULL,
    asset_id                           UUID NOT NULL REFERENCES vault_core.asset (id),
    holding_id                         UUID REFERENCES vault_collection.holding (id) ON DELETE SET NULL,
    canonical_name                     TEXT,
    raw_ungraded                       NUMERIC(12,2) NOT NULL,
    high_grade                         NUMERIC(12,2) NOT NULL,
    high_key                           TEXT NOT NULL,
    ratio                              NUMERIC(12,4) NOT NULL,
    profit_at_p10                      NUMERIC(12,2) NOT NULL,
    profit_at_p20                      NUMERIC(12,2) NOT NULL,
    profit_at_p30                      NUMERIC(12,2) NOT NULL,
    expected_incremental_profit        NUMERIC(12,2) NOT NULL,
    expected_grading_value             NUMERIC(12,2) NOT NULL,
    grading_opportunity_score          NUMERIC(5,2),
    recommendation                     TEXT NOT NULL,
    p98_assumed                        NUMERIC(4,3) NOT NULL,
    vendor_derived_multiple            BOOLEAN NOT NULL DEFAULT true,
    pre1975_press_restoration_risk     BOOLEAN NOT NULL DEFAULT false,
    year_began                         SMALLINT,
    flags                              TEXT NOT NULL,
    evidence                           JSONB NOT NULL DEFAULT '{}'::jsonb,
    returned_grade                     NUMERIC(4,1),
    returned_grader                    TEXT,
    returned_at                        TIMESTAMPTZ,
    scored_at                          TIMESTAMPTZ,
    score_notes                        TEXT,
    provider_ids                       JSONB NOT NULL DEFAULT '{}'::jsonb,
    prov_source                        TEXT NOT NULL,
    prov_method                        vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version                  TEXT NOT NULL,
    prov_confidence                    NUMERIC(4,3) NOT NULL
                                       CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification                  vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes                         TEXT,
    CONSTRAINT grading_p98_calibration_unique_set_asset UNIQUE (set_key, asset_id)
);

CREATE INDEX IF NOT EXISTS grading_p98_calibration_set_idx
  ON vault_core.grading_p98_calibration (set_key, set_frozen_at DESC);

CREATE INDEX IF NOT EXISTS grading_p98_calibration_asset_idx
  ON vault_core.grading_p98_calibration (asset_id);

COMMENT ON TABLE vault_core.grading_p98_calibration IS
  'First P(9.8) calibration set (p98_set_001). Frozen intersection-queue inputs. returned_* stay empty until grades come back. Not signals_normalized. Phase 2 off.';

COMMIT;
