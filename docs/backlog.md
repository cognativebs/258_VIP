# VIP Backlog

**Feature freeze:** OFF *(lifted 2026-08-02 — owner decision).*  
Work may proceed without a Now/Next gate. Prefer Orchestr8 Build Spec → Cursor
for non-trivial features (ADR 0003). Engineering rules 1–6 in `AGENTS.md` still apply.

**Historical sequencing (no longer binding):** ADR 0002 Orchestr8-first; ADR 0003
autonomy 0 (Orchestr8 authors specs; Cursor builds).

---

## Remaining work (snapshot 2026-08-02)

Detailed inventory of what was left incomplete when the freeze/milestones were removed.
Grouped by area. Checkboxes are unfinished unless marked done.

### A. Orchestr8 — Collection Analysis (partial)

Started as owner unlock; thin slice shipped; gates incomplete.

- [x] Console **Analysis** tab — inventory load (Comics `:5200` → VIP `:8787` fallback)
- [x] Compact context builder + Analysis Council / Comics VIP presets
- [x] Proxies: `/api/comics/*`, `/api/vip/*`
- [ ] **Gate:** Analysis tab loads inventory + one SSE run persists to Runs (operator-verified)
- [ ] Challenge Council second pass on high-dollar slices (optional path in Console)
- [ ] Richer inventory filters (pillars / workspace parity with legacy IQVault analytics)
- [ ] Evidence-backed market ranges in analysis context (not CLZ/catalog snapshot as truth)
- [ ] Sell-queue dogfood path: top-N liquidate advice tied to decision-engine + provenance

### B. Orchestr8 — Console UX polish

- [x] App on `:3001`, Team / Build Spec / Runs / Specs
- [x] Runs panel human-readable summary (verdict / steps; raw JSON optional) — 2026-08-02
- [x] Keep-alive tabs + session store (switching tabs does not kill a live council)
- [x] Always-visible Council Strip (roles · provider · model; click for skill blurb)
- [x] Progress dock: role status bar, elapsed, live highlights, Stop
- [ ] Gateway `step_start` events (so dock can show “calling model” before first token)
- [x] Surface `buildSpecPath` / Specs link prominently after approved Build Spec emits — Open Specs + Revise from veto (1×) (2026-08-02)
- [ ] Fix `scripts/start_iqvault_ecosystem.ps1` parse failure (launcher broken)

### C. Orchestr8 — Phase O2 Diff review loop *(never started)*

Seeded but not executed as product workflow.

- [ ] Paste implemented diff → Challenge Council scores vs spec acceptance criteria
- [ ] O2 gate: council catches a deliberately spec-violating diff
- [ ] Execute seed work order: [`docs/specs/o2-diff-review.md`](specs/o2-diff-review.md) in Cursor
- [ ] Wire optional “review this diff” panel in Console (was out of Console v1 scope)

### D. Signals → IQVault (partial wire done)

Job→feed→API→Signals page works; Sources quality UX does not.

- [x] `pokemon-drops` → `signals-feed.json` → `GET /api/signals` (`job_feed`)
- [x] IQVault Signals page consumes API; shows source line
- [x] VIP `GET /api/sources` wired to `packages/signals` `SourceRegistry` / `DEFAULT_SOURCES` (Signals v1 r1 · 2026-08-02)
- [x] Mutable `active` toggle + persistence for sources (`PATCH /api/sources/:id` + `sources-state.json`)
- [x] Contribution stats per source (signal count, quarantine rate, evidence count)
- [ ] IQVault Sources editor UI (toggle + stats) — API ready; thin editor still optional
- [ ] Prediction ledger / Brier calibration visible on Signals page
- [x] Real RSS adapter for `pokemon-news-rss` (fixture offline; live via `VIP_POKEMON_NEWS_RSS_URL`) — retail stub remains
- [x] Signals feeding decision-engine as evidence (`signalsToEvidenceRefs` + recommend bridge)

### E. Binder Vault ↔ VIP / IQVault (partial wire done)

