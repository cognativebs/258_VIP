# CURSOR BUILD INSTRUCTIONS — SIGNALS v1 Spine

**Plan file:** `2026-09-20_signals-v1-spine.iqvplan.json`
**Repo:** `D:\Projects\Business_Ideas\258_Labs\258_VIP`
**Branch:** create `cursor/signals-v1-spine` off `main` — NOT off `cursor/pricecharting-core-wiring-f536`

Read the plan file first. It is authoritative. This document explains how to work through it.

---

## What you are building

The evidence spine for SIGNALS: raw evidence → event → signal, plus source lineage, three scores, per-type decay, attention momentum, and prediction rows.

## What you are NOT building

No adapters. No network calls. No jobs or schedulers. No embeddings. No entity resolution. No thesis engine. No dashboard. No Notion integration. No writes to `vault_market`.

A design document dated 2026-09-20 describes a much larger system. **That document is the target state, not this backlog.** If it and the plan file disagree, the plan file wins. Do not build something because that note describes it.

---

## Operating rules

**Run autonomously.** Work P0 → P6 without asking for confirmation between phases. Greg is not watching. The gates below are pre-resolved so nothing blocks on him.

**Six hard stops.** These are the only reasons to halt. They are listed as HS-1 through HS-6 in the plan file. When one fires: stop that thread, write the finding into the report, and continue with the remaining work if it is independent. Do not resolve a hard stop yourself — that is the whole point of it being one.

**Gates are pre-decided, not open questions.** Each gate in the plan has a resolution that lets you proceed. Apply it, note it in ADR 0013, move on. G-1 in particular: do not create any pgvector column. The dimension cannot be backfilled, so the only safe move is to not create it yet.

**Report at the end, not throughout.** One report covering: P0 findings, what was built, every gate left open, and anything you would have done differently but did not because this plan said not to. That last section matters — write it honestly.

---

## Three things this plan deliberately does the unusual way

**Exactly three stored scores.** The design note proposes ten per signal. Ten invented numbers quoted to 5% precision is false precision, which is a named project risk. Store `base_confidence`, `base_impact`, `noise_probability`; generate `priority_score`. Do not add a fourth until something consumes it.

**Predictions come early.** The design note puts the outcome engine tenth. It is pulled forward to P5 because prediction measurement is time-gated, not effort-gated. A prediction not written this month cannot be scored next spring, no matter what gets built in between. Crude and real beats elegant and empty.

**News sources stay separate from market data sources.** Section 19 of the design note proposes a generic `sources` table. That is wrong and is overridden. `vault_core.signals_news_source` stays exactly where it is. The separation is what makes `may_raise_valuation_ceiling` meaningful — merge the tables and the first join someone writes quietly reconnects a Reddit thread to a valuation.

---

## P0 findings that need a plain answer

Do not soften these in the report.

1. Does anything actually read `may_raise_valuation_ceiling`? If it is a column nothing consults, say so. It is decorative until P4 adds enforcement.
2. Does any SIGNALS DDL imply a `priced_unit` join? ADR 0012 Path B says join on `asset_id`, `condition_key` on the observation, `priced_unit` empty. HS-1.
3. Is `v_guide_price_baseline` still 0 rows? Report the actual count.
4. Any migration filename collision across branches? HS-4.

---

## Migration discipline

- Date-prefixed names only: `20260920_10` through `20260920_14`. No `025`–`030` style numbering anywhere.
- Every migration wrapped in `BEGIN;` / `COMMIT;`.
- Reference tables seeded before dependent layers.
- Extensions install into `public`, never a named schema.
- Migrations must apply cleanly to a fresh database, in order.

---

## Seed data honesty

Every seeded number in this build is an estimate, and must be marked as one. Scoring weights carry `verified=false`. Half-lives are starting guesses in a data table, not constants in code. The same discipline already applied to `authority_seed` applies here: a number someone typed is not a measurement, and the schema should never let those two look alike.

---

## Definition of done

See the plan file. In short: five migrations apply cleanly, all acceptance tests pass against fixtures, zero enabled sources, zero network calls, ADR 0013 written, one report delivered.
