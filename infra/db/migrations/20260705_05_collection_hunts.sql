-- IQVault — 05: COLLECTION HUNTS (IQVault app schema)
-- Guided collectible completion module (Absolute Batman reference implementation)

CREATE SCHEMA IF NOT EXISTS vault_hunt;
SET search_path TO vault_hunt, vault_core, public;

-- ── Hunt registry ────────────────────────────────────────────────────────────

CREATE TABLE vault_hunt.collection_hunt (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    category_id     SMALLINT REFERENCES vault_core.categories(id),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'coming_soon')),
    description     TEXT,
    budget          NUMERIC(12, 2),
    priority        TEXT DEFAULT 'medium'
                    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    completion_pct  NUMERIC(5, 2) DEFAULT 0,
    estimated_value NUMERIC(12, 2),
    intelligence_score NUMERIC(5, 2),
    notes           TEXT,
    config          JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_hunt.hunt_section (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hunt_id         UUID NOT NULL REFERENCES vault_hunt.collection_hunt(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    metric_key      TEXT,
    UNIQUE (hunt_id, slug)
);

-- ── Hunt items (wanted / owned / missing) ────────────────────────────────────

CREATE TABLE vault_hunt.hunt_item (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id      UUID NOT NULL REFERENCES vault_hunt.hunt_section(id) ON DELETE CASCADE,
    asset_id        UUID REFERENCES vault_core.asset(id),
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'missing'
                    CHECK (status IN ('owned', 'wanted', 'missing')),
    priority        TEXT DEFAULT 'medium'
                    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    grade           TEXT,
    paid            NUMERIC(12, 2),
    market_value    NUMERIC(12, 2),
    buy_under       NUMERIC(12, 2),
    msrp            NUMERIC(12, 2),
    storage_location TEXT,
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    last_checked    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hunt_item_status ON vault_hunt.hunt_item (section_id, status);
CREATE INDEX idx_hunt_item_asset ON vault_hunt.hunt_item (asset_id) WHERE asset_id IS NOT NULL;

-- ── Market intelligence signals ──────────────────────────────────────────────

CREATE TABLE vault_hunt.hunt_signal (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hunt_id         UUID NOT NULL REFERENCES vault_hunt.collection_hunt(id) ON DELETE CASCADE,
    signal_type     TEXT NOT NULL
                    CHECK (signal_type IN ('news', 'market', 'supply', 'retail', 'reprint', 'auction')),
    body            TEXT NOT NULL,
    source_url      TEXT,
    signal_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── AI recommendations (generated or manual) ───────────────────────────────────

CREATE TABLE vault_hunt.hunt_recommendation (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hunt_id         UUID NOT NULL REFERENCES vault_hunt.collection_hunt(id) ON DELETE CASCADE,
    hunt_item_id    UUID REFERENCES vault_hunt.hunt_item(id) ON DELETE SET NULL,
    item_label      TEXT NOT NULL,
    confidence      NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reason          TEXT NOT NULL,
    estimated_roi   TEXT,
    completion_impact TEXT,
    buy_under       NUMERIC(12, 2),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Retailer watchlist (Pokémon 30th etc.) ────────────────────────────────────

CREATE TABLE vault_hunt.hunt_retailer (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hunt_id         UUID NOT NULL REFERENCES vault_hunt.collection_hunt(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    priority        TEXT DEFAULT 'secondary'
                    CHECK (priority IN ('primary', 'secondary', 'tertiary')),
    url             TEXT,
    notes           TEXT,
    UNIQUE (hunt_id, name)
);

-- ── Seed: Absolute Batman Master Hunt ─────────────────────────────────────────

INSERT INTO vault_hunt.collection_hunt (slug, name, category_id, status, description, budget, priority)
VALUES (
    'absolute-batman-master',
    'Absolute Batman Master Hunt',
    (SELECT id FROM vault_core.categories WHERE kind = 'comic'),
    'active',
    'Complete Absolute Batman #1–20, all #1 variants, all printings, and DC All In Special #1.',
    2500.00,
    'high'
);

INSERT INTO vault_hunt.collection_hunt (slug, name, category_id, status, description, budget, priority)
VALUES (
    'pokemon-30th-anniversary',
    'Pokémon 30th Anniversary',
    (SELECT id FROM vault_core.categories WHERE kind = 'pokemon'),
    'active',
    'Sealed Pokémon investment portfolio centered on the 30th Anniversary release wave.',
    5000.00,
    'critical'
);

INSERT INTO vault_hunt.collection_hunt (slug, name, category_id, status, description)
VALUES (
    'pokemon-singles-hunts',
    'Pokémon Singles Hunts',
    (SELECT id FROM vault_core.categories WHERE kind = 'pokemon'),
    'coming_soon',
    'Targeted singles acquisition hunts — chase cards, PSA upgrades, set completion.'
);

COMMENT ON SCHEMA vault_hunt IS 'Collection Hunts — IQVault personal intelligence module';
