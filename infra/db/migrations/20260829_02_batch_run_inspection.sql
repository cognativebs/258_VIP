-- ============================================================================
-- Batch 001 inspection ledger: pipeline results + money-affecting failures
-- + elapsed human seconds. Not a market table. Does not touch vault_tcg.
-- ============================================================================

BEGIN;

SET search_path TO vault_collection, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_collection.batch_run (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    sports_count INTEGER NOT NULL DEFAULT 25,
    comics_count INTEGER NOT NULL DEFAULT 10,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_collection.batch_run IS
    'Operator batch walks (Batch 001 first). Status only — items hold the evidence.';

CREATE TABLE IF NOT EXISTS vault_collection.batch_run_item (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    batch_id TEXT NOT NULL REFERENCES vault_collection.batch_run (id),
    slot INTEGER NOT NULL,
    category TEXT NOT NULL,
    file_stem TEXT NOT NULL,
    unit_id UUID,
    holding_id UUID,
    holding_source_row_id TEXT,
    roster JSONB NOT NULL,
    pipeline_result JSONB,
    failure_classes TEXT[] NOT NULL DEFAULT '{}',
    inspect_notes TEXT,
    human_seconds NUMERIC,
    inspector TEXT,
    inspected_at TIMESTAMPTZ,
    pipeline_elapsed_ms INTEGER,
    prov_source TEXT NOT NULL DEFAULT 'batch_001',
    prov_method TEXT NOT NULL DEFAULT 'inferred',
    prov_rule_version TEXT NOT NULL DEFAULT 'batch-run@0.1.0',
    prov_verification TEXT NOT NULL DEFAULT 'unverified',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id, slot)
);

COMMENT ON TABLE vault_collection.batch_run_item IS
    'One Batch 001 card: expected identity, pipeline output, money-failure classes, human inspect seconds.';

INSERT INTO vault_collection.batch_run (id, label, status, notes)
VALUES (
    'batch-001',
    'Batch 001 — 25 sports then 10 comics',
    'not_started',
    'Sports first. Dealer Inventory. Inspect every row. Capture only money-affecting failures + human time.'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
