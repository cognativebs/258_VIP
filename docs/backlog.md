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

**Intelligence core (2026-08-18):** the work stranded in the second `IQVault`
clone on branch `orchestr8-first-o0` is now on `main` in five reviewed PRs:
`@vip/intelligence` package, `vault_core` migrations `20260815_11..16`,
`/api/intelligence/*`, the `/intelligence` desk, and vertical-aware Ask prompts.
Phase 2 (market cycle / buy-opportunity scoring) stays **manual-only** — it is
gated on `signals_raw` / `signals_normalized` being confirmed live, and every
endpoint reports `scoringEnabled: false` until then. The manual intelligence
store still writes JSON (`VIP_INTELLIGENCE_STATE`); moving it onto the new
Postgres tables is the next step.

**Progress checklist (2026-10-04):** POC / Testing / Production percentages per task — [`docs/status/2026-10-04_vip_progress_checklist.md`](status/2026-10-04_vip_progress_checklist.md).

**Historical sequencing (no longer binding):** ADR 0002 Orchestr8-first; ADR 0003
autonomy 0 (Orchestr8 authors specs; Cursor builds).

---

## Remaining work (snapshot 2026-08-02)

Detailed inventory of what was left incomplete when the freeze/milestones were removed.
Grouped by area. Checkboxes are unfinished unless marked done.

### A. Orchestr8 — Collection Analysis (partial)

Started as owner unlock; thin slice shipped; gates incomplete.

- [x] Console **Analysis** tab — inventory load (VIP `:8787` first, Comics `:5200` fallback)
- [x] Compact context builder + Analysis Council / Comics VIP presets
- [x] Proxies: `/api/comics/*`, `/api/vip/*`
- [ ] **Gate:** Analysis tab loads inventory + one SSE run persists to Runs (operator-verified). Code path shipped 2026-08-25: snapshot provenance, zod on live `/v1/runs`, Runs auto-refresh after a persisted `runId`. Still needs operator dogfood.
- [ ] Challenge Council second pass on high-dollar slices (optional path in Console)
- [ ] Richer inventory filters (pillars / workspace parity with legacy IQVault analytics)
- [x] Evidence-backed market ranges in analysis context (VIP `/api/recommendations?holdingIds=` → per-highlight `market`; idle adapters stay insufficient — never fabricated). Sold-ledger persist to `vault_market.sale` is still open.
- [ ] Persist **sold** comps into `vault_market.sale` / `market_value`. Browse listings go to `listing_observation` (P1, 2026-08-28) — not `sale` ([plan 0003](plans/0003-comics-comps-vault-ingest.md) C1).
- [x] **Comics comps vault walk** (plan 0003 Track A / P1): `vault_market.listing_observation` + `npm run job:comics-comps`. Batch 12, Marvel/DC default, pause/resume, raw snapshots. Analysis cap unchanged.
- [x] **Collection Tab LIVE range column** (plan 0003 Track B): range + listing count + recency + unverified beside CLZ VALUE; never overwrite `current_price_snapshot`. Reads `listing_observation`. (Week 1 · 2026-08-29)
- [x] **Signals slice in Analysis / Comics Ask context** (feed exists; Orchestr8 does not ingest it) — plan 0002 W1 (Week 1 · 2026-08-29)
- [ ] Sell-queue dogfood path: top-N liquidate advice tied to decision-engine + provenance

### B. Orchestr8 — Console UX polish

