-- CLZ and ComicBase as comics guide-price sources (operator, 2026-10-25: "back to using a CLZ upload for
-- inventory and pricing … and stay connected to comicbase for pricing too (2nd opinion)").
-- Their values become dated rows in vault_market.guide_price_observation (one per holding, source,
-- condition and day), never a scalar overwrite. Both are vendor guides (vendor_derived), not sold comps.
-- baseline_eligible stays false on their rows, so the PriceCharting baseline is unchanged.
-- Rows only (vault_market.data_source registry); no schema change. Re-runnable.

BEGIN;

SET search_path TO vault_market, public;

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class, terms_url, redistribution_allowed,
   latency_minutes, category_coverage, is_active)
VALUES
  ('clz', 'CLZ Comics (collection export value)', 'manual', 'vendor_derived', 'https://www.clz.com/comic-collector/',
   false, NULL, '{comics}', true),
  ('comicbase', 'ComicBase (collection export price, second opinion)', 'manual', 'vendor_derived',
   'https://www.comicbase.com/', false, NULL, '{comics}', true)
ON CONFLICT (source_key) DO NOTHING;

COMMENT ON TABLE vault_market.data_source IS
  'Market and catalog data sources (PC-CORE-01). terms_url records the licence checked; redistribution_allowed false keeps data in the operator''s own tooling. is_active marks a source the operator has enabled.';

COMMIT;
