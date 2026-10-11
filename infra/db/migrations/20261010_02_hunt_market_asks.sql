-- ============================================================================
-- HUNT market slice, part 1: eBay asks for hunt items + price-band alerts.
-- Operator decision 2026-10-10: hunt asks live in vault_hunt, not
-- vault_market.listing_observation (that table requires an owned asset +
-- holding; hunt items are books not yet owned). Fetched only when the
-- operator clicks "Check eBay now".
--
-- Asks are observations (time series), never a market value. Low ask / count
-- are computed at read time, never stored on hunt_item. Raw Browse JSON lives
-- in vault_evidence.raw_snapshots. Provider ids live in provider_ids jsonb.
-- ============================================================================

BEGIN;

SET search_path TO vault_hunt, vault_evidence, public;

CREATE TABLE IF NOT EXISTS vault_hunt.hunt_listing_observation (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    hunt_item_id        UUID NOT NULL REFERENCES vault_hunt.hunt_item(id) ON DELETE CASCADE,
    observation_kind    TEXT NOT NULL
                        CHECK (observation_kind IN ('browse_listing', 'browse_empty')),
    source              TEXT NOT NULL,
    query_text          TEXT NOT NULL,
    listing_id          TEXT,
    ask_price           NUMERIC(12,2),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    listing_title       TEXT,
    listing_url         TEXT,
    -- Explicit token, never NULL: 'raw', 'graded', or 'any' when the title does not say.
    condition_key       TEXT NOT NULL DEFAULT 'any',
    -- strong = series + issue + cover/variant named in the title; weak = series + issue only.
    title_match         TEXT NOT NULL
                        CHECK (title_match IN ('strong', 'weak', 'none')),
    observed_at         TIMESTAMPTZ NOT NULL,
    raw_snapshot_id     UUID REFERENCES vault_evidence.raw_snapshots(id),
    provider_ids        JSONB NOT NULL DEFAULT '{}'::jsonb,
    prov_source         TEXT NOT NULL,
    prov_method         vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version   TEXT NOT NULL,
    prov_confidence     NUMERIC(4,3) NOT NULL
                        CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification   vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes          TEXT,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hunt_listing_observation_condition_present
      CHECK (length(trim(condition_key)) > 0),
    CONSTRAINT hunt_listing_observation_kind_shape
      CHECK (
        (observation_kind = 'browse_listing' AND listing_id IS NOT NULL AND ask_price IS NOT NULL AND ask_price > 0)
        OR (observation_kind = 'browse_empty' AND listing_id IS NULL AND ask_price IS NULL)
      )
);

CREATE UNIQUE INDEX IF NOT EXISTS hunt_listing_observation_unique_event
  ON vault_hunt.hunt_listing_observation (hunt_item_id, source, COALESCE(listing_id, ''), observed_at);

CREATE INDEX IF NOT EXISTS hunt_listing_observation_item_idx
  ON vault_hunt.hunt_listing_observation (hunt_item_id, observed_at DESC);

COMMENT ON TABLE vault_hunt.hunt_listing_observation IS
  'Marketplace asks observed for hunt items (books not yet owned). Asking price is not market value; never a sale. browse_empty = the check ran and found nothing.';

CREATE TABLE IF NOT EXISTS vault_hunt.hunt_band_alert (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    hunt_item_id        UUID NOT NULL REFERENCES vault_hunt.hunt_item(id) ON DELETE CASCADE,
    source              TEXT NOT NULL,
    listing_id          TEXT NOT NULL,
    band                TEXT NOT NULL
                        CHECK (band IN ('HIGH_PRIORITY', 'PRIORITY_UP', 'BUY', 'WATCH')),
    ask_price           NUMERIC(12,2) NOT NULL CHECK (ask_price > 0),
    listing_title       TEXT,
    listing_url         TEXT,
    observation_id      UUID NOT NULL REFERENCES vault_hunt.hunt_listing_observation(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'seen', 'dismissed')),
    prov_rule_version   TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One alert per listing per hunt item: a re-check never repeats it.
    CONSTRAINT hunt_band_alert_once_per_listing UNIQUE (hunt_item_id, source, listing_id)
);

CREATE INDEX IF NOT EXISTS hunt_band_alert_item_idx
  ON vault_hunt.hunt_band_alert (hunt_item_id, created_at DESC);

COMMENT ON TABLE vault_hunt.hunt_band_alert IS
  'A hunt item listing whose ask fell inside one of its price bands (or under its target). Deduplicated per listing; status is the operator''s.';

COMMIT;