- [x] Nav link from IQVault web → Binder (`NEXT_PUBLIC_BINDER_URL`)
- [x] Pokémon seed holdings with `externalIds` on VIP inventory
- [x] Binder **Sync Owned (VIP)** API + button
- [ ] Binder → VIP write path (owned/wishlist → holdings/watchlist)
- [ ] Full TCG catalog holdings in VIP (not just 5 seeds)
- [ ] Shared provenance package (`@vip/evidence`) inside Binder (today: local zod shapes)
- [ ] Merge Binder into iqvault-web routes / kill dual-app friction (optional product choice)
- [x] Binder typecheck clean — verified clean 2026-08-08 (`rarityKeys` errors no longer reproduce); now enforced by root `typecheck` + CI
- [x] Per-slot `price_updated_at` + Ledger “Prices as of…” + Sync Prices / Refresh All (page)
- [ ] Price history snapshots (`price_snapshot` table) for secondary-market flux charts
- [ ] Scheduled / background Binder price refresh (cron or idle job)

### F. Unified Bloomberg / collector terminal *(partial — owner unlock 2026-08-08)*

- [x] Bloomberg-style restyle of `apps/iqvault-web` (gold-dark Personal Intelligence shell from `:5175`)
- [x] Full comics grid + filters on VIP face (`/collections/comics`; Comics API `:5200` with VIP inventory fallback)
- [x] Richer hunts explorer on VIP `/api/hunts`; Vite `iqvault/` proof archived
- [ ] **TCG + comics in one Bloomberg grid** (explicit gap; see [`docs/how-to/02-tcg-in-bloomberg-view.md`](how-to/02-tcg-in-bloomberg-view.md))
- [x] Analysis/insights panel on collector face (Orchestr8 chat ported; Analytics tab on `/collections/comics`)
- [ ] Team/role picker for collector-face analytics (currently fixed Analysis Council preset)
- [ ] Single inventory truth across Comics Postgres, VIP API, Binder SQLite

### G. Product trial & trust

- [ ] Dogfood IQVault for 7 days vs spreadsheets
- [ ] Hunt completion % vs shelf
- [ ] Sell-queue trust (top 20) — operator acceptance

### H. Phase 5 — Mobile Show Mode *(not started)*

- [ ] Scan + asking price → decision engine
- [ ] ≤4 taps; offline capture + sync; &lt;8s field trial

### I. Phase 6 — VaultOS pilot + grading capture *(not started)*

- [ ] Store constraints on same engine as VIP
- [ ] Capture session model (measurement provenance; ML crossover still deferred ideas)
- [ ] One cooperative store pilot metric

### J. Data foundation leftovers

- [ ] Schema review (Opus) before treating Phase 1 as fully closed
- [ ] Live comps adapters (eBay etc. still `adapter_pending` on Sources seed)
- [ ] Liquidation-ready valuations: ranges + evidence count + recency + confidence end-to-end

### K. DevEx / ops leftovers

- [ ] Reliable one-shot VIP stack launcher (ecosystem `.ps1` broken; manual starts work)
- [ ] Admin spend keys optional docs (`/v1/accounts` vs chat keys on `/v1/health`)
- [x] Include `@vip/binder-vault` in monorepo `typecheck` (also `@vip/orchestr8-console`) — 2026-08-08
- [x] CI on every PR: `build` → `typecheck` → `test` (Node) + Python ingest tests — 2026-08-08
- [x] `npm test` / `npm run typecheck` work from a cold checkout (`build:packages` prerequisite) — 2026-08-08

### L. Trust & correctness debt *(audit 2026-08-08)*

Found while auditing whether the collector face reports the real collection.
These are rule violations and wrong-data paths, not missing features.

- [x] **Rule 4 violation — fabricated comps.** `syntheticSales()` deleted 2026-08-09.
      Recommendations now return `insufficientMarketEvidence` +
      `INSUFFICIENT_MARKET_EVIDENCE` until eBay / TCGplayer adapters answer.
- [x] **Wrong numbers on every VIP surface.** VIP API reads `vault_collection.holding`
      (2,700 comics) via Postgres. Sample JSON is a test fixture only.
