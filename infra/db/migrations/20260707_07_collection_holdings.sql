-- ============================================================================
-- VaultOS / IQVault — 07: COLLECTION HOLDINGS (ownership layer)
--
-- WHY THIS FILE EXISTS: 01–06 model the CATALOG (things that exist in the
-- world) but have no table for things YOU OWN. inventory.json carries
-- quantity, purchase price, grade, location, and the decision-intelligence
-- scores — none of which had a home. This is that home.
--
-- Design rule (from the revised platform doc): "don't ship generic inventory —
-- ship decision intelligence on top of inventory data." So the intel columns
-- (scores, pillar, recommendation) live right on the holding.
--
-- One holding row per owned copy-group. Duplicates of the same asset are one
-- row with quantity > 1 OR separate rows if condition/purchase differ.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS vault_collection;
SET search_path TO vault_collection, vault_core, public;

CREATE TABLE vault_collection.holding (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id            UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,

    -- Ownership facts
    quantity            SMALLINT NOT NULL DEFAULT 1,
    purchase_price      NUMERIC(12,2),
    purchase_date       DATE,
    location            TEXT,                 -- box/shelf code
    slab_status         TEXT,                 -- 'raw','slabbed','pending'
    assumed_grade       TEXT,                 -- 'NM','VF' — unverified
    grade_rating        NUMERIC(4,2),         -- numeric grade if known

    -- Decision intelligence (from CLZ parser enrichment)
    collection_pillar   TEXT,
    museum_score        NUMERIC(6,2),
    investment_score    NUMERIC(6,2),
    liquidity_score     NUMERIC(6,2),
    recommendation      TEXT,                 -- 'Hold','Sell Duplicate',...
    sell_priority       TEXT,                 -- 'High','Medium','Low'
    upgrade_candidate   BOOLEAN DEFAULT FALSE,
    needs_grading       BOOLEAN DEFAULT FALSE,
    needs_photo         BOOLEAN DEFAULT FALSE,
    needs_verification  BOOLEAN DEFAULT FALSE,
    verification_notes  TEXT,
    value_locked        BOOLEAN DEFAULT FALSE,

    -- Market snapshot at import time (live values belong in vault_market)
    current_price_snapshot NUMERIC(12,2),

    -- Provenance
    source              TEXT NOT NULL DEFAULT 'clz_import',
    source_row_id       TEXT,                 -- CLZ Hash / row id for re-sync
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source, source_row_id)
);

CREATE INDEX idx_holding_asset       ON vault_collection.holding(asset_id);
CREATE INDEX idx_holding_pillar      ON vault_collection.holding(collection_pillar);
CREATE INDEX idx_holding_sell        ON vault_collection.holding(sell_priority)
    WHERE recommendation ILIKE 'sell%';
CREATE INDEX idx_holding_flags       ON vault_collection.holding(needs_verification)
    WHERE needs_verification;

COMMENT ON TABLE vault_collection.holding IS
    'Owned copies + decision intelligence. Catalog identity lives in vault_core.asset.';

COMMIT;
