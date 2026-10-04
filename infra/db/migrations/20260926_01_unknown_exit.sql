-- ============================================================================
-- Collection-level unrecorded exit (gift / donation / lost box).
--
-- Operator reports ~N bulk books left without titles. We NEVER DELETE holdings
-- and NEVER set dropped_at from this table. Titles stay listed. Physical
-- remaining value is a range (inferred · unverified), not a point fact.
-- Recorded exits still come from a later CLZ export (how-to 07).
-- ============================================================================

BEGIN;

SET search_path TO vault_collection, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_collection.unknown_exit (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    scope                   TEXT NOT NULL
                            CHECK (scope IN (
                                'general_inventory_bulk',
                                'dealer_inventory_bulk',
                                'operator_named'
                            )),
    estimated_qty           INTEGER NOT NULL
                            CHECK (estimated_qty >= 1),
    estimated_value_low     NUMERIC(12,2),
    estimated_value_high    NUMERIC(12,2),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    titles_recorded         BOOLEAN NOT NULL DEFAULT FALSE
                            CHECK (titles_recorded IS FALSE),
    recipient_note          TEXT,
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN (
                                'open',
                                'superseded',
                                'resolved_by_clz_sync'
                            )),
    holdings_touched        BOOLEAN NOT NULL DEFAULT FALSE
                            CHECK (holdings_touched IS FALSE),
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL
                            CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unknown_exit_status
    ON vault_collection.unknown_exit (status, occurred_at DESC);

COMMENT ON TABLE vault_collection.unknown_exit IS
    'Collection-level unrecorded exit (gift/donation). Titles unknown. Never DELETE holdings or set dropped_at from this row. Value impact is a range, inferred · unverified.';

COMMIT;
