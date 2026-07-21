-- ============================================================================
-- VaultOS / IQVault Catalog — 02: TCG CATEGORIES (Pokémon + MTG)
-- Category-specific tables that attach to vault_core.asset via asset_id.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_pokemon;
CREATE SCHEMA IF NOT EXISTS vault_mtg;

-- ============================================================================
-- POKÉMON
-- ============================================================================
SET search_path TO vault_pokemon, vault_core, public;

-- Sets / expansions
CREATE TABLE vault_pokemon.set (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,              -- 'Scarlet & Violet 151'
    code            TEXT,                        -- 'SV2a' (printed set code)
    series          TEXT,                        -- 'Scarlet & Violet'
    language        TEXT NOT NULL DEFAULT 'english',  -- english/japanese/korean...
    release_date    DATE,
    total_cards     SMALLINT,                    -- printed set size (e.g. 165)
    secret_count    SMALLINT,                    -- secret rares beyond printed total
    pokemontcgio_id TEXT,                         -- map to pokemontcg.io
    tcgplayer_group_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, language)
);

-- The Pokémon-specific card record. One row per ASSET (base or parallel).
CREATE TABLE vault_pokemon.card (
    asset_id        UUID PRIMARY KEY REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    set_id          UUID NOT NULL REFERENCES vault_pokemon.set(id),

    -- Identity
    name            TEXT NOT NULL,               -- 'Charizard ex'
    collector_number TEXT NOT NULL,              -- '199/165' or '006' — KEY for OCR match
    national_pokedex SMALLINT,

    -- Classification
    rarity          TEXT,                        -- 'Special Illustration Rare','Double Rare'
    card_type       TEXT,                        -- 'Pokémon','Trainer','Energy'
    supertype       TEXT,                        -- ex/V/VMAX/VSTAR/GX/none
    hp              SMALLINT,
    types           TEXT[],                      -- ['Fire']

    -- THE PARALLEL/VARIANT MODEL — this is where we beat competitors.
    -- variant_type names the finish/parallel; the base card has 'normal'.
    variant_type    TEXT NOT NULL DEFAULT 'normal',
                    -- 'normal','reverse_holo','holo','master_ball','poke_ball',
                    -- 'illustration_rare','special_illustration_rare','full_art',
                    -- 'gold','rainbow','1st_edition','shadowless','staff_promo' ...
    finish          TEXT,                        -- 'holofoil','reverse_holofoil','etched','cosmos'
    is_first_edition BOOLEAN DEFAULT FALSE,
    is_shadowless   BOOLEAN DEFAULT FALSE,
    is_promo        BOOLEAN DEFAULT FALSE,
    promo_set       TEXT,                        -- 'Black Star Promos','Prerelease'

    -- Visual ID hints for the classifier (Stage 4)
    foil_pattern    TEXT,                        -- 'cosmos','cracked_ice','tinsel','sheen'
    border_color    TEXT,
    has_serial      BOOLEAN DEFAULT FALSE,       -- numbered cards (rare in Pokémon)

    -- Artist (links to vault_core.entity too, but kept here for convenience)
    illustrator     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (set_id, collector_number, variant_type)
);
CREATE INDEX idx_pkmn_set        ON vault_pokemon.card(set_id);
CREATE INDEX idx_pkmn_number     ON vault_pokemon.card(collector_number);
CREATE INDEX idx_pkmn_variant    ON vault_pokemon.card(variant_type);
CREATE INDEX idx_pkmn_name_trgm  ON vault_pokemon.card USING gin (name gin_trgm_ops);

-- ============================================================================
-- MAGIC: THE GATHERING  (Scryfall is the canonical upstream)
-- ============================================================================
SET search_path TO vault_mtg, vault_core, public;

CREATE TABLE vault_mtg.set (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    code            TEXT UNIQUE,                 -- 'MAR' (Marvel Super Heroes)
    set_type        TEXT,                        -- 'expansion','universes_beyond','commander'
    release_date    DATE,
    card_count      SMALLINT,
    scryfall_set_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_mtg.card (
    asset_id        UUID PRIMARY KEY REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    set_id          UUID NOT NULL REFERENCES vault_mtg.set(id),

    name            TEXT NOT NULL,
    collector_number TEXT NOT NULL,
    mana_cost       TEXT,
    type_line       TEXT,
    rarity          TEXT,                        -- common/uncommon/rare/mythic

    -- MTG variant model — finishes & treatments are the "parallels"
    variant_type    TEXT NOT NULL DEFAULT 'normal',
                    -- 'normal','showcase','borderless','extended_art','retro',
                    -- 'textless','serialized','surge_foil','gilded' ...
    finish          TEXT NOT NULL DEFAULT 'nonfoil',  -- nonfoil/foil/etched
    frame_effects   TEXT[],                      -- ['showcase','extendedart']
    promo_types     TEXT[],
    is_serialized   BOOLEAN DEFAULT FALSE,
    serial_max      INTEGER,                     -- e.g. 150 for /150

    -- Playability signals (MTG value is partly format-driven — feeds offer engine)
    is_commander_staple BOOLEAN DEFAULT FALSE,
    standard_legal  BOOLEAN DEFAULT FALSE,

    illustrator     TEXT,
    scryfall_id     TEXT UNIQUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (set_id, collector_number, variant_type, finish)
);
CREATE INDEX idx_mtg_set       ON vault_mtg.card(set_id);
CREATE INDEX idx_mtg_number    ON vault_mtg.card(collector_number);
CREATE INDEX idx_mtg_variant   ON vault_mtg.card(variant_type);
CREATE INDEX idx_mtg_name_trgm ON vault_mtg.card USING gin (name gin_trgm_ops);
