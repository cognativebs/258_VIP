-- Pokémon fair-market value from PriceCharting (2026-10-04, Greg; ADR 0012 amendment of the same date).
-- 1. vault_market.card_price_history.condition widens to graded conditions (operator-approved): the CHECK is
--    dropped and re-added as a superset, so no existing row can fail it. PriceCharting's 7/8/9/9.5 columns are
--    any grading company (GRADE_*); only the 10s are named (PSA_10, BGS_10, CGC_10, SGC_10). The ungraded
--    column is stored as NM with condition_assumed = true.
-- 2. card_price_history becomes the TCG home for vendor-guide card prices (price_source = 'pricecharting');
--    guide_price_observation stays the comics home. Neither is a sold comp. vault_market.sale and
--    vault_market.priced_unit are untouched (TCG D1/D2 still open).
-- Re-runnable.

BEGIN;

SET search_path TO vault_market, public;

ALTER TABLE vault_market.card_price_history DROP CONSTRAINT IF EXISTS card_price_history_condition_check;
ALTER TABLE vault_market.card_price_history
  ADD CONSTRAINT card_price_history_condition_check CHECK (
    condition IN (
      'NM', 'LP', 'MP', 'HP', 'DMG', 'UNKNOWN',
      'GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_9_5', 'PSA_10', 'BGS_10', 'CGC_10', 'SGC_10'
    )
  );

COMMENT ON COLUMN vault_market.card_price_history.condition IS
  'Raw conditions (NM…DMG, UNKNOWN) or graded: GRADE_7/8/9/9_5 (any grading company) and PSA_10, BGS_10, CGC_10, SGC_10. An assumed raw condition sets condition_assumed = true.';

COMMENT ON TABLE vault_market.card_price_history IS
  'Card-grained daily price history for trading cards (catalog id + day + printing + condition). price_source names the vendor guide: tcgplayer (market price history) or pricecharting (sale-derived guide, vendor_derived, confidence ≤ 0.75 per ADR 0012). Guide values, never individual sold comps.';

COMMIT;