- [x] App on `:3001`, Team / Build Spec / Runs / Specs
- [x] Runs panel human-readable summary (verdict / steps; raw JSON optional) — 2026-08-02
- [x] Keep-alive tabs + session store (switching tabs does not kill a live council)
- [x] Always-visible Council Strip (roles · provider · model; click for skill blurb)
- [x] Progress dock: role status bar, elapsed, live highlights, Stop
- [ ] Gateway `step_start` events (so dock can show “calling model” before first token)
- [x] Create an agent role from the Team panel (name / description / skills → live card; `POST /v1/agents`, auto contract, unverified provenance) — 2026-08-21
- [x] Edit name / description / skills on any Team-panel card (`PATCH /v1/agents/:id`; shipped roles overlay into `custom_agents/`) — 2026-08-21
- [ ] Delete custom roles from the Team panel (today: delete the folder under `custom_agents/<id>/` + `POST /v1/reload`)
- [x] Save a named custom council from the team panel (prompt on Save team → selection button + edit/delete; `POST/PATCH/DELETE /v1/councils`) — 2026-08-23
- [ ] Promote a custom role to a shipped agent (council membership + reviewed contract, so it leaves `unverified`)
- [x] Surface `buildSpecPath` / Specs link prominently after approved Build Spec emits — Open Specs + Revise from veto (1×) (2026-08-02)
- [x] Build Spec attach files / repo paths + council chat transcript + copy .md / JSON / Cursor prompt (2026-08-23)
- [x] Credit/billing pause mid-council: detailed alert, persist completed steps, resume retries only the failed role (2026-08-23)
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
- [x] Basic Signals output on `/signals` (bucket-aware Hold / Review / Churn — never a price) — Week 1 · 2026-08-29
- [ ] IQVault Sources editor UI (toggle + stats) — API ready; thin editor still optional
- [ ] Prediction ledger / Brier calibration visible on Signals page
- [x] Real RSS adapter for `pokemon-news-rss` (fixture offline; live via `VIP_POKEMON_NEWS_RSS_URL`) — retail stub remains
- [x] Signals feeding decision-engine as evidence (`signalsToEvidenceRefs` + recommend bridge)

#### SIGNALS source groups *(operator request 2026-10-01; grouping chosen by Claude, decisions by Greg)*

News sources (`vault_core.signals_news_source`; never set a price) are kept apart from market-data sources (ADR 0013 HS-3).

- [x] **Sports**: ESPN NFL, college football, soccer, NBA, MLB; daily list 80/10/5/5, NBA + MLB framed as exit sports (`daily-sports`)
- [x] **Collectibles news**: ComicsBeat, PokeBeach, PSA, TAG, Alpha Investments (YouTube, opinion) wired on fixtures; `collectibles-headline` classifier; `daily-collectibles` list (comics 40 / Pokémon 35 / grading 15 / creator 10, starting shares · unverified)
  - [ ] Operator: confirm each feed URL + terms (Alpha Investments channel ID, whether PSA/TAG publish a feed; no scraping), then enable per source
- **PokéBeach hybrid connector** *(operator build spec 2026-10-03; mapped onto ADR 0013: three stored scores, read-time priority, no 0–100 strength column)*
  - [x] 1. Official homepage ingestion (`pokebeach official`, every 30 min + jitter; identity and UTC time from each article page; polite fetching, conditional GET, backoff; parser-degraded ingests nothing)
  - [x] 2. Canonical dedupe (`source_item` per canonical URL + WordPress post id; `source_item_revision` history; daily 48h `reconcile`; `backfill --days 90`; community feed + forum RSS are discovery only)
  - [x] 3. Tracked-member configuration (8 members, per-specialty weights in `signals_source_author`; `pokebeach members set|check`)
  - [ ] Operator: confirm PokéBeach terms, enable `pokebeach_official` (+ discovery feeds), run backfill; supply member profile URLs and run the access check
  - [ ] 4. Public member activity ingestion: only if the access check passes (forum pages answered 403 to an automated fetch on 2026-10-03; never bypass)
  - [x] 5. Pokémon entity extraction (`pokebeach extract`, also after each scheduled poll): species → national Dex, sets → `vault_pokemon.set` / Binder names, cards by suffix/Mega, products by pattern; quoted set names learned without an identity; text placeholders until the entity layer (P7)
  - Homepage-only mode since 2026-10-03 (article pages answered 403): titles only, inferred Pacific times; `VIP_POKEBEACH_ARTICLE_PAGES=on` restores article pages
  - [x] 6. Clustering onto spine events (`pokebeach cluster`, also after each scheduled poll; decisions 2026-10-04): items classified by `collectibles-headline` rules; a signal joins the earliest event of the same type sharing a set or card reference within 72h (species and product-type refs never cluster), first event wins and nothing moves; official news is one independence group per outlet, members one per handle, comment threads are DISCUSSION. `event_evidence.source_item_id` (migration `20261004_01`)
  - [ ] Cross-source clustering (run the entity extractor over PSA / TAG / Alpha Investments / GDELT business headlines so another outlet can corroborate PokéBeach) — `items index` (manual) already writes ComicsBeat / Alpha Investments / GDELT business items; the read-time cross-outlet clusters were retired 2026-10-04 in favour of the stored events above
  - [x] Pokémon themes: `collectibles-headline@0.2.0` (current) adds CARD_REVEAL, PRODUCT_REVEAL, PREORDER, PULL_RATE, PROMOTION, COMPETITIVE; 13 of 16 live PokéBeach titles now carry a theme (was 1); migration `20261004_02`
  - [ ] 7. Source weighting (member specialty weights + prediction-ledger calibration)
  - [x] 9. Signals synthesis, read-time over the cluster job's stored events (reworked 2026-10-04 after #98): official factual articles stand alone, card reveals and chatter need a cluster of 2+ articles, competitive never surfaces; bands read-time from `pokemon-synthesis@0.1.0` (migration `20261004_03`; High Conviction needs 2+ sources); writes nothing; `GET /api/signals/synthesized` (each signal says whether and why it surfaces); "Pokémon SIGNALS" on `/signals`
  - [x] 10. Orchestr8 handoff: read-time proposals per synthesized signal (`signal-proposal@0.1.0`, repo vocabulary Buy/Hold/Grade/Sell/Lot/Pass + Watch; spec actions as tags research / binder target / hunt target / sealed target); exposure from Binder owned/wishlist + Pokémon hunts; Buy/Sell/Grade always withheld until market data exists; proposals + exposure in `/api/signals/context` for Orchestr8 councils; "Evaluate in Orchestr8" link on Strong+ signals opens the console Analysis tab with the question prefilled (operator presses Run)
  - [ ] 8. Community Pulse UI (needs member activity) · market confirmation (sold comps) to lift withheld Buy/Sell/Grade and High Conviction
