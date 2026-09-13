-- ============================================================================
-- PC-CORE-01 Phase A (logical mig 25) — source registry + vendor product map.
-- Live adaptations: ADR 0011. Date-prefix required (filename order).
-- priced_unit_id is UUID → vault_market.priced_unit, not bigint TCG priced_unit.
-- ============================================================================

BEGIN;

SET search_path TO vault_market, vault_core, vault_evidence, public;

-- Evidence classification — provenance spine for derived values (PC-CORE-01 A.1)
CREATE TABLE IF NOT EXISTS vault_core.evidence_class (
    evidence_class       text PRIMARY KEY,
    description          text NOT NULL,
    is_factual           boolean NOT NULL,
    confidence_ceiling   numeric(3,2) NOT NULL CHECK (confidence_ceiling >= 0 AND confidence_ceiling <= 1.0)
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
  'Controlled vocabulary for how a value was obtained. confidence_ceiling is the max an agent may claim when this class is the weakest evidence in the bundle. vendor_derived never exceeds 0.75.';

-- Data source registry (PC-CORE-01 A.2)
CREATE TABLE IF NOT EXISTS vault_market.data_source (
    data_source_id           smallserial PRIMARY KEY,
    source_key               text UNIQUE NOT NULL,
    display_name             text NOT NULL,
    access_method            text NOT NULL,
    default_evidence_class   text NOT NULL REFERENCES vault_core.evidence_class (evidence_class),
    terms_url                text,
    redistribution_allowed   boolean NOT NULL DEFAULT false,
    latency_minutes          integer,
    category_coverage        text[] NOT NULL DEFAULT '{}',
    is_active                boolean NOT NULL DEFAULT true,
    historical_accuracy      numeric(4,3),
    accuracy_sample_n        integer NOT NULL DEFAULT 0,
    accuracy_computed_at     timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT data_source_access_method_ok
      CHECK (access_method IN ('rest_api', 'bulk_csv', 'scraper', 'manual'))
);

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class,
   redistribution_allowed, latency_minutes, category_coverage, terms_url)
VALUES
  ('pricecharting', 'PriceCharting Legendary', 'rest_api', 'vendor_derived',
   false, 1440, ARRAY['comics','sports_cards','tcg','lego','video_games','coins'],
   'https://www.pricecharting.com/api-documentation'),
  ('ebay_browse',   'eBay Browse API',         'rest_api', 'observed',
   false, 5,    ARRAY['comics','sports_cards','tcg','lego'],
   'https://developer.ebay.com/api-docs/buy/browse/overview.html')
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE vault_market.data_source IS
  'Swappable market/catalog providers. historical_accuracy is measured (Phase F), never hand-asserted. redistribution_allowed is a hard gate for Digital Tools — PriceCharting stays false until a written vendor reply is filed.';

COMMENT ON COLUMN vault_market.data_source.redistribution_allowed IS
  'When false, customer-facing edge may ship derived answers only — never vendor price tables or raw vendor keys.';

-- Vendor product → live priced_unit / asset (PC-CORE-01 A.3, UUID join)
CREATE TABLE IF NOT EXISTS vault_market.vendor_product_map (
    id                     UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    data_source_id         smallint NOT NULL REFERENCES vault_market.data_source (data_source_id),
    vendor_product_id      text NOT NULL,
    vendor_product_name    text NOT NULL,
    vendor_console_name    text,
    vendor_upc             text,
    priced_unit_id         UUID REFERENCES vault_market.priced_unit (id),
    asset_id               UUID REFERENCES vault_core.asset (id),
    match_method           text NOT NULL,
    match_confidence       numeric(3,2),
    needs_review           boolean NOT NULL DEFAULT true,
    confirmed_at           timestamptz,
    confirmed_by           text,
    first_seen_at          timestamptz NOT NULL DEFAULT now(),
    last_seen_at           timestamptz NOT NULL DEFAULT now(),
    provider_ids           jsonb NOT NULL DEFAULT '{}'::jsonb,
    prov_source            text NOT NULL,
    prov_method            vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version      text NOT NULL,
    prov_confidence        numeric(4,3) NOT NULL
                           CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification      vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes             text,
    CONSTRAINT vendor_product_map_method_ok
      CHECK (match_method IN ('upc', 'exact_name', 'trgm', 'manual', 'unmatched')),
    CONSTRAINT vendor_product_map_unique_vendor
      UNIQUE (data_source_id, vendor_product_id),
    CONSTRAINT vendor_product_map_confidence_range
      CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
    CONSTRAINT vendor_product_map_auto_confirm_floor
      CHECK (
        needs_review = true
        OR match_method IN ('upc', 'exact_name', 'manual')
      )
);

