# VIP Intelligence Systems — Handoff for Cursor / Grok

**Prepared:** 2026-08-15
**Plan artifact:** `2026-08-15_intelligence_systems.iqvplan.json` (also under `vip_intelligence_systems/plan/`) — source of truth for status/sequencing. Read it before touching any migration.
**Migrations:** `infra/db/migrations/20260815_11_prediction_ledger.sql` through `16_field_modes_interfaces.sql` (copies also under `vip_intelligence_systems/migrations/`).
**Logic:** `@vip/intelligence` — Phase 1 scoring + the six conversation fixtures. Phase 2/3 stay schema/interfaces only.

This package instantiates the **IQVault Plan Compiler** concept for the first time: it turns a conversation full of good ideas into a structured, versioned, status-tagged plan instead of eleven unrelated feature requests. Everything here targets the existing live schema (`vault_core`, `vault_collection`, `vault_market`) — no new top-level schema is introduced, and every new table's style (UUID PKs via `public.uuid_generate_v4()`, `BEGIN;`/`COMMIT;` wrapping, explicit `search_path`, comments on every table) matches migrations 01–10 exactly.

## Read this first: four systems, three phases, not one flat list

The source conversation proposed 11 features. They collapse into four systems plus the Plan Compiler itself. Do not build them in numeric order — build in **phase order**, because several systems have real dependencies on data that doesn't exist yet.

| Phase | What | Migrations | Build real logic? |
|---|---|---|---|
| **1 — Build now** | Prediction Ledger, Evidence Engine, Acquisition Underwriting, Grading Optimizer, Museum Synergy Score, Binder Chase Architecture | 11, 12, 14 (partial), 15 | **Yes** |
| **2 — Schema now, logic later** | Market Cycle Detector, Buy Opportunity Scanner, Portfolio Consolidation | 13, 14 (partial) | **No** — tables and manual-entry rows only |
| **3 — Interfaces only** | Field Modes (Store/Show/Auction/Trade), CardSight identification pipeline | 16 | **No** — contracts only, no matching/calculation logic |

**Why Phase 2 is blocked:** Market Cycle Detector and Buy Opportunity Scanner both need population growth, sales velocity, listing supply, and social intensity data. That's Signals-system input, and Signals ingestion is still PROPOSED per the project reference manual — not confirmed live. Writing classification logic against data that doesn't exist yet means either fabricated numbers or a system that silently no-ops. Build the tables so real cases (e.g. the Drew Brees post-HOF case) can be entered by hand as validation fixtures, and stop there.

**Why Phase 3 is interfaces-only:** Store/Show/Auction/Trade Modes and the CardSight pipeline are a *different architectural layer* than Phases 1–2. Phases 1–2 are backend scoring systems — they don't know or care what UI calls them. Phase 3 is capture/workflow UX that *consumes* Phase 1–2 outputs. Conflating these was explicitly flagged as a scope risk. Cursor Opus was reported already building a version of the CardSight stack (CardSight + TCGdex + Scryfall/MTGJSON + Card Hedge, correctly scoped down without Yu-Gi-Oh or SportsCardsPro) — migration 16 formalizes the interface contract so this package doesn't diverge from that parallel work. **Do not add Yu-Gi-Oh or SportsCardsPro. Do not build mode-specific calculation logic (auction max-bid, trade basket equality) yet.**

## Dependency chain that actually matters

```
prediction_ledger ─┐
evidence_engine ────┼── no dependencies, build first
                    │
binder_chase_arch ──┼── build before museum_synergy_score
museum_synergy ──────── depends on binder_chase_arch (contributing_goal_ids)
                    │
acquisition_underwriting ── no dependencies
grading_optimizer ────────── no dependencies
                    │
portfolio_consolidation ──── BLOCKED on museum_synergy_score (Collection Quality
                              Density formula needs collection_synergy_score)
                    │
market_cycle_detector ──┬── BLOCKED on Signals ingestion (not yet confirmed live)
buy_opportunity_scanner ┘
                    │
field_modes ──────────────── depends on evidence_engine + acquisition_underwriting
                              + card_identification (for photo capture in Store/Show)
card_identification ────────── standalone, but keep behind the four named interfaces
```