- [x] **Headlines (US, World)**: GDELT lanes `us` / `world` on fixtures; `macro-headline` classifier; `daily-headlines` list (US 60 / world 40, starting shares · unverified)
- [x] **Markets & business news (GDELT lane)**: GDELT `business` lane (collectibles companies, marketplaces, markets); `daily-markets` list
  - [ ] Operator: `npm run news-source -- enable gdelt_doc_v2 --confirm-operator`, then a first live run to confirm the `sourcecountry` filters split US / world as intended
  - [ ] SEC EDGAR filings lane (row exists): needs a contact email for the SEC User-Agent and a confirmed company list
  - [ ] Finance newsletters lane (rows exist): needs Gmail access for the job (Google OAuth, read-only label), or a forwarded-email inbox folder
- [x] `news-source list | enable <key> [--endpoint] --confirm-operator | disable` operator command; collectibles-news and macro-news run hourly in the scheduler (blocked until enabled)
- [ ] Re-classify command (a document once `extracted` is not re-read when rules or the LLM choice change)
- [ ] **Retail drops (Pokémon Center, Target) and Whatnot**: no public feed and scraping is forbidden; news reports (PokeBeach) + operator manual entries, both labeled by source
- [ ] **Market data (separate track, outside the SIGNALS spine)**: stock indices from FRED; gold/silver wait for a licensed free source (FRED no longer carries LBMA metals); eBay asks exist, sold access restricted; TCGplayer API closed (no adapter); PSA/TAG population reports

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
- [x] TCG + Sports collection tabs (`/collections/pokemon`, `/collections/sports`) — Pokémon is live Binder holdings; Sports is a stub; CLZ XML drop zone live on Comics
- [x] Richer hunts explorer on VIP `/api/hunts`; Vite `iqvault/` proof archived
- [ ] **TCG + comics in one Bloomberg grid** (explicit gap; see [`docs/how-to/02-tcg-in-bloomberg-view.md`](how-to/02-tcg-in-bloomberg-view.md))
- [x] Collections hub + first-class Pokémon collection page (`/collections`, `/collections/pokemon`) so comics is not the only collection — 2026-08-10
- [x] Scan intake in IQVault (`/scan` + `POST /api/scan/import-folder`) — no curl to start/import a batch — 2026-08-10
- [x] **ADR 0011** sports vs TCG OCR profiles + Football/Baseball/Soccer/Basketball/Pokémon/Magic/One Piece identifying mechanics — 2026-09-07
- [x] **ADR 0009** identity staging — candidates as rows; canonical inventory written only at resolve — 2026-08-10
- [x] Confidence bands + opt-in auto-resolve gate (margin + identity-grade reason + no duplicate) — 2026-08-10
- [x] Catalog adapter seam (`CatalogAdapter`) so the fixture catalog is swappable — 2026-08-10
- [ ] Bulk review actions (confirm all `auto`, reject all `none`)

