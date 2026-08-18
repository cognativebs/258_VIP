-- ============================================================================
-- 14_transaction_intelligence.sql
--
-- VIP Transaction Intelligence: Acquisition Underwriting Engine, Grading
-- Optimizer (both APPROVED, build real logic), and Portfolio Consolidation
-- Engine (schema only — blocked on collection_synergy_score, see
-- 15_collection_intelligence.sql).
--
-- Test fixtures:
--   Underwriting — $700 offer / $1,045 conservative LP value = 1.49x coverage
--     ratio. 1.30x suggested minimum for uncertain vintage lots.
--   Grading — Flareon / Jolteon / Snorlax / Chansey manual PSA-tier math.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

-- ---------------------------------------------------------------------------
-- Acquisition Underwriting Engine
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.acquisition_underwriting (
    id                         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id                   UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,
    lot_description            TEXT,           -- for multi-asset lot underwriting where a single asset_id doesn't fit

    evaluated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    asking_price                NUMERIC(12,2) NOT NULL,
    offer_price                  NUMERIC(12,2) NOT NULL,
    conservative_raw_value        NUMERIC(12,2) NOT NULL,
    likely_raw_value               NUMERIC(12,2),
    museum_keep_value                NUMERIC(12,2),
    liquidation_value                 NUMERIC(12,2),
    selling_costs                      NUMERIC(12,2),
    expected_days_to_liquidate          INTEGER,

    acquisition_coverage_ratio           NUMERIC(6,3) GENERATED ALWAYS AS (
                                              CASE WHEN offer_price > 0
                                                   THEN ROUND(conservative_raw_value / offer_price, 3)
                                                   ELSE NULL END
                                          ) STORED,
    coverage_ratio_minimum_threshold      NUMERIC(6,3) NOT NULL DEFAULT 1.30,

    expected_profit                          NUMERIC(12,2),
    capital_at_risk                           NUMERIC(12,2),
    confidence                                 NUMERIC(4,3),

    linked_recommendation_id                    UUID REFERENCES vault_core.recommendation(id) ON DELETE SET NULL,
    completed_transaction                        BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at                                     TIMESTAMPTZ,   -- set once completed_transaction flips true; row becomes immutable at app layer past this point

    notes                                          TEXT
);

CREATE INDEX idx_underwriting_asset      ON vault_core.acquisition_underwriting(asset_id);
CREATE INDEX idx_underwriting_ratio      ON vault_core.acquisition_underwriting(acquisition_coverage_ratio);

COMMENT ON TABLE vault_core.acquisition_underwriting IS
    'Acquisition Coverage Ratio = conservative_raw_value / offer_price, computed as a generated column so it can never drift from its inputs. Rows below coverage_ratio_minimum_threshold are flagged for human review, never auto-blocked. Once completed_transaction=true and locked_at is set, treat the row as immutable at the application layer.';

-- below_threshold is deliberately NOT a stored/generated column: it's a
-- comparison between two other columns (one of them mutable), which Postgres
-- generated columns can express fine in principle, but keeping the threshold
-- comparison in a view rather than baked into the base table makes it trivial
-- to change coverage_ratio_minimum_threshold per-row later without a schema
-- migration. Use this view for all reads that need the flag.
CREATE VIEW vault_core.acquisition_underwriting_flagged AS
    SELECT *,
        (acquisition_coverage_ratio < coverage_ratio_minimum_threshold) AS below_threshold
    FROM vault_core.acquisition_underwriting;

-- ---------------------------------------------------------------------------
-- Grading Optimizer / Intelligent Submission Manager
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.grading_evaluation (
    id                            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    holding_id                    UUID NOT NULL REFERENCES vault_collection.holding(id) ON DELETE CASCADE,

    evaluated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    raw_value                     NUMERIC(12,2) NOT NULL,

    psa7_probability              NUMERIC(4,3),
    psa7_value                    NUMERIC(12,2),
    psa8_probability              NUMERIC(4,3),
    psa8_value                    NUMERIC(12,2),
    psa9_probability              NUMERIC(4,3),
    psa9_value                    NUMERIC(12,2),
    psa10_probability             NUMERIC(4,3),
    psa10_value                   NUMERIC(12,2),

    grading_cost                  NUMERIC(10,2) NOT NULL,
    shipping_cost                 NUMERIC(10,2) NOT NULL DEFAULT 0,
    insurance_cost                NUMERIC(10,2) NOT NULL DEFAULT 0,
    selling_expense_pct           NUMERIC(5,4) NOT NULL DEFAULT 0.13,   -- default marketplace fee assumption; override per case
    opportunity_cost              NUMERIC(10,2) NOT NULL DEFAULT 0,

    expected_grading_value        NUMERIC(12,2) GENERATED ALWAYS AS (
        COALESCE(psa7_probability * psa7_value, 0) +
        COALESCE(psa8_probability * psa8_value, 0) +
        COALESCE(psa9_probability * psa9_value, 0) +
        COALESCE(psa10_probability * psa10_value, 0)
    ) STORED,

    expected_incremental_profit   NUMERIC(12,2),   -- computed at app layer: expected_grading_value * (1-selling_expense_pct)
                                                     -- - raw_value - grading_cost - shipping_cost - insurance_cost - opportunity_cost
                                                     -- kept as a plain column (not generated) since selling_expense_pct application
                                                     -- order is a judgment call worth keeping visible/editable, not baked into DDL

    grading_opportunity_score     NUMERIC(5,2),     -- 0-100, stored (not computed-on-read) so it can be indexed for a submission queue
    recommendation                TEXT NOT NULL,

    grader_routing                TEXT,             -- 'PSA','CGC','BGS','TAG' — which grader this evaluation targets
    notes                          TEXT,

    CONSTRAINT chk_grading_recommendation CHECK (
        recommendation IN ('grade', 'hold_raw', 'sell_raw', 'inspect_further')
    )
);

CREATE INDEX idx_grading_holding    ON vault_core.grading_evaluation(holding_id);
CREATE INDEX idx_grading_gos        ON vault_core.grading_evaluation(grading_opportunity_score DESC);
CREATE INDEX idx_grading_rec        ON vault_core.grading_evaluation(recommendation);

COMMENT ON TABLE vault_core.grading_evaluation IS
    'Answers "at what grade does grading create incremental economic value" not "is this worth grading." expected_grading_value is a generated column (probability-weighted sum across PSA 7-10); expected_incremental_profit is app-computed to keep the fee/opportunity-cost order-of-operations visible and adjustable rather than baked into a DDL formula.';

-- ---------------------------------------------------------------------------
-- Portfolio Consolidation Engine — SCHEMA ONLY, blocked on collection_synergy_score
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.portfolio_consolidation_review (
    id                       UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    evaluated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    collection_quality_density_before  NUMERIC(10,4),
    collection_quality_density_after   NUMERIC(10,4),

    consolidation_candidate_holding_ids  UUID[],   -- holdings suggested to sell (dupes, secondary rookies, etc.)
    keep_holding_ids                       UUID[],   -- holdings suggested to keep
    redeploy_suggestion                     TEXT,
    capital_freed                            NUMERIC(12,2),

    status                                     TEXT NOT NULL DEFAULT 'schema_placeholder'
);

COMMENT ON TABLE vault_core.portfolio_consolidation_review IS
    'SCHEMA ONLY — do not generate real consolidation suggestions until collection_synergy_score exists (see 15_collection_intelligence.sql). Collection Quality Density formula references synergy score directly.';

COMMIT;
