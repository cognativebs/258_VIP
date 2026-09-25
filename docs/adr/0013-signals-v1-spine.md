# ADR 0013 — SIGNALS v1 evidence spine

Status: accepted (2026-09-22)
Extends: ADR 0012 (Path B — no `priced_unit` join)
Supersedes: none

## Context

SIGNALS needs a place to keep raw evidence, group it into events, score a signal, let that score decay, and write predictions early enough that the clock can be scored later. A 2026-09-20 architecture note describes a much larger system. This ADR records only the spine.

`vault_core.signals_news_source` already exists (14 rows, adapters off). `may_raise_valuation_ceiling` was a column with a CHECK that forces false, and nothing read it.

## Decision

1. **Three stored scores.** `base_confidence`, `base_impact`, `noise_probability`. `priority_score` is a generated column, not a fourth authored number. Relevance, novelty, magnitude, actionability, and source quality are not signal columns. Attention lives in `attention_observation` and is not a confidence input.

2. **Read-time decay (G-2).** `vault_signals.signal_influence(signal_id, at_timestamp)` returns `priority_score * 0.5 ^ (hours_elapsed / half_life_hours)`. Half-lives live in `signal_type.default_half_life_hours` with `half_life_verified = false` on every seed row. No current-value column.

3. **Schema split (G-4).** New pipeline tables are in `vault_signals`. `vault_core.signals_news_source` stays where it is. The split is inconsistent on purpose and is open for Greg to settle. Do not merge the tables (HS-3).

4. **Spelling (G-3).** New identifiers use Orchestr8. Existing Orchastr8 strings are listed in `docs/adr/orchestr8-naming.md` and were not renamed.

5. **Valuation firewall.** `assert_not_valuation_evidence` reads `may_raise_valuation_ceiling` and raises when it is not true. `valuation_citation` inserts call that function. Nothing in this ADR writes `vault_market` or reads `v_guide_price_baseline`.

6. **Predictions start now.** `prediction` plus `prediction_measurement` rows at +7, +30, +90, +180, and +365 days. `subject_ref` and `source_thesis_ref` are text placeholders.

7. **No embedding column (G-1).** The seam is a comment on `raw_document.id`. No pgvector column.

8. **Provenance.** Event, signal, and prediction rows carry source, method, rule version, confidence, and verification. Seeded half-lives and weights are unverified estimates.

## Gates left open

| Gate | Resolution used | Still open |
| --- | --- | --- |
| G-1 Embedding dimension | No vector column. Comment on `raw_document.id`. | Yes. Greg picks the model and dimension later. |
| G-2 Decay timing | Read time. | Yes, if Greg wants a materialized column plus a job. |
| G-3 Orchestr8 spelling | Adopted for new identifiers. Old spellings logged, not renamed. | Cleanup is a separate pass. |
| G-4 `vault_core` vs `vault_signals` | New tables in `vault_signals`. News source table not moved. | Yes. Greg settles the split. |
| G-5 Scoring weights | Table exists. Seed row `verified=false`. | **Yes. Section 5 coefficients were not in the repo. They were not invented.** See HS-6 below. |
| G-6 Comics price authority | No row, stub, or adapter. | Yes. GoCollect vs CovrPrice. |
| G-7 ESPN, Daily MTG, LBMA | Those source rows were not touched. They stay blocked. | Yes. |

## HS-6 — priority formula

`priority_score` has to be a generated expression, and a generated column cannot read `score_weight_set`. The architecture note's Section 5 numbers are not in the repository.

What shipped is a structural product, marked unverified, so decay tests have a base to decay:

`base_confidence * base_impact * (1 - noise_probability)`

That expression is **not** Section 5. The weight row's status is `coefficients_withheld`. Replacing it is a new weight-set row plus a decision about whether generation moves to a trigger so the table can actually drive the number. This ADR does not close that decision.

## Consequences

- Migrations `20260920_10` through `20260920_14` are the spine. They depend on `20260920_06` (`signals_news_source`).
- Zero sources are enabled. The spine makes no network calls.
- `may_raise_valuation_ceiling` is now read by the firewall. It is no longer only a CHECK.
- Comics still have no price authority (G-6).

## Alternatives rejected

- Ten stored scores. False precision.
- A generic `sources` table that absorbs `signals_news_source`.
- A pgvector column before the dimension is chosen.
- Writing decay into a stored "current influence" column.
- Waiting to create prediction rows until the thesis engine exists.
