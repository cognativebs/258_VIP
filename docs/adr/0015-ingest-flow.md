# ADR 0015 — Ingest flow

Status: accepted (2026-09-23)
Extends: ADR 0012 (market writes join on asset, not priced_unit), ADR 0014 (shell)
Supersedes: none

## Context

INGEST was a decorative stage strip over the Ricoh scan queue. The queue’s `status` (`open` | `review` | `closed`) is an identification state. Reusing it for “this batch is the one being filled” made a 25-unit Ricoh batch look like the active intake, and there was no place to record destination, method, or evidence class.

A UPC identifies a product. Condition, grade, printing, and variant are separate facts. `vault_market.priced_unit` is empty until TCG D1/D2 and is not a join target (ADR 0012).

## Decision

1. Intake lifecycle is a new column on `vault_media.scan_batch`: `draft`, `active`, `paused`, `abandoned`, `committed`. Ricoh `status` stays. Abandoned and committed do not delete scan units or raw snapshots. Abandoned can return to active. Committed is terminal. At most one non-fixture batch per destination is active. A batch with no activity for 30 days is marked stale in the UI and is not auto-abandoned.
2. Destination is one of the holding buckets: `personal_collection`, `investment_vault`, `dealer_inventory`. Binder and hunt are optional sub-targets of Personal Collection. There is no dealer-lot sub-target in this pass. Destination is chosen before method and does not change for the life of the batch.
3. Method is a registry. Each produced `vault_media.ingest_row` stores `ingest_method` and `evidence_class`. Legacy Ricoh batches have both null and the UI says the method was not recorded. `api_import` stays disabled until a source is connected. Image methods queue filenames; identification is not claimed.
4. GTIN values are stored as `varchar(14)` on `vault_catalog.gtin_map`, checksum-checked and zero-padded on entry. The map points at `vault_core.asset`. It does not reference `priced_unit`. `needs_review` on the map clears only when a person confirms an asset id. A typed product name without an asset id stays in review.
5. Commit is per destination. Personal collection needs a confirmed asset. Dealer inventory needs cost basis and quantity; margin and listing readiness are not computed. Investment needs cost basis and an acquisition date. A binder sub-target needs an empty slot in that binder. A hunt sub-target updates the matching hunt item to owned and does not increment a slot that is already owned. A full commit writes nothing while any row is blocked. A partial commit writes the ready rows and leaves the rest.
6. Fixture batches render only when `VIP_INGEST_FIXTURES=1`.

## Amendment (2026-09-23) — scan events

A GTIN capture appends a row. A repeat of the same code appends another row; quantity is the sum of events that are not voided. Undo last sets `voided` and leaves the row. The detail panel shows the selected event, defaulting to the newest, and that selection does not take focus from the capture field. Session count is this sitting. Batch total is every non-voided row in the batch. The log virtualizes after 200 rows.

## Consequences

- New Ricoh persists land as `lifecycle = paused`, so a scanner import does not become the active ingest batch.
- Home reads `/api/ingest/workspace` and names only a batch whose lifecycle is `active`.
- CSV presets (CLZ, Collectr) are rows, not code branches. Dedup is a preview against `holding.source_row_id`.
- Automated GTIN lookup, CardSight identification, offline sync, and mobile capture stay parked.

## Alternatives rejected

- Fold lifecycle into `scan_batch.status`. That would erase identification state on the existing Ricoh rows.
- Store the GTIN on `priced_unit`. That table is empty and the pair rule is not in force for this write.
- Delete the 25-unit batch because the folder name contains “Test”. The units have raw snapshots. Closing it is a status change.
