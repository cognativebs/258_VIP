# ADR 0012 — PriceCharting and comics market writes join on `asset_id`

Status: accepted (2026-09-20)
Extends: ADR 0010 (valuation seam, not identity)
Supersedes: none. Does not close TCG plan v2 §2 (D1–D2 remain open).

## Context

`vault_market.priced_unit` is `(asset_id, grade_scale_id)` — grade as identity.
It has 0 rows. `grade_scale` is unseeded. AGENTS.md says
`(priced_unit_id, condition_key)` is a pair that is never split. The TCG v2
plan (B4/B8/C15) keeps that pair and treats condition as a dimension.

PriceCharting products are grade-agnostic: one vendor id, many price columns.
Mapping them onto `priced_unit` would invent a grade. Comics already price on
`asset_id` (`listing_observation`, and 2,700 `guide_price_observation` rows
with `priced_unit_id` NULL).

TCG D1/D2 are still unanswered. Reshaping `priced_unit` now would pick
comics-asset grain before `card_variant` exists.

## Decision

**Path B.**

1. PriceCharting and current comics market writes join on `vault_core.asset.id`.
   `condition_key` lives on the observation. NULL never means “any”.
2. `vault_market.priced_unit` stays empty and **untouched** until TCG D1/D2.
3. The AGENTS.md pair rule applies to **observations and a future UnitRef**,
   not to today’s `priced_unit` row.
4. Evidence homes (do not cross-write):
   - `listing_observation` — marketplace asks (eBay Browse).
   - `guide_price_observation` — vendor guide (PriceCharting). Adopted.
   - `vault_market.sale` — sold comps (future; still empty).
5. `vault_core.market_price_observation` is **deprecated**. No new writers.
   It has no `condition_key` and no readers.
6. A PriceCharting value is `vendor_derived`. Recommendation confidence
   cannot exceed 0.75 when that is the weakest class. `redistribution_allowed`
   stays false.
7. Rows written by `pricecharting-guide-snapshot@0.1.0` (2026-09-13–16) are
   ingest batch `pre_adapter_20260913`: unverified, `baseline_eligible = false`.
   Emitters and the baseline series must exclude them. Raw JSON payloads exist
   in `vault_evidence.raw_snapshots` (source `pricecharting`).

## Consequences

- Phase B nightly CSV snapshots write new `guide_price_observation` rows
  (`baseline_eligible = true`) with one row per mapped condition column.
- Intelligence Phase 2 scoring stays off until an operator confirms
  `signals_raw` / `signals_normalized` are live.
- Unifying comics `asset` and TCG `card_variant` under one `priced_unit`
  is a later ADR after D1/D2.

## Alternatives rejected

- Reshape `priced_unit` to condition-free identity now — cheap (0 rows) but
  answers D2 without answering D1, and locks comics-asset as the spine.
- Keep writing PriceCharting into `listing_observation` — conflates asks
  with vendor estimates.
