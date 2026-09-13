# ADR 0011 — PriceCharting wiring on live VIP schema

Status: accepted (2026-09-13)
Extends: ADR 0010 (identity vs valuation vs listing), plans
[0004](../plans/0004-pricecharting-core-wiring.md) (`PC-CORE-01`) and
[0005](../plans/0005-pricecharting-digital-tools.md) (`PC-TOOLS-01`)
Owner: Gregory Williamson — Cursor pick, owner-delegated 2026-09-13

## Context

`PC-CORE-01` and `PC-TOOLS-01` were written against a local IQVault clone that
assumed migrations `11`–`24` already green, including a bigint TCG
`priced_unit`, a `condition_key` reference table, and `price_series()`.

This repo is not that database. TCG plan v2
(`docs/proposals/2026-08-19_vault_tcg_schema_plan_v2.md`) still has open §2
decisions; AGENTS.md forbids writing that migration until those answers exist.
Comics comps already persist to `vault_market.listing_observation`. Live
`vault_market.priced_unit` is a UUID. Unused `vault_core.market_price_observation`
keys on `asset_id` and has no `condition_key`.

The owner asked Cursor to **make the picks** so Phase A can start.

## Decision

### 1. Migration filenames stay date-prefix

Plan numbers `25`–`30` and `31`–`34` are **logical phase ids only**.

Every SQL file remains `infra/db/migrations/YYYYMMDD_NN_description.sql`.
A file named `25_*.sql` would apply before the 2026 spine
(`scripts/migrate_db.py` is filename order, no ledger).

| Plan id | Phase | Live file (this pass / reserved) |
|---|---|---|
| 25 | Core A — registry + vendor map | `20260913_02_pricecharting_source_registry.sql` |
| 26 | Core B — snapshots | next unused `YYYYMMDD_NN_` when B starts |
| 27 | Core C — derived series | same rule |
| 28–30 | Core D–F | same rule |
| 31–34 | Tools 1–5 | same rule; **not this PR** |

### 2. Join key is live `vault_market.priced_unit` (UUID)

Do **not** wait for TCG §2. Do **not** create a second `priced_unit`.
Do **not** invent `price_series()` until Phase B/C, and then only over a
**new** guide time-series table — never by altering
`vault_core.market_price_observation` or backfilling it as `ebay_browse`
(that table is unused; the plan's own hard stop forbids guessing sources).

`vendor_product_map.priced_unit_id` is `UUID REFERENCES vault_market.priced_unit(id)`,
nullable. Comics inventory today is holdings → `vault_core.asset`; most assets
have **no** `priced_unit` row yet. `asset_id` is therefore also stored so the
join seam is usable before RAW `priced_unit` rows exist. Creating those rows
is a later job, not a silent fill-in of grade.

`listing_observation` stays the **display / comps-walk** path (eBay asks and
the PR #89 loose guide quote). Nightly PriceCharting snapshots do **not**
accumulate there.

### 3. Token name

Canonical env: `PRICECHARTING_API_TOKEN` (already shipped on the comics
`CompsAdapter`).

Alias: `PRICECHARTING_TOKEN` (plan name). Read API token first, then alias.
Do not require the operator to rename a working `.env`.

### 4. Language

VIP API + matcher stay **TypeScript + zod** (stack default; change only via
ADR). `PC-CORE-01`'s Python tree under `services/api/app/adapters/` is not
created. Digital Tools `services/edge/` stays Python/FastAPI when Core A–C is
green — that is a new service, not a fork of VIP backend logic.

### 5. Digital Tools stays parked

`PC-TOOLS-01` does not start until Core A–C is green **on this schema**.
`redistribution_allowed` for `pricecharting` is `false`. Flip it only in a
commit that attaches a written vendor reply under `docs/vendor/`.

### 6. Evidence class and confidence ceiling

Seed `vault_core.evidence_class` as specified. PriceCharting rows are
`vendor_derived` with ceiling `0.75`. That ceiling is load-bearing for
Phase F; do not raise it in application code.

## Consequences

- Phase A can land without answering TCG §2.
- Phase B must add a dedicated guide observation table (name TBD at B start)
  keyed by `(priced_unit_id, condition_key)` — pair never split; `'any'` when
  grade is unknown. No column on `asset` for "current PriceCharting value".
- Phase E talks to `vault_core.prediction` (live name), not a table called
  `prediction_ledger`.
- ADR 0010 still parks PriceCharting as a **catalog identity** source.
  This ADR is **valuation / source registry / nightly guide snapshots** only.

## Alternatives rejected

- **Wait for TCG `17`–`24`.** Blocks the snapshot moat on unanswered catalog
  decisions. The Legendary feed is useful for comics/sports now.
- **Reuse `listing_observation` as the history spine.** Wrong grain (asks /
  one loose quote per walk), and it would mix marketplace asks with vendor
  estimates.
- **ALTER `vault_core.market_price_observation` + Browse backfill.** Unused
  table, no `condition_key`, would invent a source. Plan hard stop.
- **Rename the shipped token.** Breaks any `.env` already set for PR #89.
