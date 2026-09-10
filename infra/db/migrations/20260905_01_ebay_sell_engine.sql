-- ============================================================================
-- eBay closed-loop selling engine (VaultOS decision layer + IQVault SoR).
--
-- Does NOT fork collectible identity. Holding remains the owned copy.
-- SKU is a durable eBay bridge on the holding, never a catalog synonym.
-- FMV stays a snapshot/observation — no point-in-time scalar current_fmv.
-- Browse comps stay in vault_market.listing_observation (asks, not sales).
-- ============================================================================

BEGIN;

SET search_path TO vault_collection, vault_market, vault_core, vault_evidence, public;

-- ---------------------------------------------------------------------------
-- Holding: durable SKU + current selling disposition + sales path lock
-- ---------------------------------------------------------------------------
ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS ebay_sku TEXT;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS current_disposition TEXT;

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS sales_path_state TEXT NOT NULL DEFAULT 'available';

ALTER TABLE vault_collection.holding
    ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ADD CONSTRAINT holding_ebay_sku_uidx UNIQUE (ebay_sku);
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ADD CONSTRAINT holding_current_disposition_chk
        CHECK (current_disposition IN (
            'PC', 'HOLD', 'GRADE', 'SINGLE', 'LOT', 'BULK', 'LCS_SHOW', 'DONATE', 'REVIEW'
        ) OR current_disposition IS NULL);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_collection.holding
        ADD CONSTRAINT holding_sales_path_state_chk
        CHECK (sales_path_state IN (
            'available', 'reserved', 'listed_single', 'listed_lot', 'sold'
        ));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_holding_ebay_sku
    ON vault_collection.holding (ebay_sku);

CREATE INDEX IF NOT EXISTS idx_holding_sales_path
    ON vault_collection.holding (sales_path_state);

COMMENT ON COLUMN vault_collection.holding.ebay_sku IS
    'Durable eBay Inventory SKU (IQV-{CATEGORY}-{holding.id compact}). Not catalog identity.';

COMMENT ON COLUMN vault_collection.holding.current_disposition IS
    'Latest selling disposition (PC/HOLD/GRADE/SINGLE/LOT/BULK/LCS_SHOW/DONATE/REVIEW). Overrides live in disposition_history.';

COMMENT ON COLUMN vault_collection.holding.sales_path_state IS
    'Exclusive sales path for qty-1 copies: available | reserved | listed_single | listed_lot | sold.';

