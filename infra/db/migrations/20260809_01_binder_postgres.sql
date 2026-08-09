-- ============================================================================
-- ADR 0007 — Binder Vault layout tables in Postgres
-- Schema: vault_tcg
-- Replaces the Binder SQLite file as the durable TCG layout + owned-flag truth.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vault_tcg;

CREATE TABLE IF NOT EXISTS vault_tcg.binder (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    spine_color     TEXT NOT NULL DEFAULT '#7a2331',
    rows            INTEGER NOT NULL DEFAULT 3,
    cols            INTEGER NOT NULL DEFAULT 3,
    template        TEXT,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_tcg.binder_page (
    id              TEXT PRIMARY KEY,
    binder_id       TEXT NOT NULL REFERENCES vault_tcg.binder(id) ON DELETE CASCADE,
    page_index      INTEGER NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    subtitle        TEXT NOT NULL DEFAULT '',
    tone            TEXT NOT NULL DEFAULT '#7a2331',
    created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS page_binder_idx ON vault_tcg.binder_page (binder_id);

CREATE TABLE IF NOT EXISTS vault_tcg.binder_slot (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES vault_tcg.binder_page(id) ON DELETE CASCADE,
    slot_index      INTEGER NOT NULL,
    role_label      TEXT NOT NULL DEFAULT '',
    is_center       BOOLEAN NOT NULL DEFAULT FALSE,

    source          TEXT,
    external_id     TEXT,
    card_name       TEXT,
    set_name        TEXT,
    number          TEXT,
    rarity          TEXT,
    image_url       TEXT,
    image_local     TEXT,
    price_market    DOUBLE PRECISION,
    price_currency  TEXT,
    price_updated_at BIGINT,

    provenance_method       TEXT,
    provenance_source       TEXT,
    provenance_model_version TEXT,
    confidence              DOUBLE PRECISION,
    verification_status     TEXT,

    added_at        BIGINT,
    on_wishlist     BOOLEAN NOT NULL DEFAULT FALSE,
    owned           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS slot_page_idx ON vault_tcg.binder_slot (page_id);
CREATE INDEX IF NOT EXISTS slot_external_idx
  ON vault_tcg.binder_slot (source, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON SCHEMA vault_tcg IS
  'Binder Vault layout + owned/wishlist flags. VIP inventory projects filled slots from here.';

-- Price history for secondary-market flux (backlog E).
CREATE TABLE IF NOT EXISTS vault_tcg.price_snapshot (
    id              BIGSERIAL PRIMARY KEY,
    slot_id         TEXT NOT NULL REFERENCES vault_tcg.binder_slot(id) ON DELETE CASCADE,
    price_market    DOUBLE PRECISION NOT NULL,
    price_currency  TEXT NOT NULL DEFAULT 'USD',
    observed_at     BIGINT NOT NULL,
    source          TEXT NOT NULL,
    rule_version    TEXT NOT NULL,
    UNIQUE (slot_id, observed_at, source)
);

CREATE INDEX IF NOT EXISTS price_snapshot_slot_idx
  ON vault_tcg.price_snapshot (slot_id, observed_at DESC);
