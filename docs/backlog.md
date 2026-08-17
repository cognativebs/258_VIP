# VIP Backlog

**Feature freeze:** OFF *(lifted 2026-08-02 — owner decision).*  
Work may proceed without a Now/Next gate. Prefer Orchestr8 Build Spec → Cursor
for non-trivial features (ADR 0003). Engineering rules 1–6 in `AGENTS.md` still apply.

**Live-ops weekend track (2026-08-14):** operator asked for live news into
Orchestr8, live inventories + market ranges (comics / Pokémon / Magic / sports),
working double-click launch, and bulk scan + bulk eBay list. Audit + gates:
[`docs/plans/0002-live-ops-weekend.md`](plans/0002-live-ops-weekend.md).
Launcher fix is merged (PR #27). Prefer **section L + code** over stale J
(`adapter_pending`); eBay sold + TCGplayer comps shipped idle. ADR 0007
(Postgres) supersedes historical ADR 0005 “SQLite now” checkboxes below.

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
- [ ] **Signals slice in Analysis / Comics Ask context** (feed exists; Orchestr8 does not ingest it) — plan 0002 W1
- [ ] Sell-queue dogfood path: top-N liquidate advice tied to decision-engine + provenance

### B. Orchestr8 — Console UX polish

- [x] App on `:3001`, Team / Build Spec / Runs / Specs
- [x] Runs panel human-readable summary (verdict / steps; raw JSON optional) — 2026-08-02
- [x] Keep-alive tabs + session store (switching tabs does not kill a live council)
- [x] Always-visible Council Strip (roles · provider · model; click for skill blurb)
- [x] Progress dock: role status bar, elapsed, live highlights, Stop
- [ ] Gateway `step_start` events (so dock can show “calling model” before first token)
- [x] Surface `buildSpecPath` / Specs link prominently after approved Build Spec emits — Open Specs + Revise from veto (1×) (2026-08-02)
- [x] Fix `scripts/start_iqvault_ecosystem.ps1` — parse failure rewritten 2026-08-09; retarget VIP `:8787` + collector `:3000` (2026-08-13)

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
- [x] Binder → Postgres (ADR 0007, 2026-08-09) — `vault_tcg.*`; SQLite is import-only
- [x] Binder → VIP write path (2026-08-09) — owned → `vault_collection.holding`
      (`source=binder_vault`); wishlist → `vault_collection.watchlist_item`; per-toggle
      project + bulk **Push to VIP**; inventory prefers durable owned holdings
- [ ] Full TCG catalog holdings in VIP (not just 5 seeds)
- [ ] Shared provenance package (`@vip/evidence`) inside Binder (today: local zod shapes)
- [ ] Merge Binder into iqvault-web routes / kill dual-app friction (optional product choice)
- [x] Binder typecheck clean — verified clean 2026-08-08 (`rarityKeys` errors no longer reproduce); now enforced by root `typecheck` + CI
- [x] Per-slot `price_updated_at` + Ledger “Prices as of…” + Sync Prices / Refresh All (page)
- [x] Price history snapshots (`price_snapshot` table) — schema in ADR 0007 migration
- [ ] Scheduled / background Binder price refresh (cron or idle job)
- [ ] Wire Binder price sync to insert `price_snapshot` rows on every refresh

### F. Unified Bloomberg / collector terminal *(partial — owner unlock 2026-08-08)*

- [x] Bloomberg-style restyle of `apps/iqvault-web` (gold-dark Personal Intelligence shell from `:5175`)
- [x] Full comics grid + filters on VIP face (`/collections/comics`; Comics API `:5200` with VIP inventory fallback)
- [x] Comics Terminal edits via VIP when `:5200` is down (`POST /api/comics/holding/:id`, same Postgres) — 2026-08-09
- [x] TCG + Sports collection tabs (`/collections/tcg`, `/collections/sports`) — TCG is live Binder holdings; Sports is a stub; CLZ XML drop zone live on Comics
- [x] Richer hunts explorer on VIP `/api/hunts`; Vite `iqvault/` proof archived
- [ ] **TCG + comics in one Bloomberg grid** (explicit gap; see [`docs/how-to/02-tcg-in-bloomberg-view.md`](how-to/02-tcg-in-bloomberg-view.md))
- [x] Collections hub + first-class TCG collection page (`/collections`, `/collections/tcg`) so comics is not the only collection — 2026-08-10
- [x] Scan intake in IQVault (`/scan` + `POST /api/scan/import-folder`) — no curl to start/import a batch — 2026-08-10
- [x] **ADR 0009** identity staging — candidates as rows; canonical inventory written only at resolve — 2026-08-10
- [x] Confidence bands + opt-in auto-resolve gate (margin + identity-grade reason + no duplicate) — 2026-08-10
- [x] Catalog adapter seam (`CatalogAdapter`) so the fixture catalog is swappable — 2026-08-10
- [ ] Bulk review actions (confirm all `auto`, reject all `none`)

### N. Catalog + market adapters *(ADR 0010 · [plan](plans/0001-catalog-adapter-rollout.md))*

Ordered so the metered provider is not the first dependency. Yu-Gi-Oh and
SportsCardsPro are out of scope this round (the latter also has a
third-party-access licence limit).

- [ ] **Phase 0** `CatalogResolver` fan-out + merge on `external_id` corroboration
- [ ] **Phase 0** Identification cache keyed on `raw_snapshots.content_hash` (re-runs cost zero calls)
- [ ] **Phase 0** Snapshot every provider response before parsing (rule 3)
- [ ] **Phase 0** Wire `vault_market.id_observation` (exists, unused) — predicted vs confirmed
- [ ] **Phase 0** Benchmark harness: top-1 / parallel / card-number accuracy, calibration, failure rate
- [ ] **Phase 1** `TcgdexCatalogAdapter` (Pokémon, free, keyless) — catalog truth only, not pricing
- [ ] **Phase 2** `ScryfallCatalogAdapter` + MTGJSON local mirror (Magic, free)
- [ ] **Phase 3** `CardSightCatalogAdapter` (sports, metered) + 100–250 messy-card benchmark
- [ ] **Phase 3** Parallel disambiguation if exact-parallel accuracy misses target
- [ ] **Phase 4** `cardHedgeAdapter` in comps — ranges only, idle without key (rule 4)
- [ ] **Phase 4** Persist comps into `vault_market.sale` → `market_value` (schema exists, unwired)
- [ ] **Phase 5** eBay Catalog ePID as `external_id` → listing prefill
- [ ] Postgres asset catalog adapter (repeat scans converge on confirmed assets)
- [ ] Re-identify staged units after a catalog upgrade (no re-scan needed)
- [x] Analysis/insights panel on collector face (Orchestr8 chat ported; Analytics tab on `/collections/comics`)
- [x] Team/role picker for collector-face analytics (AI team / council panel on Comics Analytics) — 2026-08-09
- [x] Single inventory truth across Comics + Binder in Postgres (ADR 0007) — VIP API reads both; unified Bloomberg grid still open above

### G. Product trial & trust

- [ ] Dogfood IQVault for 7 days vs spreadsheets
- [ ] Hunt completion % vs shelf
- [ ] Sell-queue trust (top 20) — operator acceptance

### H. Phase 5 — Mobile Show Mode *(not started)*

- [ ] Scan + asking price → decision engine
- [ ] ≤4 taps; offline capture + sync; &lt;8s field trial

### I. Phase 6 — VaultOS pilot + grading capture *(partial — scan intake 2026-08-09)*

- [x] Capture session model + Ricoh fi-8170 intake pipeline (`@vip/scan-ingest`,
      ADR 0008) — duplex folder-drop → ID candidates → duplicate alert →
      inventory confirm (Hold) → eBay listing draft idle without tokens
- [x] Migration `20260809_03_capture_session.sql` (`vault_media.*`)
- [x] VIP API `/api/scan/*` review/confirm surface
- [ ] Write-through from API store → Postgres `vault_media` + `vault_collection.holding`
- [ ] Operator review UI (IQVault / VaultOS face)
- [ ] Live catalog adapters (replace fixture sports/TCG matcher)
- [ ] Museum-quality capture tier (same media model, `quality_tier=museum`)
- [ ] Store constraints on same engine as VIP
- [ ] One cooperative store pilot metric

### J. Data foundation leftovers

- [ ] Schema review (Opus) before treating Phase 1 as fully closed
- [ ] Live comps adapters — **code shipped idle** (see L); leftover is wiring ranges onto comics/TCG grids + `vault_market.sale` persist (plan 0002 W2)
- [ ] Liquidation-ready valuations: ranges + evidence count + recency + confidence end-to-end

### K. DevEx / ops leftovers

- [x] Reliable one-shot VIP stack launcher (`Launch IQVault.bat` → Docker/Postgres/migrate/VIP/Comics/Orchestr8/web; restarts stale listeners) — 2026-08-09
- [x] Double-click / Dev Environment **[A]** wait-for-`:3000` + empty-`%*` PowerShell 5.1 fix (PR #27, 2026-08-14)
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
- [x] **Live comps adapters.** eBay sold + TCGplayer market adapters shipped
      2026-08-09 (`services/api/src/lib/comps/`). Idle without credentials /
      network — never fabricate. Wire `EBAY_OAUTH_TOKEN` for comics sold comps.
- [ ] **Verification debt.** 2,684 of 2,700 comics carry `Needs Verification` (mostly
      raw books with `NM assumed`). Needs a burn-down path, not a silent accept.

---

## Deferred ideas (no freeze — just not prioritized)

Formerly “Parked.” Safe to pick up via Build Spec when wanted; still high-cost / out-of-core:

- Comics Ask → Watch / Theses: from Analytics answers on `/collections/comics`, one-click populate watchlist rows or thesis drafts (keep provenance; never silent fill-in)
- Port full TeamOrchestrationPanel (provider/role/model picker modal) from archived `iqvault/` into `AnalyticsChat`
- In-Orchestr8 build harness (write/execute tools) — superseded by Cursor builder (ADR 0003); keep deferred unless autonomy model changes
- Orchestr8 semi-autonomous / fully autonomous build modes (writes/tests/commits)
- AI glasses / wearable interface
- PSA → CGC/TAG crossover ML
- Full POS & event management
- Marketplace listing automation *(scan path queues eBay drafts idle without tokens; live submit still deferred)*
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
- [x] ADR 0005 — Binder SQLite now, Postgres later (**superseded by ADR 0007**)
- [x] Postgres Binder + durable VIP holdings (`vault_tcg`, `source=binder_vault`) — ADR 0007

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
- [x] CLZ inbox sync job (`npm run job:clz-sync`) — XML drop → raw_snapshots + holdings reconcile (`dropped_at`)
- [x] Comics terminal CLZ buttons + XML drop zone (`POST /api/comics/inbox` → same inbox folder)

---

## Open ideas

_Add new ideas here freely. No milestone sorting required._

- Sources registry API + IQVault Sources editor (re-run Build Spec — prior veto was freeze-only)
