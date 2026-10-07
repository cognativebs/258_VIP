-- Ingest flow (vip-ingest-v1).
-- Lifecycle is separate from Ricoh identification status (open/review/closed).
-- Raw scans and scan units are never deleted here. Abandoned keeps every row.
-- GTIN map lives in the catalog schema and points at asset, not priced_unit.

BEGIN;

SET search_path TO vault_media, vault_catalog, vault_core, public;

CREATE SCHEMA IF NOT EXISTS vault_catalog;

ALTER TABLE vault_media.scan_batch
    ADD COLUMN IF NOT EXISTS lifecycle TEXT,
    ADD COLUMN IF NOT EXISTS destination TEXT,
    ADD COLUMN IF NOT EXISTS subtarget_kind TEXT,
    ADD COLUMN IF NOT EXISTS subtarget_id TEXT,
    ADD COLUMN IF NOT EXISTS ingest_method TEXT,
    ADD COLUMN IF NOT EXISTS evidence_class TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_fixture BOOLEAN NOT NULL DEFAULT FALSE;

-- One-time backfill. Re-runs do not overwrite a lifecycle that was already set.
UPDATE vault_media.scan_batch
SET lifecycle = 'abandoned',
    last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE id = 'ed919c12-4634-439f-b7b6-28d98fa328f3'
  AND lifecycle IS NULL;

UPDATE vault_media.scan_batch
SET lifecycle = 'paused',
    last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE status IN ('open', 'review')
  AND lifecycle IS NULL;

UPDATE vault_media.scan_batch
SET lifecycle = 'committed',
    last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE status = 'closed'
  AND lifecycle IS NULL;

UPDATE vault_media.scan_batch
SET lifecycle = 'paused',
    last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE lifecycle IS NULL;

ALTER TABLE vault_media.scan_batch
    ALTER COLUMN lifecycle SET DEFAULT 'paused';

ALTER TABLE vault_media.scan_batch
    ALTER COLUMN lifecycle SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE vault_media.scan_batch
        ADD CONSTRAINT scan_batch_lifecycle_chk
        CHECK (lifecycle IN ('draft', 'active', 'paused', 'abandoned', 'committed'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_media.scan_batch
        ADD CONSTRAINT scan_batch_destination_chk
        CHECK (
            destination IS NULL
            OR destination IN ('personal_collection', 'investment_vault', 'dealer_inventory')
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE vault_media.scan_batch
        ADD CONSTRAINT scan_batch_subtarget_chk
        CHECK (
            subtarget_kind IS NULL
            OR (
                destination = 'personal_collection'
                AND subtarget_kind IN ('binder', 'hunt')
            )
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scan_batch_one_active_destination
    ON vault_media.scan_batch (destination)
    WHERE lifecycle = 'active' AND destination IS NOT NULL;

COMMENT ON COLUMN vault_media.scan_batch.lifecycle IS
    'Ingest decision state. Identification status stays on status. Abandoned and committed keep every scan unit.';
COMMENT ON COLUMN vault_media.scan_batch.is_fixture IS
    'Fixture rows are hidden unless VIP_INGEST_FIXTURES=1.';
COMMENT ON COLUMN vault_media.scan_batch.ingest_method IS
    'Method chosen when the batch was created. Null on legacy Ricoh rows means not recorded. Never inferred at read time.';

CREATE TABLE IF NOT EXISTS vault_media.ingest_row (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    batch_id            UUID NOT NULL REFERENCES vault_media.scan_batch(id) ON DELETE RESTRICT,
    ingest_method       TEXT NOT NULL,
    evidence_class      TEXT NOT NULL,
    raw_code            TEXT,
    gtin14              VARCHAR(14),
    quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    product_label       TEXT,
    asset_id            UUID REFERENCES vault_core.asset(id),
    cost_basis          NUMERIC(12, 2),
    acquired_on         DATE,
    assumed_grade       TEXT,
    slot_id             TEXT,
    needs_review        BOOLEAN NOT NULL DEFAULT TRUE,
    review_reason       TEXT,
    committed_at        TIMESTAMPTZ,
    holding_id          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_row_batch
    ON vault_media.ingest_row (batch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ingest_row_gtin
    ON vault_media.ingest_row (batch_id, gtin14)
    WHERE gtin14 IS NOT NULL;

COMMENT ON TABLE vault_media.ingest_row IS
    'One captured ingest line. ingest_method and evidence_class are stored on the row. Raw code is immutable. Rows are never deleted by ingest.';

CREATE TABLE IF NOT EXISTS vault_catalog.gtin_map (
    gtin14          VARCHAR(14) PRIMARY KEY,
    asset_id        UUID REFERENCES vault_core.asset(id),
    product_label   TEXT,
    confirmed_by    TEXT,
    confirmed_at    TIMESTAMPTZ,
    source_url      TEXT,
    source_tier     TEXT,
    release_on      DATE,
    needs_review    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gtin_map_gtin14_digits_chk CHECK (gtin14 ~ '^[0-9]{14}$')
);

COMMENT ON TABLE vault_catalog.gtin_map IS
    'GTIN-14 to catalog asset. varchar, never numeric. asset_id is the product. Not priced_unit. needs_review is cleared only by an explicit confirm.';

CREATE TABLE IF NOT EXISTS vault_media.ingest_csv_preset (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    column_map      JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_media.ingest_csv_preset IS
    'Saved CSV column maps. A preset is data.';

INSERT INTO vault_media.ingest_csv_preset (id, label, column_map)
VALUES
    (
        'clz',
        'CLZ',
        '{
            "name": "Series",
            "issue": "Issue Full",
            "quantity": "Quantity",
            "barcode": "Barcode",
            "cost": "Purchase Price",
            "acquired_on": "Purchase Date",
            "external_id": "CLZ Hash",
            "condition": "Assumed Grade"
        }'::jsonb
    ),
    (
        'collectr',
        'Collectr',
        '{
            "name": "Product Name",
            "set_name": "Set",
            "number": "Card Number",
            "quantity": "Quantity",
            "cost": "Average Cost Paid",
            "condition": "Card Condition"
        }'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
