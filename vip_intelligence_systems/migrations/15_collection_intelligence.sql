-- ============================================================================
-- 15_collection_intelligence.sql
--
-- VIP Collection Intelligence: Binder Chase Architecture + Collection Synergy
-- / Museum Score. Both APPROVED — build order matters within this file:
-- binder_page must exist before museum_synergy_score can reference it via
-- contributing_goals, since synergy score measures how much a holding
-- advances specific collection goals (not just its dollar value).
--
-- Test fixtures:
--   Binder — 9-card Museum Page per Pokémon expansion, Tier 1 Museum Anchor
--     through Tier 4 Filler.
--   Synergy — Blastoise & Piplup dual-goal contribution example.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

-- ---------------------------------------------------------------------------
-- Binder Chase Architecture
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.collection_goal (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name          TEXT NOT NULL,             -- 'Blastoise Master Collection', 'Tag Team Era Master Collection', etc.
    goal_type     TEXT NOT NULL,             -- 'master_collection','museum_page','cultural_icons'
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_goal_type CHECK (
        goal_type IN ('master_collection', 'museum_page', 'cultural_icons', 'binder_core')
    )
);

COMMENT ON TABLE vault_core.collection_goal IS
    'A named collecting objective a holding can contribute to. Existing Collection Hunt module (Absolute Batman, Pokémon master sets) should be migrated to reference this table rather than maintaining a parallel goal concept.';

CREATE TABLE vault_core.binder_page (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    expansion_id    UUID,                     -- references the Pokémon expansion/set; left loosely typed until vault_pokemon's set table is confirmed
    page_type       TEXT NOT NULL,
    collection_goal_id UUID REFERENCES vault_core.collection_goal(id) ON DELETE SET NULL,

    CONSTRAINT chk_page_type CHECK (
        page_type IN ('museum_page', 'cultural_icons')
    )
);

COMMENT ON TABLE vault_core.binder_page IS
    'One row per binder page. museum_page = the 9-card defining chase set for one expansion. cultural_icons = a separate page_type, NOT a variant of museum_page, per explicit design rule.';

CREATE TABLE vault_core.binder_slot (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    binder_page_id  UUID NOT NULL REFERENCES vault_core.binder_page(id) ON DELETE CASCADE,
    slot_number     SMALLINT NOT NULL,
    asset_id        UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    tier            TEXT NOT NULL,
    is_museum_anchor BOOLEAN NOT NULL DEFAULT FALSE,

    UNIQUE (binder_page_id, slot_number),

    CONSTRAINT chk_slot_tier CHECK (
        tier IN ('museum_anchor', 'binder_core', 'completion', 'filler')
    )
);

CREATE INDEX idx_binder_slot_page   ON vault_core.binder_slot(binder_page_id);
CREATE INDEX idx_binder_slot_asset  ON vault_core.binder_slot(asset_id);

COMMENT ON TABLE vault_core.binder_slot IS
    'One card slot on a binder page. tier drives the rip-vs-singles recommendation logic in the view below.';

CREATE VIEW vault_core.binder_page_completion AS
    SELECT
        bp.id AS binder_page_id,
        bp.page_type,
        COUNT(bs.id) AS total_slots,
        COUNT(h.id) AS filled_slots,
        COUNT(bs.id) - COUNT(h.id) AS missing_slots,
        ROUND(COUNT(h.id)::numeric / NULLIF(COUNT(bs.id), 0) * 100, 1) AS completion_pct,
        CASE
            WHEN COUNT(bs.id) - COUNT(h.id) = 0 THEN 'complete'
            WHEN COUNT(h.id)::numeric / NULLIF(COUNT(bs.id), 0) >= 0.85 THEN 'rip_candidate'
            ELSE 'buy_singles'
        END AS rip_vs_singles_recommendation
    FROM vault_core.binder_page bp
    JOIN vault_core.binder_slot bs ON bs.binder_page_id = bp.id
    LEFT JOIN vault_collection.holding h ON h.asset_id = bs.asset_id
    GROUP BY bp.id, bp.page_type;

COMMENT ON VIEW vault_core.binder_page_completion IS
    'rip_vs_singles_recommendation is a simple >=85%-filled heuristic (roughly matching the "missing 8 of 9 -> rip; missing 1-2 expensive -> buy singles" rule). Refine with actual per-slot price weighting once acquisition_underwriting has enough real cases to justify it — this is a reasonable v1, not a final formula.';

-- ---------------------------------------------------------------------------
-- Collection Synergy / Museum Score
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.collection_synergy_score (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    holding_id              UUID NOT NULL REFERENCES vault_collection.holding(id) ON DELETE CASCADE,

    evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    market_attractiveness   NUMERIC(5,2),   -- 0-100
    museum_importance       NUMERIC(5,2),   -- 0-100
    investment_score        NUMERIC(5,2),   -- 0-100, may mirror vault_collection.holding.investment_score at eval time
    liquidity_score         NUMERIC(5,2),   -- 0-100

    collection_synergy_score NUMERIC(5,2),  -- 0-100, the composite — but component scores above stay queryable, never collapsed silently

    contributing_goal_ids   UUID[] NOT NULL DEFAULT '{}',  -- FKs into vault_core.collection_goal

    notes                    TEXT
);

CREATE INDEX idx_synergy_holding  ON vault_core.collection_synergy_score(holding_id);
CREATE INDEX idx_synergy_score    ON vault_core.collection_synergy_score(collection_synergy_score DESC);

COMMENT ON TABLE vault_core.collection_synergy_score IS
    'Prevents generic highest-expected-ROI recommendations by weighting how much a holding advances named collection goals (contributing_goal_ids), not just its market value. component scores (market_attractiveness, museum_importance, investment_score, liquidity_score) must remain independently queryable alongside the composite — never collapse to just the single number in any read path.';

COMMIT;
