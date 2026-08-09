-- ============================================================================
-- Binder → VIP write path: durable watchlist (wishlist) rows.
-- Owned Binder slots upsert into vault_collection.holding with source='binder_vault'.
-- Wishlisted slots upsert here so Watch is not "first N holdings".
-- ============================================================================

CREATE TABLE IF NOT EXISTS vault_collection.watchlist_item (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    asset_id        UUID REFERENCES vault_core.asset(id) ON DELETE SET NULL,
    -- Binder slot that produced this row (nullable for non-Binder sources later)
    binder_slot_id  TEXT,
    source          TEXT NOT NULL,                 -- adapter id: binder_vault, …
    source_row_id   TEXT NOT NULL,                -- slot id / external key
    asset_name      TEXT NOT NULL,
    note            TEXT,
    external_source TEXT,                         -- pokemontcg / tcgdex / …
    external_value  TEXT,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Provenance of the watchlist entry itself
    prov_source     TEXT NOT NULL,
    prov_method     TEXT NOT NULL DEFAULT 'observed',
    prov_rule_version TEXT NOT NULL,
    prov_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.700
                    CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification TEXT NOT NULL DEFAULT 'unverified',
    UNIQUE (source, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_added
  ON vault_collection.watchlist_item (added_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_external
  ON vault_collection.watchlist_item (external_source, external_value)
  WHERE external_value IS NOT NULL;

COMMENT ON TABLE vault_collection.watchlist_item IS
  'Durable watch/wishlist rows. Binder wishlist writes source=binder_vault.';
