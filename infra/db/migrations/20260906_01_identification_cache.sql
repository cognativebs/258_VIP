-- ============================================================================
-- Durable identification cache (ADR 0010 §5 / plan 0001 Phase 0 leftover).
-- Keyed on scan content_hash + resolver version so a catalog upgrade misses
-- instead of silently serving stale candidates. Not raw_snapshots: that table
-- is unique on content_hash and already holds the scan bytes themselves.
-- ============================================================================

BEGIN;

SET search_path TO vault_media, public;

CREATE TABLE IF NOT EXISTS vault_media.identification_cache (
    content_hash        TEXT NOT NULL,
    resolver_version    TEXT NOT NULL,
    payload             JSONB NOT NULL,
    provider_calls      INTEGER NOT NULL DEFAULT 0
                        CHECK (provider_calls >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (content_hash, resolver_version)
);

CREATE INDEX IF NOT EXISTS idx_identification_cache_created
  ON vault_media.identification_cache (created_at DESC);

COMMENT ON TABLE vault_media.identification_cache IS
  'Resolver output keyed by scan content_hash. Same bytes + same resolver version must not re-call providers.';

COMMIT;
