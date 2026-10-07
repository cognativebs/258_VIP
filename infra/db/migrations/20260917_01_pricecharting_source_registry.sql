-- ============================================================================
-- PriceCharting source registry + vendor product map (PC-CORE-01 Phase A).
--
-- Adapted to live VIP conventions:
--   * dated migration name (AGENTS.md)
--   * UUID asset_id is the join (PriceCharting products are grade-agnostic)
--   * priced_unit_id is optional (live vault_market.priced_unit is UUID)
--   * condition_key reference table — listing_observation already uses the
--     token; this does NOT add a FK to existing rows (would be destructive
--     if any non-seeded values exist)
--
-- A PriceCharting "market value" is vendor_derived, never observed.
-- redistribution_allowed = false is a hard gate. Do not flip without
-- written vendor confirmation on file.
-- ============================================================================

BEGIN;

SET search_path TO vault_core, vault_market, public;

CREATE TABLE IF NOT EXISTS vault_core.evidence_class (
    evidence_class       TEXT PRIMARY KEY,
    description          TEXT NOT NULL,
    is_factual           BOOLEAN NOT NULL,
    confidence_ceiling   NUMERIC(3,2) NOT NULL CHECK (confidence_ceiling >= 0 AND confidence_ceiling <= 1.0)
);

INSERT INTO vault_core.evidence_class (evidence_class, description, is_factual, confidence_ceiling)
VALUES
  ('observed',       'Directly extracted from a primary source or entered by the user', true,  1.00),
  ('normalized',     'Transformed without changing meaning (currency, identifier map)',  true,  0.95),
  ('vendor_derived', 'A third-party vendor estimate with opaque methodology',            false, 0.75),
  ('inferred',       'Estimated by our own rules or models',                             false, 0.70),
  ('opinion',        'Reasoned belief about future value',                               false, 0.60)
ON CONFLICT (evidence_class) DO NOTHING;

COMMENT ON TABLE vault_core.evidence_class IS
  'Provenance spine. confidence_ceiling is load-bearing: a recommendation cannot exceed the weakest evidence class in its bundle.';

CREATE TABLE IF NOT EXISTS vault_core.condition_key (
    condition_key   TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    vertical_hint   TEXT,
    notes           TEXT
);

INSERT INTO vault_core.condition_key (condition_key, display_name, vertical_hint, notes)
VALUES
  ('any',            'Unknown (explicit)',     NULL,          'Never means match-all. NULL is forbidden.'),
  ('raw_ungraded',   'Raw / ungraded',         NULL,          'PriceCharting loose-price across verticals.'),
  ('cib',            'Complete in box',        'video_games', 'Video game CIB only.'),
  ('sealed_new',     'New / sealed',           'video_games', 'Video game new-price.'),
  ('box_only',       'Box only',               'video_games', 'Video game box-only-price.'),
  ('manual_only',    'Manual only',            'video_games', 'Video game manual-only-price.'),
  ('graded_wata',    'WATA / VGA graded',      'video_games', 'Video game graded-price.'),
  ('graded_4',       'Graded ~4.0 / 4.5',      'comic',       'Comics cib-price.'),
  ('graded_6',       'Graded ~6.0 / 6.5',      'comic',       'Comics new-price.'),
  ('graded_7',       'Graded ~7 / 7.5',        'cards',       'Cards cib-price.'),
  ('graded_8',       'Graded ~8.0 / 8.5',      NULL,          'Comics graded-price; cards new-price.'),
  ('graded_9',       'Graded 9',               'cards',       'Cards graded-price.'),
  ('graded_9_2',     'Graded 9.2',             'comic',       'Comics box-only-price.'),
  ('graded_9_4',     'Graded 9.4',             'comic',       'Comics condition-17-price.'),
  ('graded_9_5',     'Graded 9.5',             'cards',       'Cards box-only-price.'),
  ('graded_9_8',     'Graded 9.8',             'comic',       'Comics manual-only-price.'),
  ('graded_10',      'Graded 10.0 (comics)',   'comic',       'Comics bgs-10-price. Do not collapse card 10s here.'),
  ('graded_psa_10',  'PSA 10',                 'cards',       'Cards manual-only-price.'),
  ('graded_bgs_10',  'BGS 10',                 'cards',       'Cards bgs-10-price.'),
  ('graded_cgc_10',  'CGC 10',                 'cards',       'Cards condition-17-price.'),
  ('graded_sgc_10',  'SGC 10',                 'cards',       'Cards condition-18-price.')
