-- Align vendor_product_map with live provenance columns required for
-- derived match rows (AGENTS.md: every derived field carries provenance).
-- Idempotent: live DB already has these columns.

BEGIN;

SET search_path TO vault_market, vault_evidence, public;

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_source TEXT;

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_method vault_evidence.provenance_method NOT NULL DEFAULT 'inferred';

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_rule_version TEXT;

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_confidence NUMERIC(4,3);

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'unverified';

ALTER TABLE vault_market.vendor_product_map
  ADD COLUMN IF NOT EXISTS prov_notes TEXT;

UPDATE vault_market.vendor_product_map
   SET prov_source = COALESCE(prov_source, 'pricecharting'),
       prov_rule_version = COALESCE(prov_rule_version, 'pricecharting-guide-snapshot@0.2.0'),
       prov_confidence = COALESCE(prov_confidence, 0.750)
 WHERE prov_source IS NULL
    OR prov_rule_version IS NULL
    OR prov_confidence IS NULL;

ALTER TABLE vault_market.vendor_product_map
  ALTER COLUMN prov_source SET NOT NULL;

ALTER TABLE vault_market.vendor_product_map
  ALTER COLUMN prov_rule_version SET NOT NULL;

ALTER TABLE vault_market.vendor_product_map
  ALTER COLUMN prov_confidence SET NOT NULL;

COMMENT ON COLUMN vault_market.vendor_product_map.prov_source IS
  'Derived match provenance. Automated PriceCharting matches are inferred / unverified.';

COMMIT;
