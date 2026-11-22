-- CovrPrice as a comics guide-price source (operator, 2026-10-31: E4 "yes", after upgrading CovrPrice so the
-- CLZ Cloud export carries a "CovrPrice Value" column). VALUE order becomes
-- locked > CovrPrice > ComicBase > CLZ > PriceCharting.
-- Values arrive only through the operator's CLZ Cloud CSV export (file drop, no network call). Each becomes a
-- dated row in vault_market.guide_price_observation (one per holding, source, condition and day), never a
-- scalar overwrite. CovrPrice is a vendor guide built from sales (vendor_derived), not a sold comp.
-- baseline_eligible stays false on its rows, so the PriceCharting baseline is unchanged.
-- Rows only (vault_market.data_source registry); no schema change. Re-runnable.

BEGIN;

SET search_path TO vault_market, public;

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class, terms_url, redistribution_allowed,
   latency_minutes, category_coverage, is_active)
VALUES
  ('covrprice', 'CovrPrice (value via CLZ Cloud export)', 'manual', 'vendor_derived', 'https://covrprice.com/',
   false, NULL, '{comics}', true)
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE vault_market.data_source IS
  'Market and catalog data sources (PC-CORE-01). terms_url records the licence checked; redistribution_allowed false keeps data in the operator''s own tooling. is_active marks a source the operator has enabled.';

COMMIT;
