-- SIGNALS v1 spine P5 — prediction rows. Start the clock.
-- Measurement rows are seeded at +7, +30, +90, +180, +365 days on insert.
-- subject_ref is TEXT. No priced_unit. No thesis table. No vault_market writes.

BEGIN;

SET search_path TO vault_signals, vault_evidence, public;

CREATE SCHEMA IF NOT EXISTS vault_signals;

CREATE TABLE IF NOT EXISTS vault_signals.prediction (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL,
    subject_ref         TEXT NOT NULL,
    subject_kind        TEXT NOT NULL,
    claim_text          TEXT NOT NULL,
    expected_low        NUMERIC,
    expected_high       NUMERIC,
    expected_unit       TEXT,
    downside_case       TEXT,
    confidence          NUMERIC(4,3) NOT NULL
                        CHECK (confidence >= 0 AND confidence <= 1),
    horizon_days        INTEGER NOT NULL CHECK (horizon_days > 0),
    expires_at          TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open',
    source_signal_id    UUID REFERENCES vault_signals.signal (id) ON DELETE RESTRICT,
    source_thesis_ref   TEXT,
    prov_source         TEXT NOT NULL,
    prov_method         vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version   TEXT NOT NULL,
    prov_confidence     NUMERIC(4,3) NOT NULL
                        CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification   vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes          TEXT,
    CONSTRAINT prediction_range_ordered CHECK (
      expected_low IS NULL OR expected_high IS NULL OR expected_low <= expected_high
    )
);

CREATE INDEX IF NOT EXISTS prediction_signal_idx
  ON vault_signals.prediction (source_signal_id);

CREATE INDEX IF NOT EXISTS prediction_expires_idx
  ON vault_signals.prediction (expires_at);

COMMENT ON TABLE vault_signals.prediction IS
  'A claim with a range and a clock. expected_low and expected_high are a range. subject_ref is TEXT until the entity layer exists. Crude and real: measurement rows are the point of this table.';

COMMENT ON COLUMN vault_signals.prediction.subject_ref IS
  'TEXT placeholder. Not a foreign key. Not priced_unit_id.';

COMMENT ON COLUMN vault_signals.prediction.source_thesis_ref IS
  'TEXT placeholder. The thesis table is deferred. Nullable.';

CREATE TABLE IF NOT EXISTS vault_signals.prediction_measurement (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    prediction_id       UUID NOT NULL REFERENCES vault_signals.prediction (id) ON DELETE RESTRICT,
    due_at              TIMESTAMPTZ NOT NULL,
    measured_at         TIMESTAMPTZ,
    observed_value      NUMERIC,
    direction_correct   BOOLEAN,
    magnitude_error     NUMERIC,
    timing_error        NUMERIC,
    notes               TEXT,
    CONSTRAINT prediction_measurement_due_once UNIQUE (prediction_id, due_at)
);

CREATE INDEX IF NOT EXISTS prediction_measurement_due_idx
  ON vault_signals.prediction_measurement (due_at)
  WHERE measured_at IS NULL;

COMMENT ON TABLE vault_signals.prediction_measurement IS
  'One row per scoring date. Insert of a prediction seeds due_at at +7, +30, +90, +180, and +365 days. Outcomes stay null until someone measures them.';

CREATE OR REPLACE FUNCTION vault_signals.prediction_seed_measurements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  days integer;
BEGIN
  FOREACH days IN ARRAY ARRAY[7, 30, 90, 180, 365] LOOP
    INSERT INTO vault_signals.prediction_measurement (prediction_id, due_at)
    VALUES (NEW.id, NEW.created_at + make_interval(days => days));
  END LOOP;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION vault_signals.prediction_seed_measurements() IS
  'Starts the measurement clock. Horizons are the plan seed: 7, 30, 90, 180, 365 days from created_at.';

DROP TRIGGER IF EXISTS trg_prediction_seed_measurements ON vault_signals.prediction;
CREATE TRIGGER trg_prediction_seed_measurements
  AFTER INSERT ON vault_signals.prediction
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.prediction_seed_measurements();

COMMIT;
