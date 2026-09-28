# ADR 0013 — SIGNALS v1 evidence spine

Status: accepted (2026-09-22) · amended 2026-09-24 (gate decisions, see below)
Extends: ADR 0012 (Path B — no `priced_unit` join)
Supersedes: none

## Context

SIGNALS needs a place to keep raw evidence, group it into events, score a signal, let that score decay, and write predictions early enough that the clock can be scored later. A 2026-09-20 architecture note describes a much larger system. This ADR records only the spine.

`vault_core.signals_news_source` already exists (14 rows, adapters off). `may_raise_valuation_ceiling` was a column with a CHECK that forces false, and nothing read it.

## Decision

1. **Three stored scores.** `base_confidence`, `base_impact`, `noise_probability`. Priority is not stored. `vault_signals.signal_priority(signal_id, weight_set_id)` computes it at read time from the current `score_weight_set` row (amended 2026-09-24, G-5). Relevance, novelty, magnitude, actionability, and source quality are not signal columns. Attention lives in `attention_observation` and is not a confidence input.

2. **Read-time decay (G-2).** `vault_signals.signal_influence(signal_id, at_timestamp)` returns `signal_priority * 0.5 ^ (hours_elapsed / half_life_hours)`. Half-lives live in `signal_type.default_half_life_hours` with `half_life_verified = false` on every seed row. No current-value column.

3. **Schema split (G-4).** Rule: `vault_core` holds registries and configuration; `vault_signals` holds pipeline data. `vault_core.signals_news_source` is a registry, so it stays in `vault_core`. Do not merge it with market data sources (HS-3).

4. **Spelling (G-3).** Orchestr8 is the only spelling; the other was a typo. The leftovers were renamed on 2026-09-24 (`docs/adr/orchestr8-naming.md`).

5. **Valuation firewall.** `assert_not_valuation_evidence` reads `may_raise_valuation_ceiling` and raises when it is not true. `valuation_citation` inserts call that function. Nothing in this ADR writes `vault_market` or reads `v_guide_price_baseline`.

6. **Predictions start now.** `prediction` plus `prediction_measurement` rows at +7, +30, +90, +180, and +365 days. `subject_ref` and `source_thesis_ref` are text placeholders.

7. **No embedding column (G-1).** The seam is a comment on `raw_document.id`. No pgvector column.

8. **Provenance.** Event, signal, and prediction rows carry source, method, rule version, confidence, and verification. Seeded half-lives and weights are unverified estimates.

## Gate decisions (2026-09-24, Greg)

| Gate | Decision | Status |
| --- | --- | --- |
| G-1 Embedding dimension | Deferred. When chosen, embeddings go in a separate table keyed by `(raw_document_id, model)` so a model change adds rows instead of rebuilding a column. | Open: model not picked. |
| G-2 Decay timing | Read time. Revisit only if a feed query is measurably slow. | Closed. |
| G-3 Orchestr8 spelling | Orchestr8. The other spelling was a typo; leftovers renamed. | Closed. |
| G-4 `vault_core` vs `vault_signals` | Rule: registries and configuration in `vault_core`, pipeline data in `vault_signals`. Nothing moves. | Closed. |
| G-5 Scoring weights | Option C: priority computed at read time from the current weight set. See "Priority" below. | Closed. Weights stay unverified until calibrated. |
| G-6 Comics price authority | Hold. No vendor picked. It is a market data source (ADR 0010), never a news source. | Open. |
| G-7 ESPN, Daily MTG, LBMA | Sports cards are a priority: connect ESPN or an equivalent sports-news source. The ESPN row stays blocked until its terms are settled; an equivalent may be used instead. Daily MTG and LBMA unchanged. | Open: sports source being selected. |

## Priority (G-5, option C)

`priority_score` is no longer a generated column. `vault_signals.signal_priority(signal_id, weight_set_id DEFAULT current)` evaluates the weight set's formula over the three stored scores:

`weighted_product_v1 = base_confidence^a * base_impact^b * (1 - noise_probability)^c`

- The exponents live in `score_weight_set.weights_json`. At most one row has `is_current = true`, and a row can only become current if the function can evaluate it.
- The seed row `spine-v0-product` 0.1.0 uses 1/1/1. That reproduces the spine's structural product exactly. It is `verified = false` and is **not** Section 5.
- Switching the current row re-ranks every signal at read time. No signal row is rewritten.
- `signal.score_weight_set_id` records the set current when the signal was written. `prediction.score_weight_set_id` is stamped on insert, so outcomes can be compared per weight set.
- Real weights come from calibration against resolved predictions (the first +30-day measurements), published as a new row. Section 5's coefficients are not needed and were never transcribed.

## Consequences

- Migrations `20260920_10` through `20260920_14` plus `20260924_01` (read-time priority) are the spine. They depend on `20260920_06` (`signals_news_source`).
- Zero sources are enabled. The spine makes no network calls.
- `may_raise_valuation_ceiling` is now read by the firewall. It is no longer only a CHECK.
- Comics still have no price authority (G-6).

## Alternatives rejected

- Ten stored scores. False precision.
- A generic `sources` table that absorbs `signals_news_source`.
- A pgvector column before the dimension is chosen.
- Writing decay into a stored "current influence" column.
- A generated `priority_score` column (shipped 2026-09-22, removed 2026-09-24). A generated column cannot read the weight table.
- Waiting to create prediction rows until the thesis engine exists.
