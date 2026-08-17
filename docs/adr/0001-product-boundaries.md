# ADR 0001 — Product Boundaries (VIP · IQVault · VaultOS · Orchastr8)

**Status:** Accepted  
**Date:** 2026-07-20  
**Owner:** Gregory Williamson / 258 Services  
**Phase:** 0 — Architecture baseline

## Context

The repo already contains working proofs: SQL catalog spine
(`infra/db/migrations/20260701`–`20260708`), CLZ ingest, IQVault React app,
VaultOS demo, Comics API, bridge POC, and Orchastr8 agent runtime.
Without hard boundaries, those proofs drift into forked backends and synonym soup.
This ADR freezes what each product owns so any feature can be routed in under five minutes.

## Decision

Build **one shared intelligence core (VIP)**. IQVault and VaultOS are faces.
Orchastr8 is the contracted agent layer that *uses* the core — it does not own truth.

### VIP — Vault Intelligence Platform (shared core)

| | |
|---|---|
| **Owns** | Canonical data model, evidence/provenance, immutable raw snapshots, ingest adapters, decision engine, signals/prediction ledger, shared API + jobs, typed package contracts |
| **Consumes** | External market/source feeds via adapters; Orchastr8 outputs only after contract validation |
| **Never touches** | Collector-only UX chrome; store POS UI; hardware glasses; brand/legal naming |

**Maps from today:** `infra/db/migrations/` (catalog spine + dated files), `clz_comic_parser.py` / `load_comics.py` (logic to migrate into packages), `api/comics_server.py` (narrow path → future `services/api`).

### IQVault — collector face

| | |
|---|---|
| **Owns** | Collector UX: inventory/portfolio, hunts, sell queue, theses UI, show-mode client, personal constraints (budget, goals, risk) |
| **Consumes** | VIP API + decision-engine recommendations; Orchastr8 for research/council flows behind contracts |
| **Never touches** | Direct DB writes; store margin/POS logic; forking decision rules for “collector-only” math |

**Maps from today:** `apps/iqvault-web` on `:3000` (live collector face). The Vite tree `iqvault/` is an archived proof, not a runnable product.

### VaultOS — LGS / store face

| | |
|---|---|
| **Owns** | Store UX: intake, buy-offer presentation, listing-channel suggestions, inventory aging views, store constraint profiles (margin, turn targets) |
| **Consumes** | Same VIP decision engine with **store constraints swapped in**; same catalog/evidence |
| **Never touches** | A second pricing brain; collector portfolio pillars as store truth; full POS until a gate unlocks it |

**Maps from today:** `demo/` (scan/offer/review prototype), `demo/src/lib/offerEngine.js` (heuristics to replace, not fork).

### Orchastr8 — agent layer

| | |
|---|---|
| **Owns** | Agent manifests, orchestration, voting/gates, critic escalation, provider routing, run traces/cost |
| **Consumes** | VIP tools (catalog lookup, evidence fetch, decision-engine call); never invents persistent market facts |
| **Never touches** | Canonical writes without provenance; shipping recs without contracts; bypassing critic on high-dollar calls |

**Maps from today:** `orchestr8/` (22 role skills, voting, planner, structured JSON). Recast prompt JSON into typed I/O contracts in Phase 4+.

### Out of product (platform glue)

| Piece | Role |
|---|---|
| `bridge/` | Local sync POC — not a product boundary; absorb or replace under VIP API |
| `shared/`, `scripts/` | Utilities — no ownership of truth |
| Root SQL + Python loaders | **Legacy proofs** until migrated into `packages/*` + `infra/db` |

## Feature routing table

| Feature idea | Goes to | Why |
|---|---|---|
| CLZ / TCG import adapter | **VIP** (`packages/ingest`) | Shared ingest; faces only trigger it |
| Field-level provenance / raw snapshot | **VIP** (`packages/evidence`, `infra/db`) | Trust surface |
| Buy / Hold / Grade / Sell / Pass engine | **VIP** (`packages/decision-engine`) | One brain |
| Museum / INV / LIQ scores (collector heuristics) | **VIP** rules config + **IQVault** presentation | Scores are derived evidence, not a second engine |
| Absolute Batman / Pokémon hunt UI | **IQVault** | Face; hunt entities live in VIP model |
| Max buy offer + expected margin | **VaultOS** UI + **VIP** engine w/ store constraints | Same engine, different utility |
| Scan → recommend on phone | **IQVault** mobile client → **VIP** API | Thin client |
| Imaging station / defect notes | **VIP** media model + **VaultOS** capture UX | Measurement system, not booth |
| Critic / Pricing / Sell Advisor agents | **Orchastr8** contracts calling VIP tools | Agents advise; VIP persists |
| Full POS / marketplace automation / glasses / crossover ML | **Parked** | See `docs/backlog.md` |

## Boundary quiz (Phase 0 gate)

Pick any ten features; each must land in exactly one of: VIP / IQVault / VaultOS / Orchastr8 / Parked, with no overlap, in under five minutes using the table above.

## Consequences

- No new business logic in `iqvault/` or `demo/` that does not call shared packages/API.
- Recommendation taxonomies converge on VIP actions; legacy labels (`Museum Candidate`, `Sell Duplicate`, demo `avoid`) become reason codes or UI gloss — not competing enums.
- Orchastr8 confidence stays process/answer confidence; market confidence lives on evidence records.
- Monorepo target (`packages/`, `apps/`, `services/`, `infra/`) is the physical expression of F-01; migration is incremental, not a big-bang rewrite.

## Related

- Frozen Scope F-01–F-12 (`docs/mvp.md`)
- `docs/entities-v0.1.md`
- `docs/mvp.md`
- `AGENTS.md`
