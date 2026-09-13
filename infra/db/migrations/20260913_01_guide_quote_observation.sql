-- ============================================================================
-- PriceCharting guide quotes on listing_observation (valuation seam).
-- Guide prices are not sold transactions — still not vault_market.sale.
-- Widens observation_kind only; no new tables or columns.
-- ============================================================================

BEGIN;

SET search_path TO vault_market, vault_evidence, public;

ALTER TABLE vault_market.listing_observation
  DROP CONSTRAINT IF EXISTS listing_observation_observation_kind_check;
ALTER TABLE vault_market.listing_observation
  DROP CONSTRAINT IF EXISTS listing_observation_price_matches_kind;

ALTER TABLE vault_market.listing_observation
  ADD CONSTRAINT listing_observation_observation_kind_check
  CHECK (observation_kind IN ('browse_listing', 'browse_empty', 'guide_quote', 'guide_empty'));

ALTER TABLE vault_market.listing_observation
  ADD CONSTRAINT listing_observation_price_matches_kind
  CHECK (
    (observation_kind IN ('browse_listing', 'guide_quote') AND ask_price IS NOT NULL AND ask_price > 0)
    OR (observation_kind IN ('browse_empty', 'guide_empty') AND ask_price IS NULL)
  );

COMMENT ON COLUMN vault_market.listing_observation.observation_kind IS
  'browse_listing = eBay ask; browse_empty = Browse matched nothing; guide_quote = PriceCharting current guide (pennies→USD, unverified); guide_empty = guide fetch matched nothing. Never a fabricated price or a sale row.';

COMMENT ON TABLE vault_market.listing_observation IS
  'Marketplace observations: eBay Browse asks and PriceCharting guide quotes. Not sold transactions — do not treat as vault_market.sale. condition_key is required; use any when grade is unknown.';

COMMIT;
