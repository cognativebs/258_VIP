-- ============================================================================
-- VIP scan intake — CaptureSession / CaptureImage for Ricoh fi-8170 path
-- Durable media model (docs/entities-v0.1.md §10). Intake quality now;
-- museum-tier capture adds rows with quality_tier = 'museum' later.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_media;
SET search_path TO vault_media, vault_evidence, vault_market, vault_core, public;

DO $$ BEGIN
  CREATE TYPE vault_media.capture_quality_tier AS ENUM ('intake', 'museum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vault_media.capture_purpose AS ENUM (
    'inventory_intake', 'museum_capture', 'grading'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vault_media.capture_face AS ENUM ('front', 'back', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vault_media.capture_session (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    device          TEXT,                          -- e.g. ricoh_fi8170
    calibration_ref TEXT,
    model_version   TEXT NOT NULL,                 -- scan-ingest@0.1.0
    tenant_id       UUID,
    purpose         vault_media.capture_purpose NOT NULL DEFAULT 'inventory_intake',
    quality_tier    vault_media.capture_quality_tier NOT NULL DEFAULT 'intake',
    category_hint   TEXT,                          -- sports | pokemon | mtg | …
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    prov_source     TEXT NOT NULL,
    prov_method     vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'verified'
);

CREATE INDEX IF NOT EXISTS idx_capture_session_device
  ON vault_media.capture_session (device, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_media.capture_image (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES vault_media.capture_session(id) ON DELETE CASCADE,
    content_hash    TEXT NOT NULL,
    storage_ref     TEXT NOT NULL,
    preprocessing_steps TEXT[] NOT NULL DEFAULT '{}',
    face            vault_media.capture_face NOT NULL DEFAULT 'unknown',
    quality_tier    vault_media.capture_quality_tier NOT NULL DEFAULT 'intake',
    unit_index      INTEGER,
    mime_type       TEXT NOT NULL DEFAULT 'image/jpeg',
    byte_length     BIGINT,
    raw_snapshot_id UUID REFERENCES vault_evidence.raw_snapshots(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    prov_source     TEXT NOT NULL,
    prov_method     vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'verified',
    CONSTRAINT capture_image_hash_unique UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_capture_image_session
  ON vault_media.capture_image (session_id, unit_index);

-- Scan intake batch / unit review state (API may also keep an in-memory store)
CREATE TABLE IF NOT EXISTS vault_media.scan_batch (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES vault_media.capture_session(id) ON DELETE CASCADE,
    device          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'review', 'closed')),
    category_hint   TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_media.scan_unit (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    batch_id        UUID NOT NULL REFERENCES vault_media.scan_batch(id) ON DELETE CASCADE,
    unit_index      INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'captured',
    category_hint   TEXT,
    front_storage_ref TEXT NOT NULL,
    front_content_hash TEXT NOT NULL,
    back_storage_ref TEXT,
    back_content_hash TEXT,
    ocr_text        TEXT,
    selected_candidate_key TEXT,
    holding_id      UUID,
    raw_snapshot_id UUID REFERENCES vault_evidence.raw_snapshots(id),
    -- Logical link to vault_market.id_observation (BIGSERIAL legacy) or future UUID row
    id_observation_ref TEXT,
    ebay_listing_draft_id UUID,
    duplicate_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    decision_action TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id, unit_index)
);

CREATE INDEX IF NOT EXISTS idx_scan_unit_status
  ON vault_media.scan_unit (status)
  WHERE status IN ('needs_review', 'duplicate_alert');

COMMENT ON TABLE vault_media.capture_session IS
  'Controlled imaging session. intake = Ricoh/document scan; museum = future high-res station.';
COMMENT ON TABLE vault_media.scan_unit IS
  'Card unit in an intake batch: ID candidates → duplicate alert → confirmed holding.';
