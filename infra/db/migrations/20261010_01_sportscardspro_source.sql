-- SportsCardsPro (PriceCharting's sports host) in the source registry — identification only, the
-- operator's own tooling (ADR 0010 amendment 2026-10-10). Recorded inactive: the operator reads the
-- API terms first; the adapter itself also needs VIP_CATALOG_SPORTSCARDSPRO=1. Redistribution false.
-- Seed only. Re-runnable. No vault_market observations are written by this source.

BEGIN;

SET search_path TO vault_market, vault_core, public;

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class, terms_url, redistribution_allowed,
   category_coverage, is_active)
VALUES
  ('sportscardspro', 'SportsCardsPro (sports card catalog, identification only)', 'rest_api', 'vendor_derived',
   'https://www.sportscardspro.com/api-documentation', false, '{sports}', false)
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE vault_market.data_source IS
  'Market and catalog data sources (PC-CORE-01). terms_url records the licence checked; redistribution_allowed false keeps data in the operator''s own tooling. is_active marks a source the operator has enabled.';

COMMIT;