CREATE INDEX IF NOT EXISTS vendor_product_map_unit_idx
  ON vault_market.vendor_product_map (priced_unit_id)
  WHERE priced_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_product_map_asset_idx
  ON vault_market.vendor_product_map (asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_product_map_review_idx
  ON vault_market.vendor_product_map (needs_review)
  WHERE needs_review;

CREATE INDEX IF NOT EXISTS vendor_product_map_name_trgm
  ON vault_market.vendor_product_map USING gin (vendor_product_name gin_trgm_ops);

COMMENT ON TABLE vault_market.vendor_product_map IS
  'PriceCharting (and later vendor) product id → VIP priced_unit or asset. Mapping is a reviewable record, not a guess baked into ingest. Confirmed rows are never overwritten by rematch. needs_review is never auto-cleared.';

COMMENT ON COLUMN vault_market.vendor_product_map.priced_unit_id IS
  'UUID vault_market.priced_unit. Nullable until a RAW/graded priced_unit exists for the asset.';

COMMENT ON COLUMN vault_market.vendor_product_map.asset_id IS
  'Live comics/sports join when priced_unit rows do not exist yet. Not a silent grade.';

COMMENT ON COLUMN vault_market.vendor_product_map.provider_ids IS
  'Opaque vendor identifiers (e.g. pricecharting_id). Never a primary or foreign key.';

COMMENT ON COLUMN vault_market.vendor_product_map.needs_review IS
  'Permanent workflow state. Matcher may set true; it never flips true → false except upc/exact_name/manual on insert. Confirmed rows are frozen.';

CREATE OR REPLACE FUNCTION vault_market.vendor_product_map_protect_confirmed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.confirmed_at IS NOT NULL THEN
    IF NEW.data_source_id IS NOT DISTINCT FROM OLD.data_source_id
       AND NEW.vendor_product_id IS NOT DISTINCT FROM OLD.vendor_product_id
       AND NEW.vendor_product_name IS NOT DISTINCT FROM OLD.vendor_product_name
       AND NEW.vendor_console_name IS NOT DISTINCT FROM OLD.vendor_console_name
       AND NEW.vendor_upc IS NOT DISTINCT FROM OLD.vendor_upc
       AND NEW.priced_unit_id IS NOT DISTINCT FROM OLD.priced_unit_id
       AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
       AND NEW.match_method IS NOT DISTINCT FROM OLD.match_method
       AND NEW.match_confidence IS NOT DISTINCT FROM OLD.match_confidence
       AND NEW.needs_review IS NOT DISTINCT FROM OLD.needs_review
       AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
       AND NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by
       AND NEW.first_seen_at IS NOT DISTINCT FROM OLD.first_seen_at
       AND NEW.provider_ids IS NOT DISTINCT FROM OLD.provider_ids
       AND NEW.prov_source IS NOT DISTINCT FROM OLD.prov_source
       AND NEW.prov_method IS NOT DISTINCT FROM OLD.prov_method
       AND NEW.prov_rule_version IS NOT DISTINCT FROM OLD.prov_rule_version
       AND NEW.prov_confidence IS NOT DISTINCT FROM OLD.prov_confidence
       AND NEW.prov_verification IS NOT DISTINCT FROM OLD.prov_verification
       AND NEW.prov_notes IS NOT DISTINCT FROM OLD.prov_notes
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'confirmed vendor_product_map row is never overwritten by rematch; update last_seen_at only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_product_map_protect_confirmed
  ON vault_market.vendor_product_map;
CREATE TRIGGER trg_vendor_product_map_protect_confirmed
  BEFORE UPDATE ON vault_market.vendor_product_map
  FOR EACH ROW
  EXECUTE FUNCTION vault_market.vendor_product_map_protect_confirmed();

COMMIT;
