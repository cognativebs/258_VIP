-- ============================================================================
-- VaultOS / IQVault Catalog — 01: CORE SPINE
-- The universal identity layer. Every category attaches to this.
-- Target: PostgreSQL 15+
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_core;
SET search_path TO vault_core, public;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm     SCHEMA public;  -- fuzzy text search for OCR matching
CREATE EXTENSION IF NOT EXISTS vector      SCHEMA public;  -- pgvector; required for asset.image_embedding

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
CREATE TYPE category_kind AS ENUM ('pokemon', 'sports', 'mtg', 'comic', 'other');
CREATE TYPE condition_kind AS ENUM ('raw', 'graded', 'sealed');
CREATE TYPE asset_format  AS ENUM ('single', 'sealed_product', 'lot');

-- ----------------------------------------------------------------------------
-- CATEGORIES — the four pillars (+ extensibility)
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
    id              SMALLINT PRIMARY KEY,
    kind            category_kind NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories (id, kind, display_name) VALUES
    (1, 'pokemon', 'Pokémon TCG'),
    (2, 'sports',  'Sports Cards'),
    (3, 'mtg',     'Magic: The Gathering'),
    (4, 'comic',   'Comic Books'),
    (5, 'other',   'Other Collectibles');

-- ----------------------------------------------------------------------------
-- ASSET — THE SPINE.
-- One row per uniquely-identifiable collectible "thing" in the catalog.
-- A base card is an asset. Each parallel is its OWN asset. Each comic printing
-- is its own asset. Each sealed SKU is its own asset.
-- Category-specific tables (pokemon_card, sports_card, etc.) reference asset_id.
-- ----------------------------------------------------------------------------
CREATE TABLE asset (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id     SMALLINT NOT NULL REFERENCES categories(id),
    format          asset_format NOT NULL DEFAULT 'single',

    -- Canonical display name, denormalized for search/UI (source of truth lives
    -- in the category-specific table, this is the human-facing string)
    canonical_name  TEXT NOT NULL,

    -- Stable external slug for URLs / API ("2019-prizm-mclaurin-301-silver")
    slug            TEXT UNIQUE,

    -- Parent/variant linkage: a parallel points to its base asset; a base has NULL.
    -- This is how the parallel "ladder" and comic "printing run" are modeled.
    base_asset_id   UUID REFERENCES asset(id),

    -- Year is universal enough to live on the spine for fast filtering
    release_year    SMALLINT,

    -- Free-form tags for cross-cutting concepts (e.g. 'rookie', 'rainbow-member')
    tags            TEXT[] DEFAULT '{}',

    -- Image + embedding for the ID classifier (Stage 4 disambiguation)
    primary_image_url TEXT,
    image_embedding   vector(512),   -- reference embedding for visual match

    -- Lifecycle
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_category     ON asset(category_id);
CREATE INDEX idx_asset_base         ON asset(base_asset_id);
CREATE INDEX idx_asset_year         ON asset(release_year);
CREATE INDEX idx_asset_name_trgm    ON asset USING gin (canonical_name gin_trgm_ops);
CREATE INDEX idx_asset_tags         ON asset USING gin (tags);
-- Vector index for nearest-neighbor image match (parallel disambiguation)
CREATE INDEX idx_asset_embedding    ON asset USING ivfflat (image_embedding vector_cosine_ops) WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- EXTERNAL IDENTIFIERS — map our asset to every outside source.
-- This is how we reconcile TCGplayer, Scryfall, eBay, PSA, GCD, etc.
-- ----------------------------------------------------------------------------
CREATE TABLE external_id (
    id              BIGSERIAL PRIMARY KEY,
    asset_id        UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,        -- 'tcgplayer','scryfall','ebay_epid','psa','gcd','pokemontcgio','pricecharting'
    external_value  TEXT NOT NULL,        -- the ID/SKU in that system
    url             TEXT,
    confidence      NUMERIC(4,3) DEFAULT 1.000,  -- how sure we are of this mapping
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_value)
);
CREATE INDEX idx_extid_asset ON external_id(asset_id);
CREATE INDEX idx_extid_lookup ON external_id(source, external_value);

-- ----------------------------------------------------------------------------
-- GRADING — unified condition axis across PSA/CGC/BGS/SGC + raw.
-- The offer engine and VaultScore treat (asset_id + grade) as the priced unit.
-- ----------------------------------------------------------------------------
CREATE TABLE grading_company (
    id          SMALLINT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,     -- 'PSA','CGC','BGS','SGC','RAW'
    name        TEXT NOT NULL
);
INSERT INTO grading_company (id, code, name) VALUES
    (1,'PSA','Professional Sports Authenticator'),
    (2,'CGC','Certified Guaranty Company'),
    (3,'BGS','Beckett Grading Services'),
    (4,'SGC','SGC'),
    (0,'RAW','Ungraded / Raw');

-- A normalized grade scale so a "PSA 10" and "CGC 10" can be compared.
-- normalized_score lets VaultScore reason across grading companies.
CREATE TABLE grade_scale (
    id                  SERIAL PRIMARY KEY,
    grading_company_id  SMALLINT NOT NULL REFERENCES grading_company(id),
    label               TEXT NOT NULL,        -- 'GEM MT 10','MINT 9','NM-MT 8','Pristine 10'
    numeric_grade       NUMERIC(3,1),         -- 10.0, 9.5, 9.0 ...
    normalized_score    NUMERIC(4,1) NOT NULL,-- 0–100 unified scale for cross-company compare
    is_qualified        BOOLEAN DEFAULT FALSE, -- e.g. PSA "MC"/"OC" qualifiers
    UNIQUE (grading_company_id, label)
);

-- ----------------------------------------------------------------------------
-- SHARED REFERENCE: people/entities that span categories
-- (athletes, artists, characters, franchises) — used by sports & comics & TCG
-- ----------------------------------------------------------------------------
CREATE TABLE entity (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL,        -- 'athlete','artist','character','franchise','team'
    name        TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',   -- sport, position, debut year, publisher, etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entity_type ON entity(entity_type);
CREATE INDEX idx_entity_name_trgm ON entity USING gin (name gin_trgm_ops);

-- Link assets to entities (an asset can have many: player + team, or artist + character)
CREATE TABLE asset_entity (
    asset_id    UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    entity_id   UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    role        TEXT,                 -- 'subject','artist','cover_artist','team'
    PRIMARY KEY (asset_id, entity_id, role)
);

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_touch BEFORE UPDATE ON asset
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
