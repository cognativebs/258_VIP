-- ============================================================================
-- Adopt live vault_market.guide_price_observation (ADR 0012).
-- DDL matches the 2026-09-14 job on cursor/pricecharting-core-wiring-f536
-- (commit c3202cd) which created the table outside this branch.
-- Adds ingest_batch / baseline_eligible and tags the pre-adapter batch.
-- Deprecates vault_core.market_price_observation (no new writers).
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

ALTER TABLE vault_market.guide_price_observation
  ADD COLUMN IF NOT EXISTS ingest_batch TEXT;

ALTER TABLE vault_market.guide_price_observation
  ADD COLUMN IF NOT EXISTS baseline_eligible BOOLEAN NOT NULL DEFAULT true;

UPDATE vault_market.guide_price_observation
   SET ingest_batch = 'pre_adapter_20260913',
       baseline_eligible = false
 WHERE ingest_batch IS NULL
   AND prov_rule_version = 'pricecharting-guide-snapshot@0.1.0';

CREATE INDEX IF NOT EXISTS guide_price_observation_baseline_idx
  ON vault_market.guide_price_observation (asset_id, condition_key, snapshot_on DESC)
  WHERE baseline_eligible;

COMMENT ON TABLE vault_market.guide_price_observation IS
  'Vendor guide observations (PriceCharting). ADR 0012. Not asks, not sales. Join is asset_id; condition_key is required. priced_unit_id stays NULL until TCG D1/D2.';

COMMENT ON COLUMN vault_market.guide_price_observation.ingest_batch IS
  'pre_adapter_20260913 = Sept 13-16 loose-only walk. Excluded from emitters and baseline.';

COMMENT ON COLUMN vault_market.guide_price_observation.baseline_eligible IS
  'false for the pre-adapter unverified batch. Emitters and price_series must filter this.';

CREATE OR REPLACE VIEW vault_market.v_guide_price_baseline AS
SELECT *
  FROM vault_market.guide_price_observation
 WHERE baseline_eligible
   AND ingest_batch IS DISTINCT FROM 'pre_adapter_20260913';

COMMENT ON VIEW vault_market.v_guide_price_baseline IS
  'Guide rows allowed into emitters / baseline series. Pre-adapter batch excluded.';

COMMENT ON TABLE vault_core.market_price_observation IS
  'DEPRECATED (ADR 0012). No new writers. No condition_key. Use listing_observation (asks) or guide_price_observation (vendor guide).';

COMMIT;
