# SIGNALS v1 spine — build report

Date: 2026-09-22
Plan: `signals/2026-09-20_signals-v1-spine.iqvplan.json`
ADR: `docs/adr/0013-signals-v1-spine.md`

## P0 findings

1. **`may_raise_valuation_ceiling` was decorative.** Nothing selected it. The only constraints were the CHECK that forces the column false, and `SignalsNewsSourceSchema`'s `z.literal(false)`. P4 now reads the column. `vault_signals.assert_not_valuation_evidence` raises when the flag is not true, and inserts into `valuation_citation` call that function.

2. **No `priced_unit` / UnitRef / `condition_key` in the signals DDL that is actually in the tree.** `20260920_06_signals_news_source.sql` and `20260917_02_signals_ingest.sql` contain none of those tokens. The handover document named in the plan is not in the repo, so it could not be grepped. HS-1 did not fire. The new tables have no `priced_unit` column and no `condition_key` column.

3. **`v_guide_price_baseline` is not empty.** Expected 0. Actual **15,042** rows. `guide_price_observation` has 18,431. HS-2 forbids a dependency on that view. The spine does not read it and does not write `vault_market`.

4. **No migration filename collision for `20260920_10`–`20260920_14`.** `main` has no `20260920_*` files. `cursor/pricecharting-core-wiring-f536` has none either (it stops at `20260914_01`). This working tree already had untracked `20260920_01` through `20260920_06`. Those do not collide with `_10`–`_14`. HS-4 did not fire.

News sources at build time: **14 rows, `adapter_enabled` 0, `is_active` 0, `may_raise_valuation_ceiling` 0.** Still true after the tests.

## What was built

Migrations, each `BEGIN`/`COMMIT`, applied on a fresh database and applied again without error:

- `20260920_10_signals_raw_evidence.sql` — `ingest_run`, `raw_document`, immutable `document_snapshot`. Payload is an object-storage key. Canonical URLs drop tracking params. Recipient addresses are rejected. Comment on `raw_document.id` is the embedding seam. No vector column.
- `20260920_11_signals_event_lineage.sql` — `event`, `event_evidence`, `origin_link`. `independent_source_count` counts distinct PRIMARY independence groups.
- `20260920_12_signals_signal_scoring.sql` — `signal_type` (9 seeds, half-lives unverified), `score_weight_set` (one unverified row), `signal` with exactly three stored scores and a generated `priority_score`, `signal_entity` (text ref), `attention_observation` (not a score input).
- `20260920_13_signals_decay_firewall.sql` — `signal_influence(signal_id, at)` at read time. Valuation firewall.
- `20260920_14_signals_predictions.sql` — `prediction` and measurement rows at +7, +30, +90, +180, +365 days.

Contracts and tests:

- Zod schemas in `packages/signals/src/schemas/spine.ts`, exported from `@vip/signals`.
- Pure helpers in `packages/signals/src/spine.ts` (no network, half-life is an argument).
- Fixture set of 14 documents in `packages/signals/src/fixtures/spine-documents.ts`.
- `packages/signals/src/spine.test.ts` — 10 tests, passing.
- `tests/test_signals_spine.py` — passing against the live database and against a fresh database.

Acceptance results that passed:

- One press release plus four derivatives → independent source count 1.
- Two independent reports plus three derivatives → count 2.
- Same source and content hash is rejected.
- Newsletter URL with `utm_*` and `recipient=reader@example.com` stores `https://example.com/brief/2026-09-20?id=42` and does not keep the address.
- `document_snapshot` update and delete raise.
- A player-injury signal at +48h returns half its priority. A license-change signal at +48h stays above 99% of its priority.
- A valuation select and a valuation insert against a news-derived signal raise.
- A prediction insert creates five measurement rows.
- No signal column named relevance, novelty, magnitude, actionability, or source_quality. `priority_score` is generated. No vector column. No enabled source.

`AGENTS.md` now lists HS-1 through HS-6. Orchastr8 leftovers are in `docs/adr/orchestr8-naming.md` and were not renamed.

## Gates left open

- **G-1** Embedding model and dimension. No column created.
- **G-2** Read-time decay is the default. Greg can still ask for a materialized column and a job.
- **G-3** Orchestr8 is adopted for new names. Old Orchastr8 strings are logged, not renamed.
- **G-4** New tables are in `vault_signals`. `vault_core.signals_news_source` was not moved.
- **G-5 / HS-6** Section 5 coefficients were not in the repo. They were not invented. The weight row is `spine-structural-stand-in` / `0.0.0`, `verified=false`, status `coefficients_withheld`. The generated expression is the product `base_confidence * base_impact * (1 - noise_probability)` so the column and the decay tests can exist. That product is not Section 5. A generated column cannot read the weight table, so a later real formula is a new weight row plus a decision to move generation onto a trigger.
- **G-6** No comics price authority row or adapter.
- **G-7** ESPN, Daily MTG, and LBMA rows were not touched.

## Branch

`cursor/signals-v1-spine` was not created. This checkout is `cursor/vip-shell-v1` with a large uncommitted tree (VIP shell, PriceCharting, and the news-source migration the spine foreign-keys). Switching to a new branch off `main` would have carried or conflicted with that work. The spine files are in this working tree. Nothing was committed.

## What the plan told me not to do

I did not build adapters, jobs, schedulers, network calls, embeddings, entity resolution, a thesis engine, a dashboard, Notion, or any write to `vault_market`. I did not enable a source. I did not add the other seven scores. I did not fold news sources into a generic sources table. I did not put half-lives in code. I did not rename Orchastr8. I did not add a GoCollect or CovrPrice stub.

I would have put this on a clean branch off `main` in its own worktree. I did not, because this working tree is already occupied.

I would have seeded Section 5's actual coefficients if the note had been in the repo. It was not, so the weight row says the coefficients are withheld instead of wearing invented numbers.

Provenance columns on event, signal, and prediction, plus `half_life_verified`, are extra relative to the plan's column lists. They are there so a typed guess cannot sit in the same shape as a measurement, which is the rule this repo already uses for `authority_seed`. `valuation_citation` exists so the firewall has a trigger to reject, without altering `vault_market`.
