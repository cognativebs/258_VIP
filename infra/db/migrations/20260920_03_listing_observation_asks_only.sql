-- ============================================================================
-- ADR 0012: listing_observation is marketplace asks only.
-- The 2,700 PriceCharting guide_* rows already exist on
-- vault_market.guide_price_observation as ingest_batch=pre_adapter_20260913
-- (provider_ids + baseline_eligible=false). Remove the listing copies and
-- restore the browse-only kind check.
-- ============================================================================

BEGIN;

SET search_path TO vault_market, vault_collection, vault_core, vault_evidence, public;

DELETE FROM vault_market.listing_observation
 WHERE source = 'pricecharting'
    OR observation_kind IN ('guide_quote', 'guide_empty');

ALTER TABLE vault_market.listing_observation
  DROP CONSTRAINT IF EXISTS listing_observation_observation_kind_check;

ALTER TABLE vault_market.listing_observation
  ADD CONSTRAINT listing_observation_observation_kind_check
  CHECK (observation_kind IN ('browse_listing', 'browse_empty'));

ALTER TABLE vault_market.listing_observation
  DROP CONSTRAINT IF EXISTS listing_observation_price_matches_kind;

ALTER TABLE vault_market.listing_observation
  ADD CONSTRAINT listing_observation_price_matches_kind
  CHECK (
    (observation_kind = 'browse_listing' AND ask_price IS NOT NULL AND ask_price > 0)
    OR (observation_kind = 'browse_empty' AND ask_price IS NULL)
  );

COMMENT ON TABLE vault_market.listing_observation IS
  'Active marketplace listing observations (eBay Browse asks). Not vendor guide, not sold transactions. ADR 0012: PriceCharting belongs on guide_price_observation.';

COMMIT;