ON CONFLICT (condition_key) DO NOTHING;

COMMENT ON TABLE vault_core.condition_key IS
  'Reference tokens for (priced_unit_id, condition_key). NULL never means any.';

CREATE TABLE IF NOT EXISTS vault_market.data_source (
    data_source_id           SMALLSERIAL PRIMARY KEY,
    source_key               TEXT UNIQUE NOT NULL,
    display_name             TEXT NOT NULL,
    access_method            TEXT NOT NULL,
    default_evidence_class   TEXT NOT NULL REFERENCES vault_core.evidence_class (evidence_class),
    terms_url                TEXT,
    redistribution_allowed   BOOLEAN NOT NULL DEFAULT false,
    latency_minutes          INTEGER,
    category_coverage        TEXT[] NOT NULL DEFAULT '{}',
    is_active                BOOLEAN NOT NULL DEFAULT true,
    historical_accuracy      NUMERIC(4,3),
    accuracy_sample_n        INTEGER NOT NULL DEFAULT 0,
    accuracy_computed_at     TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class,
   redistribution_allowed, latency_minutes, category_coverage, terms_url)
VALUES
  ('pricecharting', 'PriceCharting Legendary', 'rest_api', 'vendor_derived',
   false, 1440, ARRAY['comic','sports','pokemon','mtg','other'],
   'https://www.pricecharting.com/api-documentation'),
  ('ebay_browse', 'eBay Browse API', 'rest_api', 'observed',
   false, 5, ARRAY['comic','sports','pokemon','mtg'],
   NULL)
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE vault_market.data_source IS
  'Vendor / adapter registry. historical_accuracy is measured, never hand-asserted. redistribution_allowed is a hard gate.';

COMMENT ON COLUMN vault_market.data_source.redistribution_allowed IS
  'false for PriceCharting. Shipping raw vendor prices to a paying customer is redistribution.';

CREATE TABLE IF NOT EXISTS vault_market.vendor_product_map (
    vendor_product_map_id    BIGSERIAL PRIMARY KEY,
    data_source_id           SMALLINT NOT NULL REFERENCES vault_market.data_source (data_source_id),
    vendor_product_id        TEXT NOT NULL,
    vendor_product_name      TEXT NOT NULL,
    vendor_console_name      TEXT,
    vendor_upc               TEXT,
    asset_id                 UUID REFERENCES vault_core.asset (id),
    priced_unit_id           UUID REFERENCES vault_market.priced_unit (id),
    match_method             TEXT NOT NULL,
    match_confidence         NUMERIC(3,2),
    needs_review             BOOLEAN NOT NULL DEFAULT true,
    confirmed_at             TIMESTAMPTZ,
    confirmed_by             TEXT,
    first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, vendor_product_id),
    CONSTRAINT vendor_product_map_method_ok
      CHECK (match_method IN ('upc', 'exact_name', 'trgm', 'manual', 'unmatched')),
    CONSTRAINT vendor_product_map_confirmed_locked
      CHECK (confirmed_at IS NULL OR asset_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vpm_asset
  ON vault_market.vendor_product_map (asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpm_unit
  ON vault_market.vendor_product_map (priced_unit_id)
  WHERE priced_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpm_review
  ON vault_market.vendor_product_map (needs_review)
  WHERE needs_review;

CREATE INDEX IF NOT EXISTS idx_vpm_name_trgm
  ON vault_market.vendor_product_map USING gin (vendor_product_name gin_trgm_ops);

COMMENT ON TABLE vault_market.vendor_product_map IS
  'PriceCharting (and later vendors) product → vault_core.asset. Confirmed rows are never overwritten by automated re-match.';

COMMENT ON COLUMN vault_market.vendor_product_map.asset_id IS
  'Primary join. A vendor product is a title, not a grade. Condition is applied at observation time.';

COMMENT ON COLUMN vault_market.vendor_product_map.priced_unit_id IS
  'Optional. Live priced_unit is asset+grade_scale. Leave NULL unless a specific grade unit is confirmed.';

COMMIT;
