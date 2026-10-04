-- PokéBeach connector step 5: Pokémon entity extraction (2026-10-03, Greg's build spec).
-- 1. vault_signals.source_item_entity: sets, cards, products and Pokémon mentioned by a source item.
--    entity_ref is a TEXT placeholder ('pokemon:dex:151', 'binder_set:<key>', 'product:etb') or NULL
--    when nothing in IQVault matched; a new spelling never mints a new identity. Not a foreign key,
--    not a priced_unit join, not a UnitRef (HS-1).
-- 2. vault_signals.source_item_extraction: one row per (item, content version, extractor version),
--    so an item is extracted once per revision, including when it mentions nothing.
-- Generic: any source's items can carry entities. Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

CREATE TABLE IF NOT EXISTS vault_signals.source_item_extraction (
    source_item_id     UUID NOT NULL REFERENCES vault_signals.source_item (id) ON DELETE RESTRICT,
    content_hash       TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    extractor_version  TEXT NOT NULL,
    extracted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    entity_count       INTEGER NOT NULL CHECK (entity_count >= 0),
    PRIMARY KEY (source_item_id, content_hash, extractor_version)
);

COMMENT ON TABLE vault_signals.source_item_extraction IS
  'Marks that an item''s content version was read by an extractor version, even when it yielded no entities. A revised item (new content_hash) or a new extractor version is read again; older rows stay for provenance.';

CREATE TABLE IF NOT EXISTS vault_signals.source_item_entity (
    id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_item_id     UUID NOT NULL REFERENCES vault_signals.source_item (id) ON DELETE RESTRICT,
    content_hash       TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    extractor_version  TEXT NOT NULL,
    entity_kind        TEXT NOT NULL CHECK (entity_kind IN ('set', 'card', 'product', 'pokemon')),
    mention            TEXT NOT NULL CHECK (char_length(mention) BETWEEN 1 AND 200),
    normalized_key     TEXT NOT NULL CHECK (normalized_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    entity_ref         TEXT CHECK (entity_ref IS NULL OR char_length(entity_ref) BETWEEN 1 AND 300),
    match_method       TEXT NOT NULL CHECK (match_method IN (
                         'species_catalog', 'set_catalog', 'quoted_set_name', 'learned_set_name', 'card_pattern', 'product_pattern'
                       )),
    confidence         NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    prov_verification  vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_item_entity_once UNIQUE (source_item_id, content_hash, extractor_version, entity_kind, normalized_key),
    CONSTRAINT source_item_entity_extracted FOREIGN KEY (source_item_id, content_hash, extractor_version)
      REFERENCES vault_signals.source_item_extraction (source_item_id, content_hash, extractor_version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS source_item_entity_key_idx
  ON vault_signals.source_item_entity (entity_kind, normalized_key);
CREATE INDEX IF NOT EXISTS source_item_entity_ref_idx
  ON vault_signals.source_item_entity (entity_ref) WHERE entity_ref IS NOT NULL;

COMMENT ON TABLE vault_signals.source_item_entity IS
  'Entity mentions extracted from a source item version. entity_ref is a text placeholder into IQVault catalogs (or NULL when unmatched); confidence is the extraction''s, inferred · unverified. The basis for clustering (step 6), not a score.';

COMMIT;
