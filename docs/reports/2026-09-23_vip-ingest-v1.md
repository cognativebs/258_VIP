# vip-ingest-v1 report

Date: 2026-09-23
Branch: `cursor/vip-ingest-v1`
ADR: `docs/adr/0015-ingest-flow.md`

## What the stale batch was

It was a real Ricoh intake, not a fixture.

- Id `ed919c12-4634-439f-b7b6-28d98fa328f3`
- Device `ricoh_fi8170`, identification status `review`, created 2026-09-07
- 25 `scan_unit` rows, each with a front path under `D:\VIP\scans\fi8170\Test Scans 25 Pokemon\` and a `raw_snapshot_id`
- The folder name says “Test”. The rows are linked scans. They were not deleted.

G-1, as decided: that batch’s lifecycle is `abandoned`. Identification `status` is still `review`. The other `open` / `review` batches are `paused`. `closed` batches are `committed`. Nothing was removed.

## Gates that were decided

- Destination is the three holding buckets. Binder and hunt are optional sub-targets on Personal Collection only. No dealer lot sub-target.
- GTIN map is `vault_catalog.gtin_map` (`gtin14 varchar(14)`, nullable `asset_id`). No `priced_unit` foreign key, even though the plan text mentioned that table. ADR 0012 still applies: `priced_unit` stays empty.
- Legacy lifecycle is a new column. Ricoh `status` was not rewritten.

## What this pass does not do

- Image methods queue file names and say identification is not connected. CardSight is not wired.
- API import is disabled. Creating a batch with that method returns 409, “No sources connected”.
- A typed product name without a catalog asset id stays `needs_review`. Confirming an asset id is the only way this pass clears that flag.
- Dealer commit records cost basis. It does not compute margin or listing readiness.
- Thin comps are flagged only when `gtin_map.release_on` is within 90 days. No date means the flag stays off.
- Automated GTIN web lookup, offline sync, and mobile capture stay parked.

## Verification batch left active

Browser verification created one live batch and did not abandon it:

- Id `7f056422-6b28-468c-ad36-8ca2d177babc`
- Personal Collection, scanner (live), lifecycle `active`
- One row, GTIN `00036000291452`, quantity 2, method `scanner_hid`, evidence `device_capture`, product label “Example product”, `needs_review` still true because no asset id was confirmed
- A bad check digit (`036000291453`) was rejected and was not stored

Abandon it from the batch panel if it should not stay the active Personal Collection batch. Abandon keeps the row.

## What I would have done differently, and did not

- Treated the “Test Scans” folder as seed data and deleted the 25 units. The snapshots are real, so the batch was abandoned instead.
- Reused `scan_batch.status` for the new lifecycle. That would have wiped the Ricoh identification state, so lifecycle is a separate column.
- Pointed the GTIN map at `priced_unit` because the plan named it. The map points at `asset`.
- Invented a catalog match or a dealer margin so commit could look finished. Both stay blocked until the missing fact exists.
