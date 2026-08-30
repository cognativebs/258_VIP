-- ============================================================================
-- IQVault inventory buckets + operator transaction / listing-draft capture.
--
-- inventory_bucket lives on vault_collection.holding (the live ownership
-- layer). This is NOT the superseded 2026-08-17 TCG schema — vault_tcg is
-- untouched (ADR 0007 occupied).
--
-- personal_collection — keepers, not for routine sale
-- investment_vault    — sell when price / value intelligence justifies it
-- dealer_inventory    — capital that exists to churn
-- ============================================================================

BEGIN;

SET search_path TO vault_collection, vault_core, vault_evidence, public;

-- ---------------------------------------------------------------------------
-- Holding bucket (idempotent ADD)
-- ---------------------------------------------------------------------------
ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS inventory_bucket TEXT;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS inventory_bucket_source TEXT;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS inventory_bucket_rule TEXT;

UPDATE vault_collection.holding
SET
    inventory_bucket = CASE
        WHEN value_locked IS TRUE THEN 'personal_collection'
        WHEN recommendation = 'Museum Candidate' THEN 'personal_collection'
        WHEN collection_pillar IN (
            'Batman', 'Spider-Man', 'Superman', 'Absolute Universe',
            'Good Girl / Risqué Covers', 'Cover Art & Favorite Artists',
            'Sci-Fi', 'Personal Favorites', 'X-Men'
        ) THEN 'personal_collection'
        WHEN collection_pillar IN (
            'Investment Portfolio', 'First Appearances', 'Bronze & Silver Age Keys'
        ) THEN 'investment_vault'
        WHEN recommendation = 'Investment Hold / Review' THEN 'investment_vault'
        ELSE 'dealer_inventory'
    END,
    inventory_bucket_source = 'inferred',
    inventory_bucket_rule = 'inventory-bucket@0.1.0'
WHERE inventory_bucket_source IS DISTINCT FROM 'operator';

ALTER TABLE vault_collection.holding
    ALTER COLUMN inventory_bucket SET DEFAULT 'dealer_inventory';

UPDATE vault_collection.holding
SET inventory_bucket = 'dealer_inventory'
WHERE inventory_bucket IS NULL;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ALTER COLUMN inventory_bucket SET NOT NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ADD CONSTRAINT holding_inventory_bucket_chk
        CHECK (inventory_bucket IN (
            'personal_collection', 'investment_vault', 'dealer_inventory'
        ));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ADD CONSTRAINT holding_inventory_bucket_source_chk
        CHECK (inventory_bucket_source IN ('inferred', 'operator') OR inventory_bucket_source IS NULL);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_holding_inventory_bucket
    ON vault_collection.holding (inventory_bucket);

COMMENT ON COLUMN vault_collection.holding.inventory_bucket IS
    'Capital-intent bucket: personal_collection (not for routine sale), investment_vault (sell when intelligence justifies), dealer_inventory (churn capital). Distinct from collection_pillar.';

COMMENT ON COLUMN vault_collection.holding.inventory_bucket_source IS
    'inferred = rule inventory-bucket@0.1.0 (unverified); operator = explicit override.';

-- ---------------------------------------------------------------------------
-- Operator-captured inventory transactions (not vault_market.sale)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.inventory_transaction (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    holding_source_row_id   TEXT NOT NULL,
    kind                    TEXT NOT NULL
                            CHECK (kind IN ('buy', 'sell', 'transfer_bucket')),
    amount                  NUMERIC(12,2),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    inventory_bucket        TEXT NOT NULL
                            CHECK (inventory_bucket IN (
                                'personal_collection', 'investment_vault', 'dealer_inventory'
                            )),
    notes                   TEXT,
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL
                            CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_holding
    ON vault_collection.inventory_transaction (holding_source_row_id, occurred_at DESC);

COMMENT ON TABLE vault_collection.inventory_transaction IS
    'Operator-captured buy/sell/transfer events for a holding. Not marketplace sold comps — do not write Browse listings here or into vault_market.sale.';

-- ---------------------------------------------------------------------------
-- eBay listing drafts (human Sell + range gate; never auto-submit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.listing_draft (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    holding_source_row_id   TEXT NOT NULL,
    inventory_bucket        TEXT NOT NULL
                            CHECK (inventory_bucket IN (
                                'personal_collection', 'investment_vault', 'dealer_inventory'
                            )),
    title                   TEXT NOT NULL,
    status                  TEXT NOT NULL
                            CHECK (status IN (
                                'pending_credentials', 'draft_ready', 'blocked_personal',
                                'blocked_insufficient_range', 'blocked_not_sell',
                                'submitted', 'failed'
                            )),
    ask_price               NUMERIC(12,2),
    live_low                NUMERIC(12,2),
    live_high               NUMERIC(12,2),
    listing_count           INTEGER NOT NULL DEFAULT 0,
    empty_reason            TEXT,
    listing_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    override_note           TEXT,
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL
                            CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_draft_holding
    ON vault_collection.listing_draft (holding_source_row_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_draft_status
    ON vault_collection.listing_draft (status);

COMMENT ON TABLE vault_collection.listing_draft IS
    'eBay listing drafts queued from Sell decisions. submitReady stays false until a human submits. Personal collection drafts require an override note.';

COMMIT;
