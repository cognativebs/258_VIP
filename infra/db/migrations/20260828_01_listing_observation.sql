-- ============================================================================
-- Browse listing observations (plan 0003 P1).
-- Active asks from eBay Browse — NOT vault_market.sale (sold transactions).
-- condition_key is NEVER NULL; use the explicit 'any' token when grade is unknown.
-- Provider ids live in jsonb. Raw Browse JSON belongs in vault_evidence.raw_snapshots.
-- ============================================================================

BEGIN;

SET search_path TO vault_market, vault_collection, vault_core, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_market.listing_observation (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id                UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    holding_id              UUID REFERENCES vault_collection.holding(id) ON DELETE SET NULL,
    holding_source_row_id   TEXT NOT NULL,
    condition_key           TEXT NOT NULL,
    observation_kind        TEXT NOT NULL
                            CHECK (observation_kind IN ('browse_listing', 'browse_empty')),
    source                  TEXT NOT NULL,
    listing_id              TEXT NOT NULL,
    ask_price               NUMERIC(12,2),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    listing_title           TEXT,
    listing_url             TEXT,
    observed_at             TIMESTAMPTZ NOT NULL,
    listing_created_at      TIMESTAMPTZ,
    raw_snapshot_id         UUID REFERENCES vault_evidence.raw_snapshots(id),
    provider_ids            JSONB NOT NULL DEFAULT '{}'::jsonb,
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL
                            CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT listing_observation_condition_key_present
      CHECK (length(trim(condition_key)) > 0),
    CONSTRAINT listing_observation_price_matches_kind
      CHECK (
        (observation_kind = 'browse_listing' AND ask_price IS NOT NULL AND ask_price > 0)
        OR (observation_kind = 'browse_empty' AND ask_price IS NULL)
      ),
    CONSTRAINT listing_observation_unique_event
      UNIQUE (source, listing_id, observed_at)
);

CREATE INDEX IF NOT EXISTS listing_observation_holding_idx
  ON vault_market.listing_observation (holding_source_row_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS listing_observation_asset_idx
  ON vault_market.listing_observation (asset_id, observed_at DESC);

COMMENT ON TABLE vault_market.listing_observation IS
  'Active marketplace listing observations (eBay Browse asks). Not sold transactions — do not treat as vault_market.sale. condition_key is required; use any when grade is unknown.';

COMMENT ON COLUMN vault_market.listing_observation.condition_key IS
  'Grade/condition pair token. NULL is forbidden; any means unknown, never “match all”.';

COMMENT ON COLUMN vault_market.listing_observation.provider_ids IS
  'Opaque provider identifiers (e.g. ebay_item_id). Never a primary or foreign key.';

COMMENT ON COLUMN vault_market.listing_observation.observation_kind IS
  'browse_listing = an ask; browse_empty = fetch ran and matched nothing. Never a fabricated price.';

COMMIT;
