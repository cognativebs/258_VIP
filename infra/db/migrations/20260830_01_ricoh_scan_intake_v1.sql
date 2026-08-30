-- ============================================================================
-- Ricoh fi-8170 / PaperStream trading-card intake v1.
-- Extends existing vault_media.scan_batch / scan_unit / capture_image.
-- Does not create a parallel scan system. vault_tcg untouched.
-- ============================================================================

BEGIN;

SET search_path TO vault_media, vault_evidence, public;

-- Batch header named in the intake spec
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS scanner_profile TEXT;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS image_count INTEGER;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS expected_card_count INTEGER;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS processing_status TEXT;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS errors_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS telemetry JSONB;

UPDATE vault_media.scan_batch
SET source = COALESCE(source, device, 'ricoh_fi8170'),
    scanner_profile = COALESCE(scanner_profile, '004_Cards'),
    processing_status = COALESCE(processing_status, status)
WHERE source IS NULL OR scanner_profile IS NULL OR processing_status IS NULL;

-- Card scan object fields on the existing unit (one physical card)
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS front_image_id UUID;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS back_image_id UUID;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS normalized_front_ref TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS normalized_back_ref TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS pairing_method TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS pairing_confidence NUMERIC(4,3);
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS pairing_needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS orientation TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS identification_status TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS review_status TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS review_route TEXT;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS identity_evidence JSONB;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS base_vs_parallel JSONB;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS physical_reimport BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS transformations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Capture image: master vs derivative (schema existed; these columns were missing)
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS width_px INTEGER;
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS height_px INTEGER;
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS dpi NUMERIC;
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS image_role TEXT NOT NULL DEFAULT 'master';
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS parent_image_id UUID;
ALTER TABLE vault_media.capture_image
    ADD COLUMN IF NOT EXISTS transformations JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN vault_media.scan_batch.scanner_profile IS
    'PaperStream profile name (004_Cards). Source remains swappable.';
COMMENT ON COLUMN vault_media.scan_unit.identity_evidence IS
    'Front+back fused CardIdentityEvidence. Conflicts listed, never silently chosen.';
COMMENT ON COLUMN vault_media.scan_unit.base_vs_parallel IS
    'Base identity vs parallel confidence — a weak parallel does not void the base.';
COMMENT ON COLUMN vault_media.capture_image.image_role IS
    'master = immutable original; normalized/thumb = non-destructive derivatives.';

COMMIT;
