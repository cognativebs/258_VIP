-- Operator accept / reject marks on sell-queue advice (finish plan Q16, owner 2026-11-23: "new log").
-- Append-only decision log. It is deliberately NOT vault_collection.disposition_history (which the
-- eBay sell engine reads as an item's current disposition) and NOT inventory_transaction (buy / sell /
-- transfer only). A mark records what the operator decided about one piece of advice; it changes no
-- holding, disposition or listing. Changing your mind is a new row; the newest row per holding wins.
-- Re-runnable.

BEGIN;

SET search_path TO vault_collection, public;

CREATE TABLE IF NOT EXISTS vault_collection.sell_queue_decision (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    holding_ref             TEXT NOT NULL,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    decision                TEXT NOT NULL,
    recommended_action      TEXT NOT NULL,
    recommended_confidence  NUMERIC(4, 3) NOT NULL,
    advice_rule_version     TEXT NOT NULL,
    reason                  TEXT,
    decided_by              TEXT NOT NULL DEFAULT 'operator',
    decided_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT sell_queue_decision_decision_chk CHECK (decision IN ('accepted', 'rejected')),
    CONSTRAINT sell_queue_decision_action_chk
        CHECK (recommended_action IN ('Buy', 'Hold', 'Grade', 'Sell', 'Lot', 'Pass')),
    CONSTRAINT sell_queue_decision_confidence_chk
        CHECK (recommended_confidence >= 0 AND recommended_confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_sell_queue_decision_ref
    ON vault_collection.sell_queue_decision (holding_ref, decided_at DESC);

COMMENT ON TABLE vault_collection.sell_queue_decision IS
    'Append-only log of operator accept/reject marks on sell-queue advice (Q16). Records the advice as shown (action, confidence, rule version) and the operator''s reason. Changes no holding, disposition or listing; newest row per holding_ref is the current mark.';
COMMENT ON COLUMN vault_collection.sell_queue_decision.holding_ref IS
    'The sell-queue item id as shown (CLZ hash or holding UUID). holding_id is filled only when it resolves to a holding row.';

CREATE OR REPLACE FUNCTION vault_collection.sell_queue_decision_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'sell_queue_decision is append-only: record a new mark instead';
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_sell_queue_decision_append_only'
          AND tgrelid = 'vault_collection.sell_queue_decision'::regclass
    ) THEN
        CREATE TRIGGER trg_sell_queue_decision_append_only
            BEFORE UPDATE OR DELETE ON vault_collection.sell_queue_decision
            FOR EACH ROW EXECUTE FUNCTION vault_collection.sell_queue_decision_append_only();
    END IF;
END $$;

COMMIT;
