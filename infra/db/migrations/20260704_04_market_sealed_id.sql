-- ============================================================================
-- VaultOS / IQVault Catalog — 04: MARKET DATA, SEALED, IDENTIFICATION
-- The valuation spine + the ID feedback loop (training-data moat).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_market;
SET search_path TO vault_market, vault_core, public;

-- ----------------------------------------------------------------------------
-- PRICED UNIT: an asset at a specific grade is the thing that has a price.
-- (asset_id + grade_scale_id). Raw uses the RAW company's scale row.
-- ----------------------------------------------------------------------------
CREATE TABLE priced_unit (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    grade_scale_id  INTEGER NOT NULL REFERENCES vault_core.grade_scale(id),
    UNIQUE (asset_id, grade_scale_id)
);
CREATE INDEX idx_pu_asset ON priced_unit(asset_id);

-- ----------------------------------------------------------------------------
-- SALES — every observed transaction. eBay sold is the ground truth.
-- This raw feed is normalized into market_value below. Storing it IS the moat:
-- nobody else has your exact, cleaned time series.
-- ----------------------------------------------------------------------------
CREATE TABLE sale (
    id              BIGSERIAL PRIMARY KEY,
    priced_unit_id  UUID NOT NULL REFERENCES priced_unit(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,               -- 'ebay','goldin','pwcc','tcgplayer','130point'
    source_listing_id TEXT,
    sale_price      NUMERIC(12,2) NOT NULL,
    shipping        NUMERIC(8,2) DEFAULT 0,
    currency        CHAR(3) DEFAULT 'USD',
    sale_date       DATE NOT NULL,
    is_auction      BOOLEAN,
    -- Quality/outlier controls
    is_outlier      BOOLEAN DEFAULT FALSE,        -- flagged by normalization job
    confidence      NUMERIC(4,3) DEFAULT 1.000,   -- match confidence (did we ID it right?)
    raw_title       TEXT,                          -- original listing title for audit
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_listing_id)
);
CREATE INDEX idx_sale_pu_date ON sale(priced_unit_id, sale_date DESC);
CREATE INDEX idx_sale_date    ON sale(sale_date);

-- ----------------------------------------------------------------------------
-- MARKET VALUE — the normalized, rolling valuation per priced unit.
-- One current row per unit (current) + history table for trend/Momentum.
-- This is what the offer engine and VaultScore read.
-- ----------------------------------------------------------------------------
CREATE TABLE market_value (
    priced_unit_id  UUID PRIMARY KEY REFERENCES priced_unit(id) ON DELETE CASCADE,
    market_price    NUMERIC(12,2) NOT NULL,       -- our blended current value
    low             NUMERIC(12,2),
    high            NUMERIC(12,2),
    sample_size     INTEGER,                       -- # sales in window
    window_days     SMALLINT DEFAULT 90,
    -- Signals consumed by offer engine + VaultScore
    trend_pct_30d   NUMERIC(6,2),                  -- +11.0 = up 11%
    velocity        TEXT,                          -- 'fast','medium','slow' (sales/month)
    liquidity_score NUMERIC(4,1),                  -- 0–100
    last_sale_date  DATE,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_value_history (
    id              BIGSERIAL PRIMARY KEY,
    priced_unit_id  UUID NOT NULL REFERENCES priced_unit(id) ON DELETE CASCADE,
    market_price    NUMERIC(12,2) NOT NULL,
    sample_size     INTEGER,
    as_of           DATE NOT NULL,
    UNIQUE (priced_unit_id, as_of)
);
CREATE INDEX idx_mvh_unit_date ON market_value_history(priced_unit_id, as_of DESC);

-- ----------------------------------------------------------------------------
-- POPULATION REPORTS — PSA/CGC pop counts (supply side of VaultScore Risk).
-- ----------------------------------------------------------------------------
CREATE TABLE population_report (
    id              BIGSERIAL PRIMARY KEY,
    asset_id        UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    grading_company_id SMALLINT NOT NULL REFERENCES vault_core.grading_company(id),
    grade_label     TEXT NOT NULL,
    pop_count       INTEGER NOT NULL,
    pop_higher      INTEGER,                       -- # graded higher
    as_of           DATE NOT NULL,
    UNIQUE (asset_id, grading_company_id, grade_label, as_of)
);
CREATE INDEX idx_pop_asset ON population_report(asset_id);

-- ============================================================================
-- SEALED PRODUCT — booster boxes, ETBs, tins, etc. (your sealed haul lives here)
-- ============================================================================
CREATE TABLE vault_market.sealed_product (
    asset_id        UUID PRIMARY KEY REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    category_id     SMALLINT NOT NULL REFERENCES vault_core.categories(id),
    product_name    TEXT NOT NULL,
    set_name        TEXT,
    product_type    TEXT NOT NULL,                 -- 'booster_box','etb','tin','bundle','collection_box'
    language        TEXT DEFAULT 'english',
    pack_count      SMALLINT,
    cards_per_pack  SMALLINT,
    msrp            NUMERIC(10,2),
    -- EV modeling (expected value of opening) — drives buy/hold on sealed
    estimated_ev    NUMERIC(10,2),
    ev_source       TEXT,
    upc             TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- IDENTIFICATION FEEDBACK — the compounding training-data moat.
-- Every scan + every human correction is logged. This is what makes the
-- classifier improve the more stores use VaultOS.
-- ============================================================================
CREATE TABLE vault_market.id_observation (
    id              BIGSERIAL PRIMARY KEY,
    -- What the pipeline predicted
    predicted_asset_id UUID REFERENCES vault_core.asset(id),
    predicted_confidence NUMERIC(4,3),
    -- What a human confirmed (NULL until reviewed)
    confirmed_asset_id UUID REFERENCES vault_core.asset(id),
    was_correct     BOOLEAN,                       -- derived: predicted == confirmed
    -- Capture context for retraining
    image_url       TEXT NOT NULL,
    image_embedding vector(512),
    capture_frames  SMALLINT DEFAULT 1,            -- multi-frame? (parallel disambiguation)
    ocr_text        TEXT,                           -- what OCR pulled
    store_id        UUID,                           -- which store (network signal)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_idobs_predicted ON vault_market.id_observation(predicted_asset_id);
CREATE INDEX idx_idobs_correct   ON vault_market.id_observation(was_correct);
CREATE INDEX idx_idobs_review    ON vault_market.id_observation(confirmed_asset_id)
    WHERE confirmed_asset_id IS NULL;             -- review queue
