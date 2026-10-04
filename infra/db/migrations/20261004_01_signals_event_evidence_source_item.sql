-- PokéBeach connector step 6: source items clustered onto spine events (2026-10-04, Greg: "go with the lean").
-- 1. vault_signals.event_evidence.source_item_id: the item a row is evidence for. In homepage-only mode
--    every article from one fetch shares the homepage raw_document, so (event_id, raw_document_id) can no
--    longer be unique on its own. event_evidence_document_once is replaced (operator-approved) by a unique
--    index on (event_id, raw_document_id, source_item_id) NULLS NOT DISTINCT, which is identical for every
--    existing row (all have source_item_id NULL).
-- 2. An item is PRIMARY evidence for at most one event: the first event wins and nothing is moved.
-- No vault_market. No priced_unit. No source row is enabled. Re-runnable.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

ALTER TABLE vault_signals.event_evidence
  ADD COLUMN IF NOT EXISTS source_item_id UUID REFERENCES vault_signals.source_item (id) ON DELETE RESTRICT;

COMMENT ON COLUMN vault_signals.event_evidence.source_item_id IS
  'The source item (vault_signals.source_item) this row is evidence for, when the source has item identity. NULL for feed headlines identified by item_ref.';

CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_document_item_once
  ON vault_signals.event_evidence (event_id, raw_document_id, source_item_id) NULLS NOT DISTINCT;

ALTER TABLE vault_signals.event_evidence DROP CONSTRAINT IF EXISTS event_evidence_document_once;

CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_item_primary_once
  ON vault_signals.event_evidence (source_item_id)
  WHERE role = 'PRIMARY' AND source_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_evidence_source_item_idx
  ON vault_signals.event_evidence (source_item_id)
  WHERE source_item_id IS NOT NULL;

COMMENT ON TABLE vault_signals.event_evidence IS
  'Document membership in an event. independent_source_count is the number of distinct independence_group values on PRIMARY rows. DERIVATIVE and DISCUSSION rows are stored for attention and do not corroborate. Source items carry source_item_id; an item is PRIMARY evidence for one event only.';

COMMIT;