### O. Intelligence core *(landed 2026-08-18 · PRs #41–#45)*

- [x] `@vip/intelligence` — prediction ledger, evidence engine, underwriting, grading EV, binder goals, synergy, identification contracts, Cohen scoring, print life, emerging markets (25 tests)
- [x] `vault_core` migrations `20260815_11..16`, applied and acceptance-tested against Postgres
- [x] `/api/intelligence/*`, `/api/hunts/emerging`, `/api/sell-queue/dogfood`
- [x] `/intelligence` desk on the collector face; vertical-aware Ask prompts
- [ ] Move the manual store from JSON (`VIP_INTELLIGENCE_STATE`) onto the `vault_core` tables
- [ ] Resolution workflow driven by `vault_core.prediction_needs_scoring` (nothing polls it yet)
- [ ] Per-page binder chase completion from `vault_tcg` (API reports `available: false`)
- [ ] Phase 2 scoring — blocked on `signals_raw` / `signals_normalized` being confirmed live

### N. Catalog + market adapters *(ADR 0010 · [plan](plans/0001-catalog-adapter-rollout.md))*

Ordered so the metered provider is not the first dependency. Yu-Gi-Oh and
SportsCardsPro are out of scope this round (the latter also has a
third-party-access licence limit).

- [x] **Phase 0** `CatalogResolver` fan-out + merge on `external_id` corroboration
- [x] **Phase 0** Identification cache keyed on `raw_snapshots.content_hash` (re-runs cost zero calls). Timeouts / fixture-only misses are not persisted (2026-09-07).
- [x] **Phase 0** Snapshot every provider response before parsing (rule 3)
- [x] **Phase 0** Wire `vault_market.id_observation` (exists, unused) — predicted vs confirmed
- [x] **Phase 0** Benchmark harness: top-1 / parallel / card-number accuracy, calibration, failure rate
- [x] **Phase 1** `TcgdexCatalogAdapter` is the live Pokémon catalog (5-card fixture is `VIP_CATALOG_FIXTURE=1` only, 2026-09-07). Pokémon OCR now lifts species / trainer title + `NNN/NNN` before TCGdex; empty misses without a name are not cached (`catalog-resolver@0.3.0`). **Gate open:** 25 real scans, top-1 ≥ 80%, every candidate has `tcgdex` id. Re-identify batch `ed919c12-4634-439f-b7b6-28d98fa328f3` after pull + API restart.
  - 2026-10-10: TCGdex lookups no longer lose cards to HTTP errors (retry, not cached), number-only `NNN/TTT` scans find their set, every candidate carries a set name; vision (`gpt-4o-mini`) on when OCR is incomplete. Batch `ed919c12` re-identified: standalone trial 21 / 25 with candidates. **Gate still needs:** operator confirms / corrects the 25 in Review, then `python scripts/score_scan_identification.py`
