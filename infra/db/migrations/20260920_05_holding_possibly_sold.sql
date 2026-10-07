-- CLZ DIFF importer: disappeared holdings are flagged for review, never deleted.

BEGIN;

SET search_path TO vault_collection, public;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS possibly_sold BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_holding_possibly_sold
  ON vault_collection.holding (source)
  WHERE possibly_sold AND dropped_at IS NULL;

COMMENT ON COLUMN vault_collection.holding.possibly_sold IS
  'Set by the CLZ DIFF importer when a record is missing from a new export. Never auto-cleared. Never DELETE. Operator reviews before treating as sold.';

COMMIT;
