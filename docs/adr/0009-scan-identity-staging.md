# ADR 0009 — Uncertain identification never contaminates canonical inventory

Status: accepted (2026-08-10)
Supersedes: none. Extends ADR 0008 (Ricoh scan ingest).

## Context

ADR 0008 shipped the intake path: scan → identify → duplicate alert → confirm.
Identification is the weakest link. It currently scores OCR/filename text
against a five-card fixture catalog, so most real scans return either no
candidate or a low-confidence guess.

Everything valuable downstream — pricing, grading recommendations, placement,
duplicate management, listing generation — hangs off a canonical card identity.
If a wrong or unverified identity reaches `vault_core.asset` /
`vault_collection.holding`, every downstream artifact inherits the error and
cleanup means unpicking rows that other features already reference.

Two facts about the code as merged (verified 2026-08-09):

1. Nothing in the scan path writes to Postgres. `ScanSessionStore` is a
   process-local `Map`; `confirmScanUnit` returns an `InventoryCommit`
   descriptor with freshly generated UUIDs that is never persisted. Batches are
   lost on API restart.
2. `vault_media.scan_batch` / `scan_unit` exist in migration
   `20260809_03_capture_session.sql` but are never written, and there is no
   table for identity candidates at all — `scan_unit.selected_candidate_key` is
   a single text column.

So there is no contamination today, because there is no persistence at all.
That makes this the cheapest possible moment to fix the boundary: we are
writing the persistence layer for the first time, not migrating dirty rows.

## Decision

**Staging and canonical inventory are separate stores, and identity crosses the
boundary exactly once — at confirmation.**

Three layers, in order:

| Layer | Tables | Mutability | Holds |
|---|---|---|---|
| Capture | `vault_media.capture_session`, `capture_image`, `vault_evidence.raw_snapshots` | immutable | the scan itself (rule 3) |
| Staging | `vault_media.scan_batch`, `scan_unit`, `scan_unit_candidate` | mutable | candidate identities, confidence, duplicate alerts |
| Canonical | `vault_core.asset`, `external_id`, `vault_collection.holding` | append/update | confirmed identity only |

Rules:

1. **Candidates are rows, not a column.** Every identity hypothesis is a
   `scan_unit_candidate` row carrying its own confidence, match reasons, source
   adapter, and provenance. Multiple candidates coexist; none is privileged
   until resolution.
2. **No canonical write before resolution.** A `scan_unit` may reference an
   existing `asset_id` as a *hypothesis* (`scan_unit_candidate.asset_id`), but
   nothing is inserted into `asset` / `holding` until the unit resolves.
3. **Resolution is explicit and attributed.** `scan_unit.resolution_mode` is
   one of `operator_confirmed`, `auto_high_confidence`, or `rejected`. Both
   accepting modes are recorded with the rule version that produced them, so an
   auto-resolution can be audited and reversed as a class.
4. **Auto-resolution is opt-in and narrow.** Off by default. When enabled it
   requires all of: confidence ≥ threshold, a clear margin over the runner-up,
   an external-id-grade match reason, and no duplicate alert. Anything else
   goes to human review. See `confidence-policy.ts`.
5. **Rejection is preserved.** Rejected units keep their candidates so a later
   catalog improvement can be re-run against the same capture rather than
   requiring a re-scan.
6. **Confirmation is one transaction.** Asset resolve-or-create, external id
   linkage, holding insert, and the staging status update commit together, keyed
   on `scan_unit.id`, so a retry cannot produce a second holding.

Condition is unaffected by any of this: intake never inspects a card
physically, so a confirmed holding still carries **`NM assumed · unverified`**
(rule 2, rule 4).

## Consequences

- Improving the catalog adapter is now safe: re-identify staged units without
  touching inventory.
- The batch review UX has a durable queue that survives restarts, which the
  in-memory store could not offer.
- Cost: one extra table plus a join to read a unit with its candidates. Worth
  it — the alternative is a `holding` table with unverified guesses in it.
- Auto-resolution stays a policy object rather than scattered thresholds, so
  tightening it later is a single change with tests.

## Alternatives rejected

- **Write the best candidate immediately, correct later.** This is exactly the
  cleanup problem the ADR exists to prevent; a wrong `asset_id` propagates into
  comps, recommendations, and listing drafts before anyone notices.
- **Keep candidates as JSON on `scan_unit`.** Cheaper to write, but confidence
  and provenance stop being queryable, so "show me every auto-resolved unit
  below 0.9" becomes a scan of blobs.
- **Trust a single high-confidence match with no margin check.** A five-card
  fixture catalog returns 0.975 for a filename match; confidence alone says
  nothing about whether a *better* answer exists outside the catalog.
