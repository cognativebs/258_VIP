-- Keep the reason an operator gives when rejecting a scanned card (finish plan Q11, owner 2026-11-23).
-- Until now the reason was accepted by the API and discarded. One nullable column; existing rows
-- stay NULL (no reason was recorded for them). Re-runnable.

BEGIN;

SET search_path TO vault_media, public;

ALTER TABLE vault_media.scan_unit
    ADD COLUMN IF NOT EXISTS reject_reason TEXT;

COMMENT ON COLUMN vault_media.scan_unit.reject_reason IS
  'Operator''s reason when the card was rejected (per-card or bulk "Reject all no-match"). NULL when not rejected or rejected before 2026-11-23.';

COMMIT;
