-- SIGNALS v1 — read-time priority from the current weight set (ADR 0013 G-5, option C).
-- Priority is never a column. signal_priority computes it from the three stored
-- scores and the current score_weight_set row; signal_influence decays that.
-- Formula weighted_product_v1: base_confidence^a * base_impact^b * (1 - noise_probability)^c.
-- The v0 row uses 1/1/1 (the spine's structural product) · unverified · not Section 5.
-- Predictions record which weight set was current when they were written.
-- Additive and re-runnable. No vault_market writes. No source rows touched.

BEGIN;

SET search_path TO vault_signals, vault_core, vault_evidence, public;

ALTER TABLE vault_signals.score_weight_set
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN vault_signals.score_weight_set.is_current IS
  'The weight set signal_priority reads by default. At most one row. Switching sets re-ranks every signal at read time; nothing is rewritten.';

CREATE UNIQUE INDEX IF NOT EXISTS score_weight_set_one_current
  ON vault_signals.score_weight_set ((true))
  WHERE is_current;

-- A row can only become current if signal_priority can evaluate it.
DO $$
BEGIN
  ALTER TABLE vault_signals.score_weight_set
    ADD CONSTRAINT score_weight_set_current_is_evaluable CHECK (
      NOT is_current
      OR (
        weights_json->>'formula' = 'weighted_product_v1'
        AND (weights_json->'exponents'->>'base_confidence')::numeric >= 0
        AND (weights_json->'exponents'->>'base_impact')::numeric >= 0
        AND (weights_json->'exponents'->>'one_minus_noise')::numeric >= 0
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

INSERT INTO vault_signals.score_weight_set (name, version, weights_json, verified, is_current)
SELECT
  'spine-v0-product',
  '0.1.0',
  jsonb_build_object(
    'formula', 'weighted_product_v1',
    'exponents', jsonb_build_object(
      'base_confidence', 1,
      'base_impact', 1,
      'one_minus_noise', 1
    ),
    'stored_inputs', jsonb_build_array('base_confidence', 'base_impact', 'noise_probability'),
    'excluded_inputs', jsonb_build_array(
      'relevance', 'novelty', 'magnitude', 'actionability', 'source_quality', 'attention'
    ),
    'notes', 'v0 exponents 1/1/1 · unverified. Not Section 5. Replace with a new row calibrated from resolved predictions (ADR 0013 G-5).'
  ),
  false,
  NOT EXISTS (SELECT 1 FROM vault_signals.score_weight_set WHERE is_current)
ON CONFLICT (name, version) DO NOTHING;

CREATE OR REPLACE FUNCTION vault_signals.signal_priority(
  p_signal_id uuid,
  p_weight_set_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  w jsonb;
  a numeric;
  b numeric;
  c numeric;
  conf numeric;
  impact numeric;
  noise numeric;
BEGIN
  IF p_weight_set_id IS NULL THEN
    SELECT weights_json INTO w FROM vault_signals.score_weight_set WHERE is_current;
  ELSE
    SELECT weights_json INTO w FROM vault_signals.score_weight_set WHERE id = p_weight_set_id;
  END IF;

  IF w IS NULL THEN
    RAISE EXCEPTION 'signal_priority: no weight set (requested %, or none is current)', p_weight_set_id
      USING ERRCODE = 'P0002';
  END IF;
  IF w->>'formula' IS DISTINCT FROM 'weighted_product_v1' THEN
    RAISE EXCEPTION 'signal_priority: unsupported formula %', coalesce(w->>'formula', '(none)')
      USING ERRCODE = '22023';
  END IF;

  a := (w->'exponents'->>'base_confidence')::numeric;
  b := (w->'exponents'->>'base_impact')::numeric;
  c := (w->'exponents'->>'one_minus_noise')::numeric;
  IF a IS NULL OR b IS NULL OR c IS NULL OR a < 0 OR b < 0 OR c < 0 THEN
    RAISE EXCEPTION 'signal_priority: exponents must be present and non-negative'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.base_confidence, s.base_impact, s.noise_probability
    INTO conf, impact, noise
    FROM vault_signals.signal s
   WHERE s.id = p_signal_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN round(power(conf, a) * power(impact, b) * power(1 - noise, c), 6);
END;
$$;

COMMENT ON FUNCTION vault_signals.signal_priority(uuid, uuid) IS
  'Read-time priority (G-5 option C). weighted_product_v1 over the three stored scores, exponents from score_weight_set (the current row unless one is named). Does not read attention_observation. Nothing stores the result.';

CREATE OR REPLACE FUNCTION vault_signals.signal_influence(
  p_signal_id uuid,
  p_at timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT round(
    vault_signals.signal_priority(s.id) * power(
      0.5::numeric,
      GREATEST(EXTRACT(EPOCH FROM (p_at - s.first_seen_at))::numeric, 0)
        / 3600.0
        / st.default_half_life_hours
    ),
    6
  )
    FROM vault_signals.signal s
    JOIN vault_signals.signal_type st ON st.id = s.signal_type_id
   WHERE s.id = p_signal_id;
$$;

COMMENT ON FUNCTION vault_signals.signal_influence(uuid, timestamptz) IS
  'Read-time decay (G-2). signal_priority * 0.5 ^ (hours_elapsed / half_life_hours). Half-life is signal_type.default_half_life_hours. Does not read attention_observation. Does not store a current value.';

ALTER TABLE vault_signals.prediction
  ADD COLUMN IF NOT EXISTS score_weight_set_id UUID
    REFERENCES vault_signals.score_weight_set (id) ON DELETE RESTRICT;

COMMENT ON COLUMN vault_signals.prediction.score_weight_set_id IS
  'Weight set current when the prediction was written. Filled on insert when omitted, so calibration can compare outcomes per weight set.';

CREATE OR REPLACE FUNCTION vault_signals.prediction_stamp_weight_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.score_weight_set_id IS NULL THEN
    SELECT id INTO NEW.score_weight_set_id
      FROM vault_signals.score_weight_set
     WHERE is_current;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION vault_signals.prediction_stamp_weight_set() IS
  'Stamps the current weight set on a new prediction when the writer did not name one.';

DROP TRIGGER IF EXISTS trg_prediction_stamp_weight_set ON vault_signals.prediction;
CREATE TRIGGER trg_prediction_stamp_weight_set
  BEFORE INSERT ON vault_signals.prediction
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.prediction_stamp_weight_set();

COMMIT;
