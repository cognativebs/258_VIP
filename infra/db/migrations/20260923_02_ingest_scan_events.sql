-- Scan capture is an append-only event log.
-- Undo sets voided; the row stays. Quantity is derived from events that are not voided.

BEGIN;

SET search_path TO vault_media, public;

ALTER TABLE vault_media.ingest_row
    ADD COLUMN IF NOT EXISTS voided BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

COMMENT ON COLUMN vault_media.ingest_row.voided IS
    'Undo last. The scan event stays in the log and is excluded from the quantity rollup. Never a delete.';

COMMIT;
