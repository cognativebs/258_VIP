-- ComicBase as the comics inventory source (ADR 0016; operator decisions 2026-10-04 / 2026-10-06).
-- 1. vault_collection.holding.provider_ids: provider ids for a holding (AGENTS: never a key). A matched
--    ComicBase item adds its key under "comicbase"; nothing else on the holding changes.
-- 2. vault_collection.comicbase_item: one row per ComicBase item (series + issue + variant letter) seen in a
--    ComicBase export, with its match to a holding. This table is the review list: needs_review is never
--    cleared automatically, only by an operator confirm. Unmatched items are listed, not turned into
--    holdings, while ComicBase is still partial (operator, 2026-10-06).
-- Additive only. No vault_market. Re-runnable.

BEGIN;

SET search_path TO vault_collection, vault_evidence, public;

ALTER TABLE vault_collection.holding
  ADD COLUMN IF NOT EXISTS provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN vault_collection.holding.provider_ids IS
  'Provider ids for this holding, e.g. {"comicbase": ["<item key>"]}. Never a primary or foreign key.';

CREATE TABLE IF NOT EXISTS vault_collection.comicbase_item (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    item_key              TEXT NOT NULL UNIQUE,
    series_title          TEXT NOT NULL,
    publisher             TEXT NOT NULL,
    year_label            TEXT NOT NULL,
    start_year            SMALLINT,
    issue_number          TEXT NOT NULL,
    variant_letter        TEXT,
    quantity              SMALLINT NOT NULL CHECK (quantity >= 0),
    first_raw_snapshot_id UUID NOT NULL REFERENCES vault_evidence.raw_snapshots (id),
    last_raw_snapshot_id  UUID NOT NULL REFERENCES vault_evidence.raw_snapshots (id),
    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    match_status          TEXT NOT NULL CHECK (match_status IN ('matched', 'needs_review', 'unmatched')),
    matched_holding_id    UUID REFERENCES vault_collection.holding (id) ON DELETE RESTRICT,
    candidate_holding_ids UUID[] NOT NULL DEFAULT '{}',
    match_method          TEXT NOT NULL CHECK (match_method IN ('exact_issue', 'manual', 'unmatched', 'review')),
    match_confidence      NUMERIC(4,3) NOT NULL CHECK (match_confidence >= 0 AND match_confidence <= 1),
    match_reason          TEXT NOT NULL,
    needs_review          BOOLEAN NOT NULL DEFAULT true,
    confirmed_at          TIMESTAMPTZ,
    confirmed_by          TEXT,
    prov_source           TEXT NOT NULL DEFAULT 'comicbase_export',
    prov_method           TEXT NOT NULL DEFAULT 'inferred' CHECK (prov_method IN ('observed', 'inferred', 'manual')),
    prov_rule_version     TEXT NOT NULL,
    prov_verification     TEXT NOT NULL DEFAULT 'unverified' CHECK (prov_verification IN ('unverified', 'verified')),
    CONSTRAINT comicbase_item_matched_has_holding CHECK (match_status <> 'matched' OR matched_holding_id IS NOT NULL),
    CONSTRAINT comicbase_item_confirmed_is_manual CHECK (confirmed_at IS NULL OR match_method = 'manual')
);

CREATE INDEX IF NOT EXISTS comicbase_item_review_idx
  ON vault_collection.comicbase_item (match_status) WHERE needs_review;
CREATE INDEX IF NOT EXISTS comicbase_item_holding_idx
  ON vault_collection.comicbase_item (matched_holding_id) WHERE matched_holding_id IS NOT NULL;

COMMENT ON TABLE vault_collection.comicbase_item IS
  'Items from ComicBase exports (series + issue + ComicBase variant letter) and their match to a VIP holding. The review list: needs_review clears only on an operator confirm. A confirmed match is never overwritten by a later import.';
COMMENT ON COLUMN vault_collection.comicbase_item.variant_letter IS
  'ComicBase variant letter as exported (NULL = the regular cover). Not the same scheme as CLZ cover labels, so letters are never matched blindly.';

COMMIT;