- [ ] **Phase 2** `ScryfallCatalogAdapter` + MTGJSON local mirror — **adapters shipped 2026-09-07;** gate open: 25 Magic scans, top-1 ≥ 85%, offline when `VIP_MTGJSON_PATH` is set
- [ ] **Phase 3** `CardSightCatalogAdapter` (sports, metered) + 100–250 messy-card benchmark
- [ ] **Phase 3** Parallel disambiguation if exact-parallel accuracy misses target
- [ ] **Phase 4** `cardHedgeAdapter` in comps — ranges only, idle without key (rule 4)
- [ ] **Phase 4** Persist **sold** comps into `vault_market.sale` → `market_value` (schema exists, unwired). Browse listings are not sales — plan 0003 C1.
- [ ] **Phase 5** eBay Catalog ePID as `external_id` → listing prefill
- **Pokémon FMV (PriceCharting guide, 2026-10-04 · ADR 0012 amendment)**
  - [x] `pokemon-prices` job (daily; `--dry-run`, `--limit`): Binder owned + wishlist cards and cards named in signals → PriceCharting match in `vendor_product_map` (one exact English set + number + name match auto-prices; variants, duplicates and other numbers go to `review`); raw responses kept in `raw_snapshots`; one `card_price_history` row per condition per day (ungraded = NM assumed · unverified; 7 / 8 / 9 / 9.5 any grader; PSA / BGS / CGC / SGC 10). Migration `20261004_04` widens the condition CHECK
  - [x] `GET /api/pokemon/fmv[?externalId=&windowDays=]`: range per condition over stored snapshots, snapshot count, recency, confidence ≤ 0.75 — guide values, never sold comps
  - [x] Operator review: `job:pokemon-prices -- review`, `-- confirm <externalId> [productId] --confirm-operator` (`confirmed_at` stays NULL — the registry locks confirmed rows to an `asset_id`, which cards lack until TCG D1/D2)
  - [x] PriceCharting registry landed on main (`20260917_01`, `20260920_02`, 2026-10-06), so a fresh database prices Binder cards too
  - Split with the nightly snapshot: the nightly CSV prices **asset-linked** items (comics + Pokémon singles that are assets) into `guide_price_observation`; `pokemon-prices` prices **Binder cards** (no asset until TCG D1/D2) into `card_price_history`
  - [ ] Pokémon **sold comps**: TCGplayer latest-sales and history endpoints return 403 (not worked around) — the existing TCGplayer price-history job is likely failing for the same reason. Card-keyed `sale` waits for a licensed source (eBay Marketplace Insights application)
  - [ ] Pokémon **asks** (eBay Browse → `listing_observation`): deferred by operator 2026-10-04
  - [ ] Feed FMV into signal proposals (market confirmation can unlock Buy/Sell/Grade)
