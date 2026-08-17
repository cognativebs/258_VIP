-- Store full CLZ export row for terminal/API field compatibility.
BEGIN;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS clz_metadata JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN vault_collection.holding.clz_metadata IS
    'Full CLZ-enriched inventory row at import time; API overlays live holding columns.';

COMMIT;
