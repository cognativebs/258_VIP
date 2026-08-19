-- ============================================================================
-- 16_field_modes_interfaces.sql
--
-- VIP Field Intelligence (Store/Show/Auction/Trade Modes) + CardSight visual
-- identification pipeline.
--
-- *** INTERFACES AND CONTAINER TABLES ONLY. ***
-- No mode-specific business logic, no auction max-bid calculation, no trade
-- basket-equality calculation, no identification matching logic ships here.
-- These are workflow/capture layers that CONSUME the intelligence systems in
-- migrations 11-15 — they are not scoring engines themselves. Keeping this
-- as a separate migration/layer is a deliberate architectural decision, not
-- an oversight: conflating backend intelligence with mobile/field UX was
-- flagged explicitly as a scope risk.
--
-- Hard rules for the CardSight identification pipeline (non-negotiable,
-- carried over verbatim from the architecture discussion):
--   - VaultOS owns the canonical card_id. External IDs are references only.
--   - Raw scan/import record stays immutable.
--   - Identification candidates are stored separately from confirmed identity.
--   - needs_review remains a permanent workflow state, never auto-cleared.
--   - Every identification stores provider + provider_version + timestamp + confidence.
--   - Never overwrite a confirmed identity silently when a provider disagrees later.
--   - Market price is a time-series observation, never a single current_value field.
--   - Duplicate detection runs on BOTH physical-item fingerprint AND canonical
--     card identity (owning two copies is valid; importing the same scan
--     twice is not — these are different checks).
--
-- Explicitly out of scope for this migration and this phase:
--   - Yu-Gi-Oh catalog provider
--   - SportsCardsPro provider
--   - AI/smart glasses interface (phone-first before glasses, unconditionally)
-- ============================================================================

BEGIN;

SET search_path TO vault_core, public;

-- ---------------------------------------------------------------------------
-- Field Modes — session container only
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.field_session (
    id                     UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    mode                   TEXT NOT NULL,
    started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at               TIMESTAMPTZ,
    location_context       TEXT,     -- store name, show name, freeform

    CONSTRAINT chk_field_mode CHECK (
        mode IN ('store', 'show', 'auction', 'trade')
    )
);

COMMENT ON TABLE vault_core.field_session IS
    'Container for a Store/Show/Auction/Trade session. Deliberately thin: captured items and recommendations reference this session, but no mode-specific calculation (e.g. auction max-bid, trade basket equality) lives here or ships in this phase.';

CREATE TABLE vault_core.field_captured_item (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    field_session_id    UUID NOT NULL REFERENCES vault_core.field_session(id) ON DELETE CASCADE,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- What was captured, before any identification has resolved it to an asset
    raw_scan_id         UUID,        -- FK into card_scan below, once identification exists
    asking_price         NUMERIC(12,2),

    resolved_asset_id     UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,
    recommendation_id      UUID REFERENCES vault_core.recommendation(id) ON DELETE SET NULL
);

COMMENT ON TABLE vault_core.field_captured_item IS
    'One item captured during a field session. resolved_asset_id and recommendation_id are populated once the identification pipeline and recommendation engine have run — this table does not compute either.';

-- ---------------------------------------------------------------------------
-- CardSight identification pipeline — contract tables only
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.card_scan (
    id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    image_ref          TEXT NOT NULL,     -- storage pointer, not the image itself
    physical_fingerprint TEXT,             -- perceptual hash or similar, for duplicate-scan detection specifically

    -- Immutable once written. No UPDATE should ever target this table's
    -- captured fields — corrections happen downstream in card_identification.
    source              TEXT NOT NULL DEFAULT 'field_capture'
);

COMMENT ON TABLE vault_core.card_scan IS
    'Raw scan/import record. IMMUTABLE — never update captured_at, image_ref, or physical_fingerprint after insert. physical_fingerprint drives duplicate-SCAN detection, which is a distinct check from duplicate-CARD detection (owning two copies of a card is valid and expected).';

CREATE OR REPLACE FUNCTION vault_core.card_scan_forbid_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'card_scan rows are immutable; corrections go in card_identification';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_card_scan_no_update
    BEFORE UPDATE ON vault_core.card_scan
    FOR EACH ROW
    EXECUTE FUNCTION vault_core.card_scan_forbid_mutation();

