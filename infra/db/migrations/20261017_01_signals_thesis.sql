-- SIGNALS → Thesis (operator decision 2026-10-17: new thesis table; ADR 0013 amendment).
-- vault_signals.thesis: a stated belief with a horizon and an action, written by the daily
-- Orchestr8 signals brief as draft · inferred · unverified, or by the operator. Only the operator
-- moves a thesis to active, retired or invalidated; Orchestr8's later verdicts are recorded in
-- last_review and never change status. vault_signals.thesis_signal links each thesis to the
-- signals it rests on (no thesis without evidence). prediction.source_thesis_ref stays TEXT and
-- carries the thesis id. Orchestr8 run ids are text (the run bundle lives in Orchestr8's .runs/).
-- No priced_unit, no vault_market, no stored priority. Re-runnable.

BEGIN;

SET search_path TO vault_signals, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_signals.thesis (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    claim               TEXT NOT NULL CHECK (char_length(claim) BETWEEN 1 AND 600),
    claim_key           TEXT NOT NULL CHECK (char_length(claim_key) >= 1),
    domain              TEXT NOT NULL,
    subject_refs        TEXT[] NOT NULL DEFAULT '{}',
    horizon_days        INTEGER NOT NULL CHECK (horizon_days > 0 AND horizon_days <= 730),
    action              TEXT NOT NULL
                        CHECK (action IN ('Buy', 'Hold', 'Grade', 'Sell', 'Lot', 'Pass', 'Watch')),
    withheld            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(withheld) = 'array'),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reasons             TEXT[] NOT NULL CHECK (cardinality(reasons) >= 1),
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'retired', 'invalidated')),
    status_changed_at   TIMESTAMPTZ,
    status_changed_by   TEXT,
    status_note         TEXT,
    orchestr8_run_id    TEXT,
    last_review         JSONB,
    prov_source         TEXT NOT NULL,
    prov_method         vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version   TEXT NOT NULL,
    prov_confidence     NUMERIC(4,3) NOT NULL
                        CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification   vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes          TEXT,
    CONSTRAINT thesis_status_change_named CHECK (
      status = 'draft' OR (status_changed_at IS NOT NULL AND status_changed_by IS NOT NULL)
    )
);

COMMENT ON TABLE vault_signals.thesis IS
  'A stated belief with a horizon and an action (Buy / Hold / Grade / Sell / Lot / Pass / Watch), resting on linked signals. Orchestr8 writes drafts (inferred · unverified); only the operator sets active, retired or invalidated. Buy, Sell and Grade without market data are stored as Watch with the proposed action in withheld. Not a price.';

COMMENT ON COLUMN vault_signals.thesis.claim_key IS
  'Normalized claim (lowercase, letters and digits) so a repeated Orchestr8 claim links new signals to the open thesis instead of duplicating it.';

COMMENT ON COLUMN vault_signals.thesis.last_review IS
  'Latest Orchestr8 verdict on this thesis {runId, verdict: holds|weakened|invalidated, reason, at}. Advisory: never changes status.';

COMMENT ON COLUMN vault_signals.thesis.orchestr8_run_id IS
  'Orchestr8 run that first proposed the thesis (text; the bundle lives in orchestr8/.runs/). Not a foreign key.';

CREATE UNIQUE INDEX IF NOT EXISTS thesis_open_claim_once
  ON vault_signals.thesis (claim_key)
  WHERE status IN ('draft', 'active');

CREATE INDEX IF NOT EXISTS thesis_status_idx
  ON vault_signals.thesis (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS vault_signals.thesis_signal (
    thesis_id           UUID NOT NULL REFERENCES vault_signals.thesis (id) ON DELETE RESTRICT,
    signal_id           UUID NOT NULL REFERENCES vault_signals.signal (id) ON DELETE RESTRICT,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    linked_by           TEXT NOT NULL,
    PRIMARY KEY (thesis_id, signal_id)
);

COMMENT ON TABLE vault_signals.thesis_signal IS
  'Which signals a thesis rests on. linked_by names the Orchestr8 run or the operator. Append-only.';

CREATE INDEX IF NOT EXISTS thesis_signal_signal_idx
  ON vault_signals.thesis_signal (signal_id);

COMMIT;
