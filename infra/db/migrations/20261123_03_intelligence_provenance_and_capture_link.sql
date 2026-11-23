-- Intelligence ledger: stored provenance and a real field-capture -> underwriting link
-- (finish plan Q20 + Q21, owner 2026-11-23).
--
-- Q21: provenance was rebuilt at read time, so the rule version shown was the reader's, not the
-- writer's. Five tables that carry provenance in the domain contract get prov_* columns, written
-- at insert. Existing rows stay NULL and keep the "rebuilt on read" label: nothing is back-filled
-- as if it had been recorded (AGENTS.md: inferred values are never stored as verified).
--
-- Q20: a field capture's underwriting was found by a "[field_capture:<id>]" tag inside
-- acquisition_underwriting.notes. The link becomes a column on field_captured_item (the capture is
-- written after its underwriting, and locked underwriting rows cannot be updated). One-time
-- back-fill from existing tags; the tags stay in notes untouched.
--
-- Additive only. Re-runnable.

BEGIN;

SET search_path TO vault_core, public;

-- Q21 ------------------------------------------------------------------------------------------

ALTER TABLE vault_core.prediction
    ADD COLUMN IF NOT EXISTS prov_source              TEXT,
    ADD COLUMN IF NOT EXISTS prov_method              TEXT,
    ADD COLUMN IF NOT EXISTS prov_rule_version        TEXT,
    ADD COLUMN IF NOT EXISTS prov_confidence          NUMERIC(4, 3),
    ADD COLUMN IF NOT EXISTS prov_verification_status TEXT,
    ADD COLUMN IF NOT EXISTS prov_notes               TEXT;

ALTER TABLE vault_core.acquisition_underwriting
    ADD COLUMN IF NOT EXISTS prov_source              TEXT,
    ADD COLUMN IF NOT EXISTS prov_method              TEXT,
    ADD COLUMN IF NOT EXISTS prov_rule_version        TEXT,
    ADD COLUMN IF NOT EXISTS prov_confidence          NUMERIC(4, 3),
    ADD COLUMN IF NOT EXISTS prov_verification_status TEXT,
    ADD COLUMN IF NOT EXISTS prov_notes               TEXT;

ALTER TABLE vault_core.grading_evaluation
    ADD COLUMN IF NOT EXISTS prov_source              TEXT,
    ADD COLUMN IF NOT EXISTS prov_method              TEXT,
    ADD COLUMN IF NOT EXISTS prov_rule_version        TEXT,
    ADD COLUMN IF NOT EXISTS prov_confidence          NUMERIC(4, 3),
    ADD COLUMN IF NOT EXISTS prov_verification_status TEXT,
    ADD COLUMN IF NOT EXISTS prov_notes               TEXT;

ALTER TABLE vault_core.recommendation
    ADD COLUMN IF NOT EXISTS prov_source              TEXT,
    ADD COLUMN IF NOT EXISTS prov_method              TEXT,
    ADD COLUMN IF NOT EXISTS prov_rule_version        TEXT,
    ADD COLUMN IF NOT EXISTS prov_confidence          NUMERIC(4, 3),
    ADD COLUMN IF NOT EXISTS prov_verification_status TEXT,
    ADD COLUMN IF NOT EXISTS prov_notes               TEXT;

ALTER TABLE vault_core.evidence_card
    ADD COLUMN IF NOT EXISTS prov_source              TEXT,
    ADD COLUMN IF NOT EXISTS prov_method              TEXT,
    ADD COLUMN IF NOT EXISTS prov_rule_version        TEXT,
    ADD COLUMN IF NOT EXISTS prov_confidence          NUMERIC(4, 3),
    ADD COLUMN IF NOT EXISTS prov_verification_status TEXT,
    ADD COLUMN IF NOT EXISTS prov_notes               TEXT;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['prediction', 'acquisition_underwriting', 'grading_evaluation',
                             'recommendation', 'evidence_card']
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER TABLE vault_core.%I ADD CONSTRAINT %I CHECK (prov_method IS NULL OR prov_method IN (''observed'', ''normalized'', ''inferred'', ''opinion'', ''recommendation''))',
                t, t || '_prov_method_chk');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            EXECUTE format(
                'ALTER TABLE vault_core.%I ADD CONSTRAINT %I CHECK (prov_verification_status IS NULL OR prov_verification_status IN (''verified'', ''unverified'', ''disputed'', ''superseded''))',
                t, t || '_prov_verification_chk');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            EXECUTE format(
                'ALTER TABLE vault_core.%I ADD CONSTRAINT %I CHECK (prov_confidence IS NULL OR (prov_confidence >= 0 AND prov_confidence <= 1))',
                t, t || '_prov_confidence_chk');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        EXECUTE format(
            'COMMENT ON COLUMN vault_core.%I.prov_rule_version IS %L',
            t,
            'Rule or model version at write time (Q21). NULL on rows written before 2026-11-23: their provenance is rebuilt on read and labelled so.');
    END LOOP;
END $$;

-- Q20 ------------------------------------------------------------------------------------------

ALTER TABLE vault_core.field_captured_item
    ADD COLUMN IF NOT EXISTS acquisition_underwriting_id UUID
        REFERENCES vault_core.acquisition_underwriting(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_field_captured_item_underwriting
    ON vault_core.field_captured_item (acquisition_underwriting_id)
    WHERE acquisition_underwriting_id IS NOT NULL;

COMMENT ON COLUMN vault_core.field_captured_item.acquisition_underwriting_id IS
    'Underwriting written for this capture (Q20). Replaces the [field_capture:<id>] tag in acquisition_underwriting.notes; old tags were back-filled once and left in notes.';

-- One-time back-fill from the notes tag. Re-runs only touch rows still NULL.
UPDATE vault_core.field_captured_item c
   SET acquisition_underwriting_id = (
         SELECT au.id FROM vault_core.acquisition_underwriting au
          WHERE au.notes LIKE '%[field_capture:' || c.id::text || ']%'
          ORDER BY au.evaluated_at, au.id
          LIMIT 1)
 WHERE c.acquisition_underwriting_id IS NULL
   AND EXISTS (
         SELECT 1 FROM vault_core.acquisition_underwriting au
          WHERE au.notes LIKE '%[field_capture:' || c.id::text || ']%');

COMMIT;