CREATE TABLE vault_core.card_identification_candidate (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    card_scan_id         UUID NOT NULL REFERENCES vault_core.card_scan(id) ON DELETE CASCADE,

    provider              TEXT NOT NULL,          -- 'cardsight','tcgdex','scryfall','mtgjson', etc.
    provider_version        TEXT NOT NULL,
    provider_timestamp        TIMESTAMPTZ NOT NULL,
    confidence                  NUMERIC(4,3) NOT NULL,

    candidate_external_id         TEXT,             -- the provider's own ID for this candidate match — reference only, never treated as canonical
    candidate_description           TEXT,

    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidate_scan       ON vault_core.card_identification_candidate(card_scan_id);
CREATE INDEX idx_candidate_provider   ON vault_core.card_identification_candidate(provider);

COMMENT ON TABLE vault_core.card_identification_candidate IS
    'Candidates from any provider, stored separately from confirmed identity per hard rule. Multiple candidates per scan, from multiple providers, is expected and fine. candidate_external_id is a reference only — VaultOS never treats it as the canonical card_id.';

CREATE TABLE vault_core.card_identification (
    id                     UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    card_scan_id           UUID NOT NULL REFERENCES vault_core.card_scan(id) ON DELETE CASCADE,
    confirmed_asset_id     UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,  -- NULL while needs_review

    chosen_candidate_id    UUID REFERENCES vault_core.card_identification_candidate(id) ON DELETE SET NULL,
    confirmed_by           TEXT,               -- 'auto' or a user identifier — auto-confirm should be rare and monitored, see acceptance criteria in plan
    confirmed_at           TIMESTAMPTZ,

    needs_review           BOOLEAN NOT NULL DEFAULT TRUE,

    superseded_by          UUID REFERENCES vault_core.card_identification(id) ON DELETE SET NULL,
    -- A confirmed identity is NEVER silently overwritten. If a provider later
    -- disagrees, a NEW row is inserted and linked via superseded_by on the
    -- old row — the old row is untouched. superseded_by is the only field on
    -- an old row that should ever be written after the fact.

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_identification_scan        ON vault_core.card_identification(card_scan_id);
CREATE INDEX idx_identification_needs_review ON vault_core.card_identification(needs_review) WHERE needs_review;

COMMENT ON TABLE vault_core.card_identification IS
    'The confirmed (or pending) identity for a scan. needs_review defaults TRUE and is a permanent, legitimate workflow state — never auto-cleared by a background job. A confirmed identity is never overwritten in place; disagreement produces a new row referenced via the OLD row''s superseded_by.';

CREATE OR REPLACE FUNCTION vault_core.card_identification_protect_confirmed()
RETURNS trigger AS $$
BEGIN
    IF OLD.confirmed_asset_id IS NOT NULL
       AND (
            NEW.confirmed_asset_id IS DISTINCT FROM OLD.confirmed_asset_id
         OR NEW.chosen_candidate_id IS DISTINCT FROM OLD.chosen_candidate_id
         OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
         OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
         OR NEW.needs_review IS DISTINCT FROM OLD.needs_review
         OR NEW.card_scan_id IS DISTINCT FROM OLD.card_scan_id
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
       )
    THEN
        RAISE EXCEPTION 'confirmed identity is never overwritten in place; insert a new row and set superseded_by on the old row';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_card_identification_protect_confirmed
    BEFORE UPDATE ON vault_core.card_identification
    FOR EACH ROW
    EXECUTE FUNCTION vault_core.card_identification_protect_confirmed();

-- ---------------------------------------------------------------------------
-- Market price as time series (not a single current_value field), per hard rule
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.market_price_observation (
    id             UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id       UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    observed_at    TIMESTAMPTZ NOT NULL,
    price          NUMERIC(12,2) NOT NULL,
    price_type     TEXT NOT NULL,       -- 'active_listing','sold_comp','pop_adjusted', etc.
    provider       TEXT NOT NULL
);

CREATE INDEX idx_price_obs_asset  ON vault_core.market_price_observation(asset_id, observed_at DESC);

COMMENT ON TABLE vault_core.market_price_observation IS
    'Every market price is an observation with a timestamp and provider, never collapsed into a single current_value field on the asset. This table should be the target for the existing eBay Browse adapter output once wired in, and for the eventual paid sold-comps provider.';

-- ---------------------------------------------------------------------------
-- Golden test deck for identification accuracy — required before any
-- pipeline change is considered validated, per acceptance criteria
-- ---------------------------------------------------------------------------

CREATE TABLE vault_core.identification_golden_case (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    card_scan_id           UUID NOT NULL REFERENCES vault_core.card_scan(id) ON DELETE CASCADE,
    known_correct_asset_id  UUID NOT NULL REFERENCES vault_core.asset(id) ON DELETE CASCADE,
    category                  TEXT,     -- 'base','insert','numbered_parallel','visually_similar_parallel','auto','relic','pokemon_sir','vintage','duplicate','bad_scan'
    added_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_core.identification_golden_case IS
    'Fixed golden test set (target 100-250 cards) with known-correct answers. Every identification pipeline change should be evaluated against this table before being considered validated. False-auto-confirm rate against this set is the primary tracked metric — routing to needs_review is strongly preferred over a confident wrong identity.';

COMMIT;