- [x] Postgres asset catalog adapter (repeat scans converge on confirmed assets) — 2026-09-07
- [x] Re-identify staged units after a catalog upgrade (no re-scan needed) — `POST /api/scan/batches/:id/reidentify` (2026-09-07)
- [x] Analysis/insights panel on collector face (Orchestr8 chat ported; Analytics tab on `/collections/comics`)
- [x] Team/role picker for collector-face analytics (AI team / council panel on Comics Analytics) — 2026-08-09
- [x] Single inventory truth across Comics + Binder in Postgres (ADR 0007) — VIP API reads both; unified Bloomberg grid still open above
- **PriceCharting comics guide** *(built 2026-09-13 → 09-20 in the main folder's uncommitted work; landed on main 2026-10-06; plans [0004](plans/0004-pricecharting-core-wiring.md) / [0005](plans/0005-pricecharting-digital-tools.md))*
  - [x] Source registry + vendor product map (`20260917_01`, `20260920_02`), `guide_price_observation` adopted (`20260920_01`, ADR 0012), `listing_observation` is asks only (`20260920_03`; freshness reads browse rows only)
  - [x] Nightly CSV snapshot (`npm run job:pricecharting-snapshot`): gzip + hash-idempotent, one observation per mapped condition, `vendor_derived` ≤ 0.75. Windows task `VIP PriceCharting Snapshot` 05:00 (`scripts/schedule_pricecharting_snapshot.ps1`); raw gzips in `PRICECHARTING_SNAPSHOT_DIR` (git-ignored `data/raw/pricecharting/`)
  - [x] Phase D wave 1 cross-section (`ask_divergence`, `grade_premium_compression`) on `/api/signals/context`, confidence ≤ 0.75. `price_acceleration` / `lull` wait for 30 nightly snapshots. Phase 2 off
  - [x] Map-integrity rule, era-gap audit, first P(9.8) calibration set `p98_set_001` (`20260920_04`); operator CLIs `job:pricecharting-ops`, `-map-integrity`, `-era-audit`, `-comics-dry-run`, `-phase-b-write`
  - [ ] Comics `vendor_product_map` confirm pass (do not auto-confirm below 0.90)
  - [ ] Retire the failing `VIP Comics Guide Snapshot` 03:00 task and the superseded `cursor/pricecharting-core-wiring-f536` branch (operator)

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
- [x] Write-through from API store → Postgres `vault_media` + `vault_collection.holding` (resolve → dealer bucket + Sell)
- [x] Operator review UI (IQVault `/scan` + Batch 001 inspect on `/batch/001`) — 2026-08-29
- [x] Ricoh trading-card intake v1 — masters, front/back pairing, evidence fusion,
      base vs parallel confidence, HIGH/MEDIUM/LOW/CONFLICT, physical reimport,
      draft inventory, `/scan` front+back review (2026-08-30)
- [ ] Live catalog adapters (replace fixture sports/TCG matcher) — Pokémon (TCGdex) and Magic (Scryfall / MTGJSON) live; sports: SportsCardsPro adapter built, **off until the operator reads its terms** and sets `VIP_CATALOG_SPORTSCARDSPRO=1` (ADR 0010 amendment 2026-10-10); empty catalog answers keep the OCR candidate
- [x] Automatic Ricoh intake: new scan folders under `VIP_SCAN_INBOX` import themselves every 5 min (all images new + 2 min quiet; mixed folders skipped); `GET /api/scan/auto-intake` (2026-10-10)
- [ ] Museum-quality capture tier (same media model, `quality_tier=museum`)
- [ ] Store constraints on same engine as VIP
- [ ] One cooperative store pilot metric

### J. Data foundation leftovers

- **ComicBase as the comics inventory source** *(ADR 0016; .cbdb is encrypted and never read)*
  - [x] Watched-folder import of ComicBase Collection Reports (`npm run import:comicbase`; hourly in the launcher's jobs): raw snapshot (`comicbase_export`), parse, match to holdings, ComicBase key in `holding.provider_ids` (migration `20261006_01`)
  - [x] Review list `vault_collection.comicbase_item`: `npm run import:comicbase -- --review [--unmatched]`, `-- --confirm <item_key> <holding_id> --confirm-operator`; confirmed matches never move
  - [ ] Burn down the review list (176 items on 2026-10-06) and the 95 unmatched
  - [ ] When ComicBase holds the whole collection: flag CLZ-only holdings, create holdings for confirmed new ComicBase items, then retire CLZ (ADR 0016 decision 3)
  - [ ] Optional: a detailed ComicBase export (item id, grade, cost) to replace the report key
- [ ] Schema review (Opus) before treating Phase 1 as fully closed
- [ ] Live comps adapters — **code shipped** (auth on `main` via PR #69). Leftover is the vault walk + Collection LIVE column ([plan 0003](plans/0003-comics-comps-vault-ingest.md)), not an Analysis uncap. `vault_market.sale` persist stays blocked until sold (Insights) data exists.
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
      network — never fabricate. Operator path: `EBAY_APP_ID` + `EBAY_CERT_ID`
      in `services/api/.env` (client-credentials public `api_scope`; see
      [how-to 10](how-to/10-ebay-comps.md)). Browse observations stay unverified
      — not a sold ledger. Production deletion URL is live
      ([how-to 11](how-to/11-ebay-marketplace-deletion.md)). Full-vault walk is
      [plan 0003](plans/0003-comics-comps-vault-ingest.md).
- [ ] **Verification debt.** 2,684 of 2,700 comics carry `Needs Verification` (mostly
      raw books with `NM assumed`). Needs a burn-down path, not a silent accept.
- [x] **Unrecorded bulk giveaway.** July 2026 CLZ snapshot still lists ~2,700
      rows after an unrecorded ~1,000-book school-custodian gift. Collection-level
      `unknown_exit` records the fact as inferred · unverified (how-to 14). Does
      **not** DELETE or `dropped_at` titles we cannot name. Physical remaining is
      a range on General Inventory (~$3,640 of ~$24k), not a point value.

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
- Marketplace listing automation *(closed-loop Sell APIs + queue/lots shipped 2026-09-05; SKU/sold path persist + listing-state sync 2026-09-06; leaf-category fix verified against a real #25005 failure and republished live on Sandbox 2026-09-10 — offer 11591136010, listing 110590626616, comic category 259104. Sports/Pokémon/MTG leaves are still unverified against a real Sandbox tree; Production needs its own OAuth + policy IDs and has not been attempted)*
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
