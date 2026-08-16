-- ============================================================================
-- Daily card price history (TCGplayer first).
--
-- Grain is the CARD, not the binder slot. The pre-existing
-- vault_tcg.price_snapshot is keyed on slot_id with ON DELETE CASCADE, which
-- would (a) duplicate identical history for a card held in two binders and
-- (b) destroy price history when a slot is rearranged or deleted. History must
-- outlive layout, so it lives in vault_market keyed on (source, external_id).
--
-- price_snapshot is left in place (nothing ever wrote to it) and superseded.
-- ============================================================================

SET search_path TO vault_market, vault_evidence, vault_core, public;

CREATE TABLE IF NOT EXISTS vault_market.card_price_history (
    id              BIGSERIAL PRIMARY KEY,

    -- Provider-independent card key. asset_id is filled in when the card is
    -- also a canonical VIP asset; history does not depend on it existing.
    source          TEXT NOT NULL,              -- catalog: 'pokemontcg'
    external_id     TEXT NOT NULL,              -- e.g. 'base1-4'
    asset_id        UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,

    -- What exactly was priced.
    price_source    TEXT NOT NULL,              -- 'tcgplayer.com'
    product_id      TEXT,                       -- provider product id, for replay
    variant         TEXT NOT NULL,              -- 'Holofoil' | 'Normal' | ...
    condition       TEXT NOT NULL DEFAULT 'NM'
                    CHECK (condition IN ('NM','LP','MP','HP','DMG','UNKNOWN')),
    -- TRUE when the provider never reported this condition and NM was assumed.
    condition_assumed BOOLEAN NOT NULL DEFAULT FALSE,

    observed_on     DATE NOT NULL,              -- history key (UTC day)
    currency        TEXT NOT NULL DEFAULT 'USD',

    -- Provider's computed value. Published even on zero-sale days, so it is
    -- NOT evidence of a trade — see prov_method.
    market_price    NUMERIC(12,2),
    -- Observed sale range for the day; NULL when nothing sold.
    low_sale_price  NUMERIC(12,2),
    high_sale_price NUMERIC(12,2),
    quantity_sold   INTEGER NOT NULL DEFAULT 0,
    transaction_count INTEGER NOT NULL DEFAULT 0,

    prov_source     TEXT NOT NULL,
    prov_method     vault_evidence.provenance_method NOT NULL DEFAULT 'normalized',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.600
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes      TEXT,

    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A price is either a real range or absent; never a $0 placeholder.
    CONSTRAINT card_price_history_has_a_price CHECK (
      market_price IS NOT NULL OR low_sale_price IS NOT NULL
    ),
    CONSTRAINT card_price_history_range_ordered CHECK (
      low_sale_price IS NULL OR high_sale_price IS NULL
      OR high_sale_price >= low_sale_price
    ),

    -- One row per card / day / provider / printing / condition. This is what
    -- makes an ad-hoc re-run on the same day an update instead of a duplicate.
    CONSTRAINT card_price_history_daily_unique UNIQUE
      (source, external_id, price_source, variant, condition, observed_on)
);

CREATE INDEX IF NOT EXISTS card_price_history_card_idx
  ON vault_market.card_price_history (source, external_id, observed_on DESC);

CREATE INDEX IF NOT EXISTS card_price_history_asset_idx
  ON vault_market.card_price_history (asset_id, observed_on DESC)
  WHERE asset_id IS NOT NULL;

-- Days with real trades are the rows a valuation should lean on.
CREATE INDEX IF NOT EXISTS card_price_history_traded_idx
  ON vault_market.card_price_history (source, external_id, observed_on DESC)
  WHERE transaction_count > 0;

COMMENT ON TABLE vault_market.card_price_history IS
  'Daily price history per card/printing/condition. Card-grained so it survives binder layout changes. market_price is provider-computed (normalized); low/high sale + transaction_count are observed evidence.';
COMMENT ON COLUMN vault_market.card_price_history.condition_assumed IS
  'TRUE when the provider did not report this condition and NM was assumed (rule 2 — never stored as verified).';
COMMENT ON TABLE vault_tcg.price_snapshot IS
  'Superseded by vault_market.card_price_history (card-grained, survives slot deletion). Never written to.';
