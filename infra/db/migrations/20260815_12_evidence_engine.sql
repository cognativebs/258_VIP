-- ============================================================================
-- 12_evidence_engine.sql
--
-- VIP Intelligence Core: Recommendation Evidence Engine.
--
-- Principle established in conversation: conversation memory != current
-- decision context. Every recommendation VIP surfaces must carry an evidence
-- card showing what it's actually based on, how fresh that basis is, and
-- when the recommendation itself expires. This belongs under every VIP
-- recommendation platform-wide, not just collectibles.
--
-- Test fixture:
--   BUY — Crown Zenith PC ETB, confidence 94%, shelf observation 2h old,
--   market comps 14h old, IQVault ownership live, collection fit 97,
--   recommendation expires 48h.
--
-- freshness_hours is computed in a view, not a STORED generated column:
-- Postgres generated columns cannot call now() (not IMMUTABLE). Live
-- freshness belongs on the read path.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

CREATE TABLE vault_core.recommendation (
    id                UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id          UUID REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    holding_id        UUID REFERENCES vault_collection.holding(id) ON DELETE CASCADE,

    action            TEXT NOT NULL,     -- 'buy','sell','hold','grade','watch','negotiate','pass','upgrade','lot'
    confidence        NUMERIC(4,3) NOT NULL,
    rationale         TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL,

    source_system     TEXT NOT NULL,     -- which VIP system produced this: 'prediction_ledger','grading_optimizer','acquisition_underwriting', etc.

    CONSTRAINT chk_recommendation_action CHECK (
        action IN ('buy','sell','hold','grade','watch','negotiate','pass','upgrade','lot','inspect_further')
    ),
    CONSTRAINT chk_asset_or_holding CHECK (
        asset_id IS NOT NULL OR holding_id IS NOT NULL
    )
);

CREATE INDEX idx_recommendation_asset    ON vault_core.recommendation(asset_id);
CREATE INDEX idx_recommendation_holding  ON vault_core.recommendation(holding_id);
CREATE INDEX idx_recommendation_active   ON vault_core.recommendation(expires_at);

COMMENT ON TABLE vault_core.recommendation IS
    'A VIP-produced recommendation with an expiry. A recommendation past expires_at must be flagged stale by every read path, never served as current without that flag.';

CREATE TABLE vault_core.evidence_card (
    id                        UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    recommendation_id         UUID NOT NULL REFERENCES vault_core.recommendation(id) ON DELETE CASCADE,

    evidence_source            TEXT NOT NULL,   -- controlled vocabulary, see check constraint
    evidence_timestamp          TIMESTAMPTZ NOT NULL,
    confidence                    NUMERIC(4,3),

    supporting_evidence            TEXT,
    contradictory_evidence         TEXT,
    missing_information             TEXT,
    confidence_would_increase_if     TEXT,

    raw_reference_id                  TEXT,   -- pointer back to source row (e.g. ebay listing id, shelf photo id)

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_evidence_source CHECK (
        evidence_source IN (
            'shelf_observation', 'ebay_browse', 'sold_comp', 'ownership_record',
            'collection_fit_score', 'pop_report', 'signals_feed', 'manual'
        )
    )
);

CREATE INDEX idx_evidence_recommendation ON vault_core.evidence_card(recommendation_id);
CREATE INDEX idx_evidence_source         ON vault_core.evidence_card(evidence_source);

COMMENT ON TABLE vault_core.evidence_card IS
    'What a recommendation is actually based on. Freshness is computed live from evidence_timestamp on read (see evidence_card_live). A recommendation with no evidence_card rows is incomplete, not just low-confidence.';

CREATE VIEW vault_core.evidence_card_live AS
    SELECT e.*,
        ROUND((EXTRACT(EPOCH FROM (now() - e.evidence_timestamp)) / 3600.0)::numeric, 2) AS freshness_hours
    FROM vault_core.evidence_card e;

COMMENT ON VIEW vault_core.evidence_card_live IS
    'evidence_card plus live freshness_hours. Use this (not the raw table) whenever freshness is displayed.';

-- Convenience view: recommendations that are stale but might still be served
-- by a naive read path if this view isn't used
CREATE VIEW vault_core.recommendation_active AS
    SELECT r.*,
        CASE WHEN r.expires_at <= now() THEN true ELSE false END AS is_stale
    FROM vault_core.recommendation r;

COMMENT ON VIEW vault_core.recommendation_active IS
    'Use this view (not the raw table) for any UI or API read path so stale recommendations are always explicitly flagged.';

COMMIT;
