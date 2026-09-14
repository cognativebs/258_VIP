-- ============================================================================
-- Daily PriceCharting guide snapshots (comics LIVE history).
-- Time series only — never a current_price column. Not vault_market.sale.
-- One row per holding + condition + source + America/Chicago calendar day.
-- ============================================================================

BEGIN;

SET search_path TO vault_market, vault_collection, vault_core, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_market.guide_price_observation (
    id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id                UUID NOT NULL REFERENCES vault_core.asset (id) ON DELETE CASCADE,
    holding_id              UUID REFERENCES vault_collection.holding (id) ON DELETE SET NULL,
    holding_source_row_id   TEXT NOT NULL,
    priced_unit_id          UUID REFERENCES vault_market.priced_unit (id),
    condition_key           TEXT NOT NULL,
    snapshot_on             DATE NOT NULL,
    observed_at             TIMESTAMPTZ NOT NULL,
    observation_kind        TEXT NOT NULL
                            CHECK (observation_kind IN ('guide_quote', 'guide_empty')),
    source                  TEXT NOT NULL,
    data_source_id          SMALLINT REFERENCES vault_market.data_source (data_source_id),
    evidence_class          TEXT NOT NULL REFERENCES vault_core.evidence_class (evidence_class),
    guide_price             NUMERIC(12,2),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    raw_snapshot_id         UUID REFERENCES vault_evidence.raw_snapshots (id),
    provider_ids            JSONB NOT NULL DEFAULT '{}'::jsonb,
    prov_source             TEXT NOT NULL,
    prov_method             vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version       TEXT NOT NULL,
    prov_confidence         NUMERIC(4,3) NOT NULL
                            CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification       vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes              TEXT,
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT guide_price_observation_condition_present
      CHECK (length(trim(condition_key)) > 0),
    CONSTRAINT guide_price_observation_price_matches_kind
      CHECK (
        (observation_kind = 'guide_quote' AND guide_price IS NOT NULL AND guide_price > 0)
        OR (observation_kind = 'guide_empty' AND guide_price IS NULL)
      ),
    CONSTRAINT guide_price_observation_unique_day
      UNIQUE (holding_source_row_id, condition_key, source, snapshot_on)
);

CREATE INDEX IF NOT EXISTS guide_price_observation_holding_day_idx
  ON vault_market.guide_price_observation (holding_source_row_id, snapshot_on DESC);

CREATE INDEX IF NOT EXISTS guide_price_observation_asset_day_idx
  ON vault_market.guide_price_observation (asset_id, snapshot_on DESC);

COMMENT ON TABLE vault_market.guide_price_observation IS
  'Daily PriceCharting guide snapshots (vendor_derived · unverified). History is this table, not a scalar on asset/holding. Not a sold ledger. LIVE chips still read listing_observation from the same walk.';

COMMENT ON COLUMN vault_market.guide_price_observation.snapshot_on IS
  'America/Chicago calendar day of the morning job. Re-running the same day upserts this row.';

COMMENT ON COLUMN vault_market.guide_price_observation.condition_key IS
  'Required. Loose/ungraded guide uses raw_ungraded. NULL is forbidden.';

COMMENT ON COLUMN vault_market.guide_price_observation.priced_unit_id IS
  'UUID vault_market.priced_unit when one exists. Comics holdings often have none yet.';

COMMENT ON COLUMN vault_market.guide_price_observation.evidence_class IS
  'Always vendor_derived for PriceCharting. Confidence ceiling 0.75.';

COMMIT;
