-- ============================================================================
-- VaultOS / IQVault Catalog — 03: SPORTS + COMICS
-- The two categories with the weakest public data = the biggest moat.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_sports;
CREATE SCHEMA IF NOT EXISTS vault_comic;

-- ============================================================================
-- SPORTS CARDS — the parallel/rainbow problem lives here.
-- There is no clean public API; this catalog is proprietary IP once built.
-- ============================================================================
SET search_path TO vault_sports, vault_core, public;

CREATE TABLE vault_sports.product (
    -- A "product" = a set release, e.g. "2019 Panini Flawless Football"
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year            SMALLINT NOT NULL,
    manufacturer    TEXT NOT NULL,               -- 'Panini','Topps','Upper Deck'
    brand           TEXT NOT NULL,               -- 'Flawless','Prizm','National Treasures'
    sport           TEXT NOT NULL,               -- 'football','basketball','baseball'
    release_date    DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, manufacturer, brand, sport)
);

-- A "subset" within a product, e.g. "Rookie Patch Autographs"
CREATE TABLE vault_sports.subset (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID NOT NULL REFERENCES vault_sports.product(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,               -- 'Rookie Patch Autographs','Base'
    is_autograph    BOOLEAN DEFAULT FALSE,
    is_memorabilia  BOOLEAN DEFAULT FALSE,       -- patch/relic
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE PARALLEL LADDER definition — what parallels exist for a subset, and their order.
-- This is the constraint set that makes Stage-4 disambiguation tractable:
-- once we know the subset, we know the EXACT parallel ladder to choose between.
CREATE TABLE vault_sports.parallel_type (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subset_id       UUID NOT NULL REFERENCES vault_sports.subset(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,               -- 'Base','Silver','Ruby','Emerald','Platinum'
    print_run       INTEGER,                     -- 25,20,15,10,5,1  (NULL = unnumbered)
    is_one_of_one   BOOLEAN DEFAULT FALSE,
    ladder_rank     SMALLINT,                    -- ordering within the rainbow (1=base...)
    -- Visual fingerprint for the classifier
    foil_color      TEXT,                        -- 'silver','red','gold','green'
    foil_pattern    TEXT,                        -- 'prizm','disco','shimmer','mojo'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subset_id, name)
);

-- The actual card. One row per ASSET (each parallel of each player = its own asset).
CREATE TABLE vault_sports.card (
    asset_id        UUID PRIMARY KEY REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    subset_id       UUID NOT NULL REFERENCES vault_sports.subset(id),
    parallel_type_id UUID REFERENCES vault_sports.parallel_type(id),

    card_number     TEXT,                        -- printed number on card
    player_name     TEXT NOT NULL,
    team            TEXT,
    is_rookie       BOOLEAN DEFAULT FALSE,        -- RC — major value driver

    -- Numbering for THIS specific copy-class (the parallel's run)
    serial_max      INTEGER,                     -- 5 for /5; 1 for 1/1
    is_one_of_one   BOOLEAN DEFAULT FALSE,

    -- Memorabilia/auto detail (drives premium — e.g. "quad patch")
    auto_type       TEXT,                        -- 'on_card','sticker',NULL
    patch_type      TEXT,                        -- 'single','quad','laundry_tag','nike_swoosh'
    memorabilia_desc TEXT,

    -- Classifier hints
    has_serial_stamp BOOLEAN DEFAULT TRUE,
    image_front_url TEXT,
    image_back_url  TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sports_subset   ON vault_sports.card(subset_id);
CREATE INDEX idx_sports_parallel ON vault_sports.card(parallel_type_id);
CREATE INDEX idx_sports_player_trgm ON vault_sports.card USING gin (player_name gin_trgm_ops);
CREATE INDEX idx_sports_rookie   ON vault_sports.card(is_rookie) WHERE is_rookie = TRUE;

-- ============================================================================
-- COMICS — the "printing run" problem (Absolute Batman #1 across 11 printings).
-- GCD (Grand Comics Database) is the canonical upstream.
-- ============================================================================
SET search_path TO vault_comic, vault_core, public;

CREATE TABLE vault_comic.series (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,               -- 'Absolute Batman'
    publisher       TEXT NOT NULL,               -- 'DC Comics'
    volume          SMALLINT DEFAULT 1,
    year_began      SMALLINT,                     -- 2024
    gcd_series_id   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (title, publisher, volume, year_began)
);

CREATE TABLE vault_comic.issue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    series_id       UUID NOT NULL REFERENCES vault_comic.series(id) ON DELETE CASCADE,
    issue_number    TEXT NOT NULL,               -- '1','15','Annual 1'
    cover_date      DATE,
    is_key_issue    BOOLEAN DEFAULT FALSE,        -- #15 Joker origin = key
    key_reason      TEXT,                         -- '1st app','origin','death'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (series_id, issue_number)
);

-- THE COMIC VARIANT MODEL — printing + cover combine to make a unique asset.
-- "Absolute Batman #1 Cover A 1st print" and "...Cover A 3rd print" are
-- DIFFERENT assets, sharing the same issue but different printing rows.
CREATE TABLE vault_comic.variant (
    asset_id        UUID PRIMARY KEY REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    issue_id        UUID NOT NULL REFERENCES vault_comic.issue(id),

    -- Printing
    printing        SMALLINT NOT NULL DEFAULT 1, -- 1,2,3 ... 11
    -- Cover variant
    cover_label     TEXT NOT NULL DEFAULT 'A',   -- 'A','B','1:25','Virgin','Foil'
    cover_artist    TEXT,
    cover_type      TEXT,                         -- 'standard','ratio_incentive','retailer_exclusive'
    incentive_ratio TEXT,                         -- '1:25','1:100' for incentive covers

    -- Distinguishing detail for the classifier (recolored logo per printing, etc.)
    distinguishing_feature TEXT,                  -- 'recolored logo','new Dragotta art'
    is_variant_cover BOOLEAN DEFAULT FALSE,

    -- Print run estimate (often disclosed for comics)
    print_run_est   INTEGER,

    image_url       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issue_id, printing, cover_label)
);
CREATE INDEX idx_comic_issue    ON vault_comic.variant(issue_id);
CREATE INDEX idx_comic_printing ON vault_comic.variant(printing);
CREATE INDEX idx_comic_series_title_trgm ON vault_comic.series USING gin (title gin_trgm_ops);
