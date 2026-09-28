-- HUNT lifecycle, definitions and multi-item sets (2026-09-27, Greg).
-- 1. hunt_item.status widens to TARGET → WATCHING → BUY → ORDERED → OWNED plus PASS.
--    The CHECK is dropped and re-added with a superset of values (operator-approved);
--    owned/wanted/missing stay valid, so no existing row can fail it.
-- 2. hunt_item.owned_quantity and hunt_item.item_key (a hunt definition's stable key,
--    so a definition reloads without duplicating items).
-- 3. hunt_set + hunt_set_member: multi-item goals (connecting covers, trios). Progress,
--    cost and missing pieces are computed at read time. No market value is stored.
-- Re-runnable. No vault_market writes.

BEGIN;

SET search_path TO vault_hunt, vault_core, public;

ALTER TABLE vault_hunt.hunt_item DROP CONSTRAINT IF EXISTS hunt_item_status_check;
ALTER TABLE vault_hunt.hunt_item
  ADD CONSTRAINT hunt_item_status_check CHECK (
    status IN ('target', 'watching', 'buy', 'ordered', 'owned', 'pass', 'wanted', 'missing')
  );

COMMENT ON COLUMN vault_hunt.hunt_item.status IS
  'TARGET → WATCHING → BUY → ORDERED → OWNED, plus PASS (evaluated and deliberately excluded). owned/wanted/missing remain for older hunts.';

ALTER TABLE vault_hunt.hunt_item
  ADD COLUMN IF NOT EXISTS owned_quantity SMALLINT NOT NULL DEFAULT 0
    CHECK (owned_quantity >= 0);

ALTER TABLE vault_hunt.hunt_item
  ADD COLUMN IF NOT EXISTS item_key TEXT;

COMMENT ON COLUMN vault_hunt.hunt_item.item_key IS
  'Stable key from a hunt definition file. NULL for hand-made items.';

CREATE UNIQUE INDEX IF NOT EXISTS hunt_item_section_key_unique
  ON vault_hunt.hunt_item (section_id, item_key);

CREATE TABLE IF NOT EXISTS vault_hunt.hunt_set (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    hunt_id       UUID NOT NULL REFERENCES vault_hunt.collection_hunt (id) ON DELETE CASCADE,
    slug          TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'target'
                  CHECK (status IN ('target', 'watching', 'buy', 'ordered', 'owned', 'pass')),
    priority      TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    notes         TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT hunt_set_slug_unique UNIQUE (hunt_id, slug)
);

COMMENT ON TABLE vault_hunt.hunt_set IS
  'A multi-item collection goal inside a hunt (e.g. a connecting-cover trio). Set-level status is the collector''s; completion, paid cost and missing pieces are computed from members at read time. Market value is never stored here.';

CREATE TABLE IF NOT EXISTS vault_hunt.hunt_set_member (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    set_id        UUID NOT NULL REFERENCES vault_hunt.hunt_set (id) ON DELETE CASCADE,
    hunt_item_id  UUID NOT NULL REFERENCES vault_hunt.hunt_item (id) ON DELETE CASCADE,
    position      SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
    CONSTRAINT hunt_set_member_once UNIQUE (set_id, hunt_item_id)
);

COMMENT ON TABLE vault_hunt.hunt_set_member IS
  'An item''s place in a hunt_set. position orders connecting covers left to right.';

COMMIT;
