-- ============================================================================
-- CLZ inbox sync — mark holdings absent from the latest export without DELETE
-- ============================================================================

BEGIN;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ;

COMMENT ON COLUMN vault_collection.holding.dropped_at IS
    'Set when this CLZ holding is missing from the latest import snapshot. NULL = still owned. Never DELETE holdings for a missing export row.';

CREATE INDEX IF NOT EXISTS idx_holding_active
    ON vault_collection.holding (source)
    WHERE dropped_at IS NULL;

COMMIT;