-- ---------------------------------------------------------------------------
-- Seller connection (refresh token metadata; never log the token)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.ebay_connection (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    environment             TEXT NOT NULL
                            CHECK (environment IN ('sandbox', 'production')),
    marketplace_id          TEXT NOT NULL DEFAULT 'EBAY_US',
    refresh_token           TEXT,
    access_token_expires_at TIMESTAMPTZ,
    scopes                  TEXT[] NOT NULL DEFAULT '{}',
    merchant_location_key   TEXT,
    payment_policy_id       TEXT,
    return_policy_id        TEXT,
    fulfillment_policy_id   TEXT,
    last_error              TEXT,
    connected_at            TIMESTAMPTZ,
    disconnected_at         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_collection.ebay_connection IS
    'eBay Sell user-OAuth connection. Refresh token is persisted here, never in source or logs.';

-- ---------------------------------------------------------------------------
-- Auditable marketplace HTTP (status only; secrets redacted before insert)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.ebay_api_audit (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    method                  TEXT NOT NULL,
    path                    TEXT NOT NULL,
    status                  INTEGER NOT NULL,
    error_class             TEXT
                            CHECK (error_class IN ('retryable', 'non_retryable') OR error_class IS NULL),
    error_message           TEXT,
    idempotency_key         TEXT,
    duration_ms             INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_api_audit_created
    ON vault_collection.ebay_api_audit (created_at DESC);

COMMENT ON TABLE vault_collection.ebay_api_audit IS
    'Marketplace request/response status without secrets. Every publish/sync is auditable.';

-- ---------------------------------------------------------------------------
-- marketplace_listing — our listings (not Browse market asks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.marketplace_listing (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    inventory_id            TEXT NOT NULL,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    lot_id                  UUID,
    marketplace             TEXT NOT NULL DEFAULT 'ebay'
                            CHECK (marketplace = 'ebay'),
    sku                     TEXT NOT NULL,
    listing_kind            TEXT NOT NULL DEFAULT 'single'
                            CHECK (listing_kind IN ('single', 'lot')),
    external_offer_id       TEXT,
    external_listing_id     TEXT,
    listing_format          TEXT NOT NULL DEFAULT 'FIXED_PRICE'
                            CHECK (listing_format IN ('FIXED_PRICE', 'AUCTION')),
    status                  TEXT NOT NULL
                            CHECK (status IN (
                                'DRAFT', 'READY_FOR_REVIEW', 'APPROVED',
                                'EBAY_ITEM_CREATED', 'EBAY_OFFER_CREATED',
                                'PUBLISHED', 'ACTIVE', 'ENDED', 'SOLD', 'ERROR'
                            )),
    title                   TEXT NOT NULL,
    category_id             TEXT,
    price                   NUMERIC(12,2),
    minimum_offer_price     NUMERIC(12,2),
    quantity                INTEGER NOT NULL DEFAULT 1,
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    payment_policy_id       TEXT,
    return_policy_id        TEXT,
    fulfillment_policy_id   TEXT,
    merchant_location_key   TEXT,
    promoted                BOOLEAN NOT NULL DEFAULT FALSE,
    promotion_rate          NUMERIC(6,3),
    pricing_strategy        TEXT,
    fmv_low                 NUMERIC(12,2),
    fmv_high                NUMERIC(12,2),
    fmv_mid                 NUMERIC(12,2),
    fmv_confidence          NUMERIC(4,3),
    fmv_evidence_count      INTEGER,
    fmv_source              TEXT,
    listed_at               TIMESTAMPTZ,
    ended_at                TIMESTAMPTZ,
    last_synced_at          TIMESTAMPTZ,
    error_class             TEXT
                            CHECK (error_class IN ('retryable', 'non_retryable') OR error_class IS NULL),
    error_message           TEXT,
    listing_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key         TEXT NOT NULL,
    draft_id                UUID REFERENCES vault_collection.listing_draft(id) ON DELETE SET NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_listing_idempotency
    ON vault_collection.marketplace_listing (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_listing_active_single
    ON vault_collection.marketplace_listing (inventory_id)
    WHERE listing_kind = 'single'
      AND quantity = 1
      AND status IN ('APPROVED', 'EBAY_ITEM_CREATED', 'EBAY_OFFER_CREATED', 'PUBLISHED', 'ACTIVE');

CREATE INDEX IF NOT EXISTS idx_marketplace_listing_sku
    ON vault_collection.marketplace_listing (sku);

CREATE INDEX IF NOT EXISTS idx_marketplace_listing_status
    ON vault_collection.marketplace_listing (status);

COMMENT ON TABLE vault_collection.marketplace_listing IS
    'Our eBay listing lifecycle (draft→publish→sold). Distinct from vault_market.listing_observation (Browse asks). FMV columns are the listing-time snapshot and are never overwritten by later marks.';

-- ---------------------------------------------------------------------------
-- Lots (proposals first; membership is exact)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.listing_lot (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    lot_name                TEXT NOT NULL,
    grouping_key            TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'proposed'
                            CHECK (status IN ('proposed', 'accepted', 'listed', 'active', 'rejected', 'ended')),
    combined_fmv            NUMERIC(12,2),
    recommended_price       NUMERIC(12,2),
    estimated_net           NUMERIC(12,2),
    estimated_labor_minutes NUMERIC(8,2),
    net_per_labor_minute    NUMERIC(12,2),
    lot_score               NUMERIC(8,3),
    confidence              NUMERIC(4,3),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    marketplace_listing_id  UUID REFERENCES vault_collection.marketplace_listing(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_collection.listing_lot_member (
    lot_id                  UUID NOT NULL REFERENCES vault_collection.listing_lot(id) ON DELETE CASCADE,
    inventory_id            TEXT NOT NULL,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    lot_status              TEXT NOT NULL DEFAULT 'proposed'
                            CHECK (lot_status IN ('proposed', 'accepted', 'listed', 'active', 'rejected', 'ended')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lot_id, inventory_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lot_member_active
    ON vault_collection.listing_lot_member (inventory_id)
    WHERE lot_status IN ('proposed', 'accepted', 'listed', 'active');

COMMENT ON TABLE vault_collection.listing_lot IS
    'Lot proposals and accepted lots. Not auto-committed. PC/HOLD/GRADE members are excluded in application code.';

COMMENT ON TABLE vault_collection.listing_lot_member IS
    'Exact lot membership. A card in an active lot cannot also be an active single listing.';

-- ---------------------------------------------------------------------------
-- Daily listing queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.listing_queue_item (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    queue_date              DATE NOT NULL,
    inventory_id            TEXT,
    lot_id                  UUID REFERENCES vault_collection.listing_lot(id) ON DELETE SET NULL,
    priority_score          NUMERIC(8,3) NOT NULL,
    bucket                  TEXT NOT NULL
                            CHECK (bucket IN ('high_liquidity', 'event_trending', 'stale', 'scarce', 'experiment')),
    recommended_format      TEXT NOT NULL DEFAULT 'FIXED_PRICE',
    recommended_price       NUMERIC(12,2),
    minimum_price           NUMERIC(12,2),
    pricing_strategy        TEXT,
    estimated_net           NUMERIC(12,2),
    estimated_labor_minutes NUMERIC(8,2),
    reason                  TEXT NOT NULL,
    confidence              NUMERIC(4,3) NOT NULL,
    disposition             TEXT NOT NULL,
    operator_action         TEXT
                            CHECK (operator_action IN (
                                'approve', 'edit', 'defer', 'hold', 'change_disposition', 'reject'
                            ) OR operator_action IS NULL),
    operator_note           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_queue_date
    ON vault_collection.listing_queue_item (queue_date, priority_score DESC);

COMMENT ON TABLE vault_collection.listing_queue_item IS
    'Ranked daily listing queue. Operator approve/edit/defer/hold/reject is logged back into disposition_history.';

-- ---------------------------------------------------------------------------
-- Disposition history (human override always logged)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.disposition_history (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    inventory_id            TEXT NOT NULL,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    previous_disposition    TEXT,
    new_disposition         TEXT NOT NULL,
    reason_code             TEXT NOT NULL,
    reason_text             TEXT NOT NULL,
    confidence              NUMERIC(4,3) NOT NULL,
    recommended_by          TEXT NOT NULL
                            CHECK (recommended_by IN ('RULE', 'MODEL', 'USER', 'ORCHESTR8')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disposition_history_inventory
    ON vault_collection.disposition_history (inventory_id, created_at DESC);

COMMENT ON TABLE vault_collection.disposition_history IS
    'Every disposition recommendation and human override. Recommendations are reversible before marketplace execution.';

-- ---------------------------------------------------------------------------
-- Experiments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.selling_experiment (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    experiment_id           TEXT NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE,
    hypothesis              TEXT NOT NULL,
    cohort_definition       JSONB NOT NULL DEFAULT '{}'::jsonb,
    strategy                TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'running', 'paused', 'completed', 'abandoned')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_collection.selling_experiment_cohort (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    experiment_id           TEXT NOT NULL REFERENCES vault_collection.selling_experiment(experiment_id) ON DELETE CASCADE,
    cohort_id               TEXT NOT NULL,
    label                   TEXT NOT NULL,
    inventory_id            TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, cohort_id, inventory_id)
);

COMMENT ON TABLE vault_collection.selling_experiment IS
    'Low-dollar and later pricing experiments. Do not auto-declare a winner on small n.';

COMMENT ON TABLE vault_collection.selling_experiment_cohort IS
    'Exact cohort membership for a selling experiment.';

INSERT INTO vault_collection.selling_experiment (
    experiment_id, name, start_date, hypothesis, cohort_definition, strategy, status
) VALUES (
    'low-dollar-1-5-v1',
    'Low-dollar $1–$5 singles vs lots',
    DATE '2026-09-05',
    'For comparable $1–$5 cards, player/theme lots beat singles on net dollars per labor minute without a large revenue/card loss.',
    '{"fmvMin":1,"fmvMax":5,"targetN":300,"cohorts":["individual_singles","player_lots","team_set_theme_lots"]}'::jsonb,
    'compare_singles_player_lots_theme_lots',
    'draft'
) ON CONFLICT (experiment_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Generic market events (no news vendor in the eBay adapter)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_collection.market_event (
    event_id                TEXT PRIMARY KEY,
    subject_type            TEXT NOT NULL,
    subject_id              TEXT NOT NULL,
    event_type              TEXT NOT NULL,
    event_time              TIMESTAMPTZ NOT NULL,
    severity                NUMERIC(4,3) NOT NULL,
    confidence              NUMERIC(4,3) NOT NULL,
    source                  TEXT NOT NULL,
    summary                 TEXT NOT NULL,
    expires_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_event_subject
    ON vault_collection.market_event (subject_id, event_time DESC);

COMMENT ON TABLE vault_collection.market_event IS
    'Generic market-event seam for listing priority. No sports-news vendor is hard-wired into the eBay adapter.';

-- ---------------------------------------------------------------------------
-- Traffic snapshots (nullable watcher/offer — do not invent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_market.listing_metric_snapshot (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    marketplace_listing_id  UUID NOT NULL,
    captured_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    impressions_search      NUMERIC(14,2),
    impressions_store       NUMERIC(14,2),
    impressions_total       NUMERIC(14,2),
    views_total             NUMERIC(14,2),
    views_search            NUMERIC(14,2),
    views_store             NUMERIC(14,2),
    views_direct            NUMERIC(14,2),
    views_off_ebay          NUMERIC(14,2),
    watcher_count           INTEGER,
    offer_count             INTEGER,
    data_source             TEXT NOT NULL,
    window_start            DATE,
    window_end              DATE
);

CREATE INDEX IF NOT EXISTS idx_listing_metric_listing
    ON vault_market.listing_metric_snapshot (marketplace_listing_id, captured_at DESC);

COMMENT ON TABLE vault_market.listing_metric_snapshot IS
    'Listing-level Traffic Report snapshots. Watcher/offer stay NULL unless the API path exposes them.';

-- ---------------------------------------------------------------------------
-- Orders + lines (dedupe on external ids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_market.marketplace_order (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    marketplace             TEXT NOT NULL DEFAULT 'ebay' CHECK (marketplace = 'ebay'),
    external_order_id       TEXT NOT NULL,
    order_created_at        TIMESTAMPTZ NOT NULL,
    order_status            TEXT NOT NULL,
    buyer_reference         TEXT,
    gross_total             NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_collected      NUMERIC(12,2),
    tax_amount              NUMERIC(12,2),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    fulfillment_status      TEXT,
    shipped_at              TIMESTAMPTZ,
    delivered_at            TIMESTAMPTZ,
    last_synced_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (marketplace, external_order_id)
);

CREATE TABLE IF NOT EXISTS vault_market.marketplace_order_line (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    marketplace_order_id    UUID NOT NULL REFERENCES vault_market.marketplace_order(id) ON DELETE CASCADE,
    inventory_id            TEXT,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    sku                     TEXT NOT NULL,
    external_line_item_id   TEXT NOT NULL,
    quantity                INTEGER NOT NULL DEFAULT 1,
    sale_price              NUMERIC(12,2) NOT NULL,
    shipping_allocated      NUMERIC(12,2),
    fee_allocated           NUMERIC(12,2),
    promotion_fee_allocated NUMERIC(12,2),
    net_proceeds            NUMERIC(12,2),
    fee_is_estimate         BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (marketplace_order_id, external_line_item_id)
);

COMMENT ON TABLE vault_market.marketplace_order IS
    'Completed-checkout eBay orders from the Fulfillment API.';

COMMENT ON TABLE vault_market.marketplace_order_line IS
    'Order lines keyed to IQVault SKU. Fees labeled estimate until a final fee source exists.';

-- ---------------------------------------------------------------------------
-- Holding-scoped market observations (INTERNAL_SALE is first-class)
-- Distinct grain from vault_market.sale (priced_unit comps) and listing_observation (asks).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_market.market_observation (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    inventory_id            TEXT NOT NULL,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    observation_type        TEXT NOT NULL
                            CHECK (observation_type IN ('INTERNAL_SALE', 'EXTERNAL_COMP', 'PRICE_GUIDE')),
    observed_at             TIMESTAMPTZ NOT NULL,
    value                   NUMERIC(12,2) NOT NULL,
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    source                  TEXT NOT NULL,
    marketplace_listing_id  UUID,
    confidence              NUMERIC(4,3) NOT NULL,
    metadata_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL,
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_observation_inventory
    ON vault_market.market_observation (inventory_id, observed_at DESC);

COMMENT ON TABLE vault_market.market_observation IS
    'Holding-scoped observations. INTERNAL_SALE is our completed eBay sale. Does not replace priced_unit sale comps or Browse listing_observation.';

COMMIT;
