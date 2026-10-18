-- ComicBase is the comics inventory (ADR 0016 amendment 2026-10-18; operator: "rebuild the comics
-- collection with the inventory from ComicBase 2026 instead of CLZ … the CLZ inventory is out of date").
-- 1. vault_collection.comicbase_item.inventory_holding_id: the holding that stands for this ComicBase
--    item in the collection. A matched item uses the CLZ holding it matched (keeps its id, scans, comps,
--    sell-queue links); an item still in review or unmatched gets a holding of its own
--    (source 'comicbase_export'), with CLZ fields copied in as inferred · unverified.
-- 2. vault_collection.v_comics_inventory: the comics collection = the items in the latest ComicBase
--    report, one row per inventory holding, quantity from ComicBase. CLZ holdings that ComicBase does
--    not list drop out of the view; nothing is deleted and dropped_at is not touched.
-- Additive only. No vault_market. Re-runnable.

BEGIN;

SET search_path TO vault_collection, vault_evidence, public;

ALTER TABLE vault_collection.comicbase_item
  ADD COLUMN IF NOT EXISTS inventory_holding_id UUID REFERENCES vault_collection.holding (id) ON DELETE RESTRICT;

COMMENT ON COLUMN vault_collection.comicbase_item.inventory_holding_id IS
  'The holding that shows this item in the comics collection: the matched CLZ holding, or one VIP created from the ComicBase item (source comicbase_export) while it is unmatched or in review. An operator confirm repoints it at the confirmed holding; the created holding is kept, not deleted.';

CREATE INDEX IF NOT EXISTS comicbase_item_inventory_idx
  ON vault_collection.comicbase_item (inventory_holding_id) WHERE inventory_holding_id IS NOT NULL;

CREATE OR REPLACE VIEW vault_collection.v_comics_inventory AS
WITH latest AS (
    SELECT ci.last_raw_snapshot_id AS snapshot_id
      FROM vault_collection.comicbase_item ci
      JOIN vault_evidence.raw_snapshots rs ON rs.id = ci.last_raw_snapshot_id
     ORDER BY rs.ingested_at DESC
     LIMIT 1
)
SELECT ci.inventory_holding_id                      AS holding_id,
       sum(ci.quantity)::int                        AS quantity,
       array_agg(ci.item_key ORDER BY ci.item_key)  AS comicbase_item_keys,
       bool_or(ci.needs_review)                     AS needs_review,
       bool_and(ci.match_status = 'matched')        AS matched_to_clz,
       ci.last_raw_snapshot_id                      AS raw_snapshot_id
  FROM vault_collection.comicbase_item ci
  JOIN latest ON latest.snapshot_id = ci.last_raw_snapshot_id
 WHERE ci.inventory_holding_id IS NOT NULL
   AND ci.quantity > 0
 GROUP BY ci.inventory_holding_id, ci.last_raw_snapshot_id;

COMMENT ON VIEW vault_collection.v_comics_inventory IS
  'The comics collection: holdings standing for items in the latest ComicBase report, quantity from ComicBase. matched_to_clz = every item matched a CLZ holding; needs_review = at least one item still waits for an operator. CLZ holdings not listed by ComicBase are absent, never deleted.';

COMMIT;
