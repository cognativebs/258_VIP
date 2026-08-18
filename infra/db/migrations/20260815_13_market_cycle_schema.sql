-- ============================================================================
-- 13_market_cycle_schema.sql
--
-- VIP Intelligence Core: Market Cycle Detector + Buy Opportunity Scanner.
--
-- *** SCHEMA ONLY. DO NOT WRITE SCORING LOGIC AGAINST THIS MIGRATION. ***
--
-- Both systems need population growth, sales velocity, listing supply, and
-- social intensity — these are Signals-system inputs (signals_raw /
-- signals_normalized) which are still PROPOSED, not confirmed live. Writing
-- real classification logic before that data exists means either fake
-- numbers or a system that silently does nothing. Neither is acceptable.
--
-- What this migration DOES enable: manual/backfilled rows so real cases
-- (Drew Brees post-HOF) can be entered by hand as validation fixtures before
-- any automation exists. No cron job, no scheduled classification job should
-- reference these tables yet.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

CREATE TABLE vault_core.market_cycle_state (
    id                     UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id               UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,

    evaluated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    cycle_state            TEXT NOT NULL,
    bubble_risk_score      NUMERIC(5,2),   -- 0-100

    price_velocity         NUMERIC(10,4),
    price_vs_ath_pct       NUMERIC(6,2),
    sales_velocity         NUMERIC(10,4),
    listing_supply         INTEGER,
    population_growth_rate NUMERIC(6,4),
    release_age_days       INTEGER,
    reprint_risk           TEXT,           -- 'low','medium','high' — no confirmed reprint data source yet, kept free-ish
    popularity_signal      NUMERIC(5,2),
    liquidity_score        NUMERIC(6,2),

    data_source            TEXT NOT NULL DEFAULT 'manual',  -- 'manual' until signals pipeline exists
    notes                  TEXT,

    CONSTRAINT chk_cycle_state CHECK (
        cycle_state IN ('fomo', 'cooling', 'accumulation', 'recovery', 'blue_chip')
    ),
    CONSTRAINT chk_reprint_risk CHECK (
        reprint_risk IS NULL OR reprint_risk IN ('low', 'medium', 'high')
    )
);

CREATE INDEX idx_cycle_asset      ON vault_core.market_cycle_state(asset_id);
CREATE INDEX idx_cycle_evaluated  ON vault_core.market_cycle_state(evaluated_at);
CREATE INDEX idx_cycle_state      ON vault_core.market_cycle_state(cycle_state);

COMMENT ON TABLE vault_core.market_cycle_state IS
    'Probabilistic cycle classification per asset. data_source=manual until Signals ingestion is live — do not schedule automated classification against manual-only inputs.';

CREATE TABLE vault_core.buy_opportunity_scan (
    id                       UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id                 UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    market_cycle_state_id    UUID REFERENCES vault_core.market_cycle_state(id) ON DELETE SET NULL,

    scanned_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    buy_opportunity_score    NUMERIC(5,2),   -- 0-100

    decline_from_high_pct    NUMERIC(6,2),
    psa_premium              NUMERIC(6,2),
    liquidity_score          NUMERIC(6,2),
    popularity_signal        NUMERIC(5,2),
    artwork_desirability     NUMERIC(5,2),
    set_quality              NUMERIC(5,2),

    watch_note                TEXT,          -- e.g. 'Drew Brees entered Accumulation Watch'
    data_source                TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX idx_scan_asset     ON vault_core.buy_opportunity_scan(asset_id);
CREATE INDEX idx_scan_score     ON vault_core.buy_opportunity_scan(buy_opportunity_score DESC);

COMMENT ON TABLE vault_core.buy_opportunity_scan IS
    'Screening output. Designed to pair with market_cycle_state (cycle detector classifies, scanner ranks). No scheduled scan job ships with this migration.';

COMMIT;
