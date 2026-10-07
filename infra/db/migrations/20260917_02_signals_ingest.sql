-- ============================================================================
-- Signals ingest tables (the named Phase 2 blocker).
--
-- Job-feed JSON + RSS already exist. These tables make the raw snapshot
-- immutable and the normalized row regenerable (AGENTS.md rules 2–3).
--
-- Phase 2 scoring stays OFF until an operator confirms these tables are
-- populated and flips SIGNALS_INGESTION. Do not auto-enable scoring.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

CREATE TABLE IF NOT EXISTS vault_core.signals_raw (
    id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_id          TEXT NOT NULL,
    captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_sha256     TEXT NOT NULL,
    payload            JSONB NOT NULL,
    snapshot_path      TEXT,
    ingest_status      TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (source_id, payload_sha256),
    CONSTRAINT signals_raw_status_ok
      CHECK (ingest_status IN ('pending', 'complete', 'duplicate', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_signals_raw_source
  ON vault_core.signals_raw (source_id, captured_at DESC);

COMMENT ON TABLE vault_core.signals_raw IS
  'Immutable source snapshots for the Signals pipeline. Processed rows regenerate from payload. Never UPDATE/DELETE a completed snapshot.';

CREATE TABLE IF NOT EXISTS vault_core.signals_normalized (
    id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    raw_id             UUID NOT NULL REFERENCES vault_core.signals_raw (id) ON DELETE RESTRICT,
    source_id          TEXT NOT NULL,
    signal_type        TEXT NOT NULL,
    title              TEXT,
    body               TEXT NOT NULL,
    signal_date        TIMESTAMPTZ NOT NULL,
    novelty_score      NUMERIC(4,3),
    quarantine_status  TEXT NOT NULL,
    asset_id           UUID REFERENCES vault_core.asset (id) ON DELETE SET NULL,
    evidence_class     TEXT NOT NULL REFERENCES vault_core.evidence_class (evidence_class),
    rule_version       TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    source_url         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (raw_id),
    CONSTRAINT signals_normalized_quarantine_ok
      CHECK (quarantine_status IN ('active', 'quarantined', 'rejected')),
    CONSTRAINT signals_normalized_type_ok
      CHECK (signal_type IN ('news', 'market', 'supply', 'retail', 'reprint', 'auction'))
);

CREATE INDEX IF NOT EXISTS idx_signals_norm_source
  ON vault_core.signals_normalized (source_id, signal_date DESC);

CREATE INDEX IF NOT EXISTS idx_signals_norm_active
  ON vault_core.signals_normalized (quarantine_status, signal_date DESC)
  WHERE quarantine_status = 'active';

COMMENT ON TABLE vault_core.signals_normalized IS
  'Derived Signals rows. Regenerable from signals_raw. News is inferred · unverified — never a market fact.';

COMMIT;