- [x] **Silent degradation.** Comics-down returns `comicsAvailable: false` /
      `comicsSource: "unavailable"` and 503 on sell-queue / recommendations /
      watchlist / theses. UI banners the gap — no sample portfolio.
- [x] **Rule 3 violation — snapshot bypass.** Fixed in PR #4 (`import_clz.py` +
      `raw_snapshots`).
- [x] **Two CLZ parsers.** ADR 0006 — Python authoritative; `@vip/ingest` removed.
- [x] **Hardcoded user profile.** Replaced with `user-constraints.json` /
      `VIP_USER_CONSTRAINTS_PATH`; empty defaults when unset (no invented budget).
- [x] **Hardcoded/derived-from-nothing endpoints.** Sell-queue / watchlist / theses
      now derive from live holdings. `/api/hunts` remains a seed file (tracked below).
- [ ] **Hunts still seed data.** `/api/hunts` reads `seeds/hunts.ts` — move to Postgres.
- [ ] **Live comps adapters.** eBay sold listings + TCGplayer market (Decision D).
- [ ] **Verification debt.** 2,684 of 2,700 comics carry `Needs Verification` (mostly
      raw books with `NM assumed`). Needs a burn-down path, not a silent accept.

---

## Deferred ideas (no freeze — just not prioritized)

Formerly “Parked.” Safe to pick up via Build Spec when wanted; still high-cost / out-of-core:

- In-Orchestr8 build harness (write/execute tools) — superseded by Cursor builder (ADR 0003); keep deferred unless autonomy model changes
- Orchestr8 semi-autonomous / fully autonomous build modes (writes/tests/commits)
- AI glasses / wearable interface
- PSA → CGC/TAG crossover ML
- Full POS & event management
- Marketplace listing automation
- Custom / unsupervised model training
- Every collectible category at once
- Final legal names, domains, trademarks — names now chosen (Crucible · Forge · Temper, see [`docs/branding/naming-decision.md`](branding/naming-decision.md)); clearance + store-face name still open
- Premium data-feed marketplace
- Expanding `bridge/` as a product (prefer absorb under VIP API)
- Parallel “second brain” offer engines in face apps
- Interactive WebGL “AI core” hero — sandbox at `sandbox/ai-core/`

---

## Shipped (historical)

### Binder ↔ IQVault integration *(2026-08-03)*
- [x] VIP API Binder SQLite holdings adapter (`/api/inventory`, `/api/tcg/binders`)
- [x] Portfolio TCG section + Binder deep-links (`?binderId=`)
- [x] Sync Owned filters owned VIP rows only (not Binder needs)
- [x] LAN / phone Binder UI (responsive drawer search, touch move, PWA lite)
- [x] ADR 0005 — Binder SQLite now, Postgres later
- [ ] Postgres migration of durable VIP holdings (ADR 0005 target)

### Signals + Binder wire *(2026-08-02)*
- [x] Job feed → VIP signals API → IQVault Signals
- [x] Binder nav + Sync Owned + Pokémon `externalIds` seeds

### Orchestr8 Console UI *(2026-07-26)*
- [x] `apps/orchestr8-console` — Team, Build Spec, Runs, Specs

### Phase O1 — Build-spec generator *(2026-07-26)*
- [x] Schema + emitter → `docs/specs/`; Build Spec Council; read-only tools; runs API

### Phase O0 — Contracts & persistence *(2026-07-23)*
- [x] 22 agent contracts v2; immutable `runstore`

### Phase 4 — Automated intelligence runs *(2026-07-21)*
- [x] `@vip/signals` pipeline, registry, quarantine, jobs pokemon-drops

### Phase 3 — IQVault working app
- [x] VIP API + Next collector face (trial week deferred — see Remaining G)

### Phase 2 — Decision engine v0.1
- [x] Package + backtest gate

### Phase 1 — Canonical data foundation
- [x] core-model, evidence, ingest, raw_snapshots, round-trip gate

---

## Open ideas

_Add new ideas here freely. No milestone sorting required._

- Sources registry API + IQVault Sources editor (re-run Build Spec — prior veto was freeze-only)