Run migrations in numeric order (11 → 16). Within migration 14, acquisition underwriting and grading optimizer are independent of each other and of portfolio consolidation — the file just groups them because they share the "Transaction Intelligence" label in the plan.

## Hard rules carried over verbatim (do not soften these)

From the acquisition underwriting design: coverage ratio below threshold **flags for human review, never auto-blocks the purchase.** Greg makes the call.

From the grading optimizer design: the answer is never a single number. `expected_incremental_profit` is deliberately a plain stored column (not a DDL-baked generated column) so the fee/opportunity-cost order of operations stays visible and editable at the application layer — see the comment in `14_transaction_intelligence.sql`.

From the CardSight pipeline design (non-negotiable):
- VaultOS owns the canonical `card_id`. External provider IDs are references only.
- Raw scans are immutable. Corrections happen in `card_identification`, never by mutating `card_scan`.
- `needs_review` is a permanent, legitimate state — never auto-cleared by a background job.
- A confirmed identity is never silently overwritten. Disagreement produces a *new* row; the old row gets `superseded_by` set and nothing else changes on it.
- Market price is always a time-series row in `market_price_observation`, never a single `current_value` field.
- Duplicate detection has two distinct checks: physical-scan fingerprint (catches re-scanning the same physical photo) and canonical card identity (does NOT flag owning two copies of the same card — that's valid).
- **False-auto-confirm rate is the metric that matters most**, not raw match accuracy. Routing something into `needs_review` is cheap; confidently contaminating inventory with a wrong identity is not. Build the 100–250 card golden test deck (`identification_golden_case`) before trusting any pipeline change.

## What's explicitly NOT in this drop

- Signals ingestion itself (`signals_raw` / `signals_normalized`) — already delegated separately, referenced here only as a dependency, not rebuilt.
- Yu-Gi-Oh and SportsCardsPro providers — explicit scope-down, don't reintroduce them because they'd be "easy to add while we're in here."
- AI/smart glasses interface — phone-first before glasses is unconditional per the reference manual.
- Any cron/scheduled job for Phase 2 systems.
- Mode-specific business logic for Field Modes (auction max-bid calc, trade basket-equality calc) — deferred on purpose, not stubbed with placeholder numbers.

## Test fixtures to seed for validation

These are real cases from the source conversation — use them as your first manual rows in each new table so acceptance criteria in the `.iqvplan.json` can actually be checked against something real, not synthetic data:

- **Prediction Ledger:** Mega Greninja ex SIR, $230, 90-day horizon, 55% down / 30% sideways / 15% up.
- **Evidence Engine:** BUY — Crown Zenith PC ETB, 94% confidence, shelf observation 2h old, market comps 14h old, expires 48h.
- **Market Cycle (manual entry only):** Drew Brees post-HOF — catalyst occurred, attention peaked, event passed, commodity cards soften, evaluate accumulation window.
- **Acquisition Underwriting:** $700 offer / $1,045 conservative LP value / 1.49× coverage ratio, vintage Pokémon lot.
- **Grading Optimizer:** Flareon, Jolteon, Snorlax, Chansey — manual PSA-tier expected value cases.
- **Binder Chase / Synergy:** Blastoise & Piplup dual-goal contribution example.

## Landed 2026-08-15 (this session)

- Migrations 11–16 copied into `infra/db/migrations/` (freshness is a live view — `now()` cannot be a STORED generated column; prediction/underwriting/scan immutability triggers added).
- `@vip/intelligence` implements Phase 1 acceptance criteria against the six fixtures (`npm run test -w @vip/intelligence`).
- Phase 2 exposes `recordManual*` only; `classifyMarketCycle` / `scanBuyOpportunities` throw until Signals ingestion is confirmed live.
- Phase 3 exports the four named provider interfaces and forbids Yu-Gi-Oh / SportsCardsPro. No auction max-bid or trade basket-equality stubs.

## Next step after this lands

Apply migrations 11–16 to live Postgres (after 01–08 + holdings). Signals ingestion is **not live** (`job_feed_json` + RSS only — no `signals_raw` / `signals_normalized`). That remains the single gate on Phase 2. Don't start Phase 2 logic until that's verified, not assumed. Read APIs: `GET /api/intelligence` and `/signals` + `/intelligence` on the collector face.
