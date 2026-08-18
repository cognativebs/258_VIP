-- ============================================================================
-- 11_prediction_ledger.sql
--
-- VIP Intelligence Core: Prediction Ledger.
--
-- Every prediction VIP makes gets frozen here and scored later, rather than
-- silently replaced by the next prediction. This is what lets VIP eventually
-- say things like "our 12-month SIR predictions were 74% directionally
-- correct, but we underestimate post-release compression" instead of just
-- restating whatever the most recent guess was.
--
-- Design rule: a row, once resolved, is never edited again. Resolution
-- fields (actual_price, actual_direction, forecast_error, explanation,
-- model_adjustment) are NULL until resolves_at has passed and someone/something
-- records the outcome. Until then the row is a live, unresolved prediction.
--
-- Test fixture (do not delete, used for acceptance testing):
--   Mega Greninja ex SIR — $230 at prediction time, 90-day horizon,
--   55% probability down / 30% sideways / 15% higher.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

CREATE TABLE vault_core.prediction (
    id                   UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id             UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,

    -- Frozen at prediction time — never edited
    predicted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    price_at_prediction  NUMERIC(12,2) NOT NULL,
    horizon_days         INTEGER NOT NULL,
    resolves_at          TIMESTAMPTZ GENERATED ALWAYS AS (predicted_at + (horizon_days || ' days')::interval) STORED,

    -- Probability distribution — must sum to ~1.0, enforced below
    probability_down     NUMERIC(4,3) NOT NULL,
    probability_sideways NUMERIC(4,3) NOT NULL,
    probability_up       NUMERIC(4,3) NOT NULL,

    assumptions          TEXT,
    evidence_ids         UUID[],              -- FKs into vault_core.evidence_card, populated once 12_evidence_engine.sql lands
    confidence           NUMERIC(4,3),
    model_version         TEXT NOT NULL DEFAULT 'manual',

    -- Resolution — NULL until resolves_at has passed and outcome is recorded
    actual_price          NUMERIC(12,2),
    actual_direction       TEXT,               -- 'down','sideways','up' — set only at resolution
    forecast_error         NUMERIC(12,4),       -- signed error, definition left to scoring job
    explanation             TEXT,
    model_adjustment        TEXT,
    resolved_at              TIMESTAMPTZ,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_probability_sum CHECK (
        probability_down + probability_sideways + probability_up BETWEEN 0.98 AND 1.02
    ),
    CONSTRAINT chk_resolution_consistency CHECK (
        (resolved_at IS NULL AND actual_price IS NULL AND actual_direction IS NULL)
        OR
        (resolved_at IS NOT NULL AND actual_price IS NOT NULL AND actual_direction IS NOT NULL)
    ),
    CONSTRAINT chk_actual_direction CHECK (
        actual_direction IS NULL OR actual_direction IN ('down', 'sideways', 'up')
    )
);

CREATE INDEX idx_prediction_asset      ON vault_core.prediction(asset_id);
CREATE INDEX idx_prediction_unresolved ON vault_core.prediction(resolves_at)
    WHERE resolved_at IS NULL;
CREATE INDEX idx_prediction_model      ON vault_core.prediction(model_version);

COMMENT ON TABLE vault_core.prediction IS
    'Frozen, timestamped predictions with later-recorded outcomes. Rows are append-only until resolution; resolution fields are the only fields ever written after insert.';

CREATE OR REPLACE FUNCTION vault_core.prediction_protect_forecast()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'prediction rows are never deleted; resolve or leave unresolved';
    END IF;
    IF OLD.resolved_at IS NOT NULL THEN
        RAISE EXCEPTION 'resolved predictions are immutable';
    END IF;
    IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.predicted_at IS DISTINCT FROM OLD.predicted_at
       OR NEW.price_at_prediction IS DISTINCT FROM OLD.price_at_prediction
       OR NEW.horizon_days IS DISTINCT FROM OLD.horizon_days
       OR NEW.probability_down IS DISTINCT FROM OLD.probability_down
       OR NEW.probability_sideways IS DISTINCT FROM OLD.probability_sideways
       OR NEW.probability_up IS DISTINCT FROM OLD.probability_up
       OR NEW.assumptions IS DISTINCT FROM OLD.assumptions
       OR NEW.evidence_ids IS DISTINCT FROM OLD.evidence_ids
       OR NEW.confidence IS DISTINCT FROM OLD.confidence
       OR NEW.model_version IS DISTINCT FROM OLD.model_version
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'prediction forecast fields are immutable; only resolution fields may be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prediction_protect_forecast
    BEFORE UPDATE OR DELETE ON vault_core.prediction
    FOR EACH ROW
    EXECUTE FUNCTION vault_core.prediction_protect_forecast();

-- Convenience view: predictions that are past due for scoring
CREATE VIEW vault_core.prediction_needs_scoring AS
    SELECT * FROM vault_core.prediction
    WHERE resolved_at IS NULL AND resolves_at <= now();

COMMENT ON VIEW vault_core.prediction_needs_scoring IS
    'Predictions whose horizon has passed but no outcome has been recorded yet. Poll this to drive the resolution workflow.';

-- Convenience view: directional accuracy by model_version
CREATE VIEW vault_core.prediction_calibration AS
    SELECT
        model_version,
        COUNT(*) AS resolved_count,
        ROUND(AVG(CASE
            WHEN (probability_down > probability_up AND probability_down > probability_sideways AND actual_direction = 'down') THEN 1
            WHEN (probability_up > probability_down AND probability_up > probability_sideways AND actual_direction = 'up') THEN 1
            WHEN (probability_sideways > probability_up AND probability_sideways > probability_down AND actual_direction = 'sideways') THEN 1
            ELSE 0
        END) * 100, 1) AS directional_accuracy_pct,
        ROUND(AVG(forecast_error), 4) AS avg_forecast_error
    FROM vault_core.prediction
    WHERE resolved_at IS NOT NULL
    GROUP BY model_version;

COMMENT ON VIEW vault_core.prediction_calibration IS
    'Directional accuracy and average error per model version, once predictions resolve. This is the self-correction signal.';

COMMIT;
