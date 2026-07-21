-- ============================================================================
-- VIP Phase 1 — Immutable raw snapshots + provenance foundations
-- Schema: vault_evidence
-- Rule: raw_snapshots rows are INSERT-only. No UPDATE. No DELETE in app code.
-- Legacy catalog tables in 01–08 remain; this adds the trust layer beside them.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_evidence;
SET search_path TO vault_evidence, public;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;

-- ----------------------------------------------------------------------------
-- PROVENANCE method / verification enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE vault_evidence.provenance_method AS ENUM (
    'observed', 'normalized', 'inferred', 'opinion', 'recommendation'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vault_evidence.verification_status AS ENUM (
    'verified', 'unverified', 'disputed', 'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- RAW SNAPSHOTS — immutable import payloads (F-05)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_evidence.raw_snapshots (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source          TEXT NOT NULL,                 -- adapter id: clz_xml, tcg_csv, …
    content_hash    TEXT NOT NULL,                 -- sha256 hex
    content_type    TEXT NOT NULL DEFAULT 'application/xml',
    payload         TEXT,                          -- inline for small imports
    storage_ref     TEXT,                          -- object store path when payload omitted
    byte_length     BIGINT NOT NULL CHECK (byte_length >= 0),
    record_count    INTEGER,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Provenance of the snapshot itself (always observed)
    prov_source     TEXT NOT NULL,
    prov_method     vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'verified',
    CONSTRAINT raw_snapshots_payload_or_ref CHECK (
      payload IS NOT NULL OR storage_ref IS NOT NULL
    ),
    CONSTRAINT raw_snapshots_hash_unique UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_snapshots_source
  ON vault_evidence.raw_snapshots (source, ingested_at DESC);

COMMENT ON TABLE vault_evidence.raw_snapshots IS
  'Immutable source import payloads. Application code must never UPDATE these rows.';

-- Block UPDATEs at the database level
CREATE OR REPLACE FUNCTION vault_evidence.forbid_raw_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'raw_snapshots are immutable: % is forbidden', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_snapshots_no_update ON vault_evidence.raw_snapshots;
CREATE TRIGGER trg_raw_snapshots_no_update
  BEFORE UPDATE ON vault_evidence.raw_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION vault_evidence.forbid_raw_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_raw_snapshots_no_delete ON vault_evidence.raw_snapshots;
CREATE TRIGGER trg_raw_snapshots_no_delete
  BEFORE DELETE ON vault_evidence.raw_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION vault_evidence.forbid_raw_snapshot_mutation();

-- ----------------------------------------------------------------------------
-- Optional link: holding → snapshot that produced it (additive to 07)
-- Applied only when vault_collection.holding exists.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'vault_collection' AND table_name = 'holding'
  ) THEN
    ALTER TABLE vault_collection.holding
      ADD COLUMN IF NOT EXISTS raw_snapshot_id UUID
        REFERENCES vault_evidence.raw_snapshots(id);
  END IF;
END $$;
