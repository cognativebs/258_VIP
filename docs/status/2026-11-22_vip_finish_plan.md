# VIP finish plan — 2026-11-22

The to-do list for getting VIP fully running, built from `docs/backlog.md`, the
2026-10-17 progress checklist, every unmerged branch, and an audit of each open
backlog item against the code. Everything Claude could finish without you is on
branch **`claude/vip-finish-2026-11-22`** (worktree `D:\Projects\Business_Ideas\258_Labs\258_VIP-finish`).
Nothing is merged to `main`, nothing is pushed, and the live database was not touched
(all testing ran on a throwaway Postgres on port 5433).

**Key:** ✅ done on the branch · 🔄 done, needs your review · 🧑 needs you (operator action) · ⛔ blocked on an outside party · 💤 deliberately parked

---

## 1. Land the work that was stranded on branches

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Launcher starts Docker Desktop when it is down (`fix/launcher-docker-autostart`) | ✅ | Same change that was sitting uncommitted in the signals-spine folder |
| 1.2 | CovrPrice comics guide price, ranked first for VALUE (`cursor/comics-covrprice`, E4) | ✅ | Migration `20261101_01`. You still run the load: `python scripts/comics_guide_prices.py covrprice --file <CLZ Cloud CSV>` |
| 1.3 | Card identification v2 Build Spec + golden set (`cursor/scan-id-v2-spec`) | ✅ | Docs only; building v2 is §4.1 |
| 1.4 | VIP ingest v1 + five-concept shell (`cursor/vip-ingest-v1`, ADR 0014 / 0015) | 🔄 | Conflicts resolved, see §6 Q1–Q3. Migrations `20260923_01/02` |
| 1.5 | Fix two tests that started failing on their own (dates pinned to August aged out of the comps window) | ✅ | |
| 1.6 | `/portfolio` called a helper the ingest branch never committed | ✅ | Counts needs-verification the way the old home did |
| 1.7 | Classic pages index (`/classic`, header link) so the old tab-bar pages stay reachable | ✅ | Kept until each page moves into a concept (Q2) |
| 1.8 | Already on main, branch can be deleted: `cursor/signals-espn-sports`, `cursor/hunt-midnight-universe`, `cursor/ebay-production-location-job-f536`, `cursor/analytics-team-council-9666`, `cursor/council-credit-pause-resume-058c`, `cursor/save-named-councils-058c`, `cursor/ma-finish-orchestr8-058c` | 🧑 | Delete when you're happy (Claude did not delete branches) |
| 1.9 | Superseded, do not merge: `cursor/comicbase-inventory-rebuild` (ComicBase retired, CLZ stays — ADR 0016) | 🧑 | Delete or keep as history |
| 1.10 | Parked idea branch: `cursor/viture-v1-orchestr8-master-prompt-058c` (AI glasses — deferred idea) | 💤 | |
| 1.11 | Local `main` is 200+ commits behind `origin/main` (`live-main` is current) | 🧑 | `git checkout main && git merge --ff-only origin/main` when convenient |

## 2. Code Claude built for this pass

| # | Backlog item | Status | Branch |
|---|---|---|---|
| 2.1 | Intelligence store on the `vault_core` tables (O): Postgres store behind the same interface; every response names the store that answered; triggers still guard predictions. `VIP_INTELLIGENCE_STORE=json` (**default, today's behaviour**) / `auto` / `postgres`. Import: `npm run intelligence:import -w @vip/api -- [--file] [--dry-run]` (idempotent, never edits the JSON) | 🔄 merged, opt-in | `claude/intel-store-pg` · Q18–Q21 |
| 2.2 | Prediction resolution (O): `GET /api/intelligence/predictions/due` reads `prediction_needs_scoring`; resolve form on `/intelligence` (you enter the checked price; nothing auto-resolves); read-only daily `intelligence-due` count in the jobs scheduler | 🔄 merged | |
| 2.3 | Scan bulk review on `/scan` (F): **Add all high-confidence to confirm list** (auto band + HIGH review-band cards, skips already-held; stages only; Approve still blocks duplicates) and **Reject all no-match** (asks first; status change, nothing deleted). Refused on `committed` batches | 🔄 merged; Q7–Q9 built | `claude/scan-bulk-sources-ui` · Q10–Q11 open |
| 2.4 | Sources editor on `/sources` (D): per-source toggle + signal count, quarantine rate, evidence count; banner says it changes the job-feed registry only, not news sources | 🔄 merged | Q12 |
| 2.5 | Scheduled daily Binder price refresh (E) — shared `syncBinderGuidePrices` in `@vip/pricing`; `npm run job:binder-price-refresh -- [--dry-run] [--binder <id>]`; scheduler runs it daily **by default** (`VIP_BINDER_PRICE_REFRESH=off` stops it) | ✅ merged | `claude/binder-refresh-evidence` · Q5 |
| 2.6 | `@vip/evidence` inside Binder (E) — shared verification enum + one shared mapping (`fromBinderProvenance`); Binder → VIP writes now carry provenance | ✅ merged | Q6 |
| 2.7 | Admin spend keys docs (K) — `docs/how-to/05-orchestr8-env-keys.md` | ✅ merged | |
| 2.8 | Sell-queue dogfood (A): `GET /api/sell-queue/dogfood?limit=N` — action, confidence, reasons, provenance block (source, method, rule version, evidence count, recency; always unverified); no sales → no range + "Insufficient market evidence". Shown in **OPERATE → Sell**. Grading cost from `VIP_GRADING_COST_USD` → `gradingCostUsd` in user-constraints → 25 USD default (labelled an assumption) | 🔄 merged | `claude/sellqueue-verification` · Q15–Q16. Accept/reject mark **not built** (Q16) |
| 2.9 | Comics verification queue (L): `GET /api/comics/verification-queue` (highest guide value first, then key issues, then oldest); **`/vault/review`** (VAULT rail) with burn-down counter and one-click Verified / Still needs review / Undo. No bulk verify | 🔄 merged | Q13, Q14, Q17 |

## 3. Backlog items that were already done (backlog was stale)

| Item | Evidence |
|---|---|
| Hunts still seed data → Postgres | `services/api/src/lib/huntStore.ts` serves `vault_hunt` |
| Hunt completion % vs shelf | `services/api/src/lib/huntShelf.ts` |
| Binder price sync writes `price_snapshot` | `apps/binder-vault/src/lib/repo.ts` `insertGuideSnapshot` (the comment in migration `20260816_01` saying "never written to" is stale) |
| Full TCG holdings in VIP, not just 5 seeds | `services/api/src/app.ts` merges every owned Binder slot; seeds only with `VIP_INCLUDE_POKEMON_SEEDS=1` |
| Per-page binder chase | `services/api/src/lib/binderPageChase.ts` (checklist row still said 0) |
| TCG + comics in one grid | The new shell's **VAULT** screen (`/vault`) is one grid over `/api/inventory` with Comics / Pokémon / Sealed / Other pills (lands with 1.4) |

## 4. Bigger builds still open (code, no operator needed to start)

| # | Item | Size | Note |
|---|---|---|---|
| 4.1 | Card identification v2, Pokémon first (spec `docs/specs/scan-id-v2-pokemon.md`) | L | Your decisions P1–P4 are in the spec; the 5 unconfirmed golden identities need you first (§5) |
| 4.2 | Shell follow-ups: OPERATE sub-pages are empty states; search palette is a stub until an entity layer exists (ADR 0014) | L | Move each `/classic` page into its concept, then retire `/classic` |
| 4.3 | GDELT radar B1.20–B1.25 (Events, GKG entities, BigQuery history, emergent phrases, attention velocity, narrative clustering) | L | B1.11 article fetch needs a terms decision (§5) |
| 4.4 | Stock indices from FRED (market-data track, outside the SIGNALS spine) | M | |
| 4.5 | Source weighting from member specialty + Brier calibration (PokéBeach item 7) | M | Mostly blocked: member activity is behind Cloudflare |
| 4.6 | Phase 2 market-cycle / buy-opportunity scoring | M | Gated on `signals_raw` / `signals_normalized` confirmed live — your call |
| 4.7 | Mobile Show Mode (≤4 taps, offline, <8 s) | L | API side exists (field sessions → underwriting); no mobile UI |
| 4.8 | Sports catalog (CardSight, metered) + 100–250 card benchmark; parallel disambiguation | L | Needs a CardSight key |
| 4.9 | eBay ePID as `external_id` → listing prefill | M | PriceCharting CSV carries `epid` |
| 4.10 | VaultOS pilot: museum capture tier, store constraints, one store pilot metric | L | Product decisions first |
| 4.11 | Multi-game TCG schema v2 | L | Blocked on the §2 D1/D2 decisions in `docs/proposals/2026-08-19_vault_tcg_schema_plan_v2.md` |

## 5. Things only you can do

**Quick commands (minutes):**
- Enable the two official Pokémon channels: `npm run news-source -- enable pokemon_official_youtube --confirm-operator` and `npm run news-source -- enable pokemon_card_jp_youtube --confirm-operator`
- Run one analysis yourself from the Orchestr8 Analysis tab (closes the Analysis gate)
- Load CovrPrice values once 1.2 is merged (command in 1.2)
- Retire the failing `VIP Comics Guide Snapshot` 03:00 Windows task and the branch `cursor/pricecharting-core-wiring-f536`

**Reviews (an hour or so each):**
- Pokémon identification gate: confirm / correct the 25 cards of batch `ed919c12` in Review, then `python scripts/score_scan_identification.py` (also confirms the 5 open golden identities for 4.1)
- Comics `vendor_product_map` confirm pass (nothing below 0.90 auto-confirms)
- Work the new verification queue (2.9) a few books a day
- Sell-queue trust: accept / reject the top 20 (2.8) — and a 7-day dogfood vs spreadsheets
- Schema review (Opus) before calling Phase 1 closed

**Physical / data:**
- 25 real Magic scans (Scryfall/MTGJSON gate, top-1 ≥ 85%)
- Fresh CLZ export into VIP (the live comics inventory was emptied 2026-10-25 for a fresh upload)

**Decisions / outside parties:**
- PokéBeach: ask for feed access (Cloudflare blocks VIP; never worked around)
- SEC EDGAR lane: a contact email for the SEC User-Agent + the company list
- Finance newsletters lane: Gmail read-only label (Gmail connector is not authorized) or a forwarded-email folder
- GDELT B1.11: may VIP fetch original articles (robots, excerpt only)?
- Sold comps (comics + Pokémon): eBay Marketplace Insights application — unlocks `vault_market.sale`, withheld Buy/Sell/Grade, High Conviction, liquidation-ready valuations
- Gold / silver: pick a licensed free source
- SportsCardsPro licence before anything customer-facing
- eBay Production listing: OAuth + policy IDs (Sandbox works)
- Merge Binder into the web app or keep two apps
- ShopVault stays on hold (owner 2026-10-18)

## 6. Questions for you

Filled in as each track reports; the first three come from landing ingest v1.

- **Q13 — CLZ re-import overwrote verification — ✅ fixed (owner said yes, 2026-11-22).** `load_comics.py` now keeps `needs_verification`, `verification_notes` and the verification keys in `clz_metadata` on any row a person has marked (it carries "Verification Marked At"); unmarked rows still take the export's values. Test: `tests/test_clz_reimport_keeps_verification.py`. Limits: clicks made before 2026-11-22 carry no stamp, so they are not protected until clicked again; the Binder push (`services/api/src/lib/binderWrite.ts`) has the same overwrite, but VIP has no Binder verification click yet.

- **Q1 — `/signals` — ✅ answered: OK (owner, 2026-11-22).** Keep as built. ADR 0014 makes `/signals` the new shell view and moves the old feed to `/signals-feed`. Main's Signals page had grown a lot since (daily lists, Pokémon SIGNALS, Evaluate in Orchestr8), so all of that now lives at `/signals-feed`, linked from `/classic`. OK, or should the shell's SIGNALS view absorb those sections?
- **Q2 — Classic pages — ✅ answered: yes, keep `/classic` until each page moves into a concept (owner, 2026-11-22).** With the old tab bar gone, `/classic` (header link "Classic") is the only way to reach Signal Desk, Scan, Tools, Hunts, eBay, etc. Keep it until each page moves into a concept (4.2)?
- **Q3 — Batch `ed919c12` lifecycle.** Ingest v1's migration marks that batch `abandoned` (your G-1 decision, 2026-09-23). Its identification status stays `review`, and `/scan` does not filter by lifecycle, so the batch stays reviewable. Confirm that's still what you want now that it is the gate batch.
- **Q4 — Binder daily refresh default.** Off unless `VIP_BINDER_PRICE_REFRESH=on`. Turn it on by default? (It never calls PriceCharting itself; it reads the guide `pokemon-prices` already stored, through the VIP API on `:8787`, so it needs the API running — acceptable, or read the DB directly?) **✅ Answered (owner, 2026-11-22): reading through the VIP API is acceptable; on by default.** Done: `VIP_BINDER_PRICE_REFRESH=off` now stops it.
- **Q5 — Rarity on scheduled runs — ✅ answered: fine, keep as built (owner, 2026-11-22).** The job skips Binder's local card index, so rarity only fills where a manual Sync Prices already did. Fine?
- **Q6 — Binder → shared provenance mapping — ✅ answered: yes, yes (owner, 2026-11-22). Done:** the mapping moved into `@vip/evidence` (`fromBinderProvenance`, used by Binder and by VIP); every Binder → VIP write now stores the card's provenance on the holding (`clz_metadata.provenance`, no new column) and the wishlist row uses the real method / confidence instead of a fixed `observed` / 0.7. A slot with no recorded method maps to `inferred`, never `observed`. Write rule `binder-vip-write@0.2.0`. `api` / `user_upload` map to `observed`; a missing model version becomes `binder-vault:unversioned`; a missing confidence becomes 0 (band low, with a note). Nothing sends the mapped provenance to VIP yet — should Binder's VIP write path send it?
- **Q7 — "Add all auto" is empty by default — ✅ answered: yes, built (owner, 2026-11-22).** The button (now "Add all high-confidence") also takes unresolved review-band cards that clear the auto-resolve HIGH bar (≥0.9, margin ≥0.15, collector-number/external-id match), whatever `VIP_SCAN_AUTO_RESOLVE` says. Still only stages. Was: A card only lands in the `auto` band when `VIP_SCAN_AUTO_RESOLVE=1`. Should the button also take unresolved HIGH-confidence cards?
- **Q8 — Already-held cards — ✅ answered: yes, skip them, built (owner, 2026-11-22).** Skipped with reason `already_held`; the result lists them by name; add a real second copy one card at a time. Was: Add all auto still stages cards that look already owned and leaves the duplicate warning to Approve. Skip them instead?
- **Q9 — Reject all no-match and `needs_review` — ✅ answered: yes, keep the split (owner, 2026-11-22).** Was: It includes no-match cards flagged `needs_review` (almost all are) and rejects them without clearing the flag; it skips cards with a front/back pairing doubt (swapping faces might identify them). Right split?
- **Q10 — Abandoned batches.** Bulk actions are refused only on `committed` batches. Refuse on `abandoned` too? (Note batch `ed919c12` is `abandoned` — see Q3.)
- **Q11 — Reject reason.** There is no column for it, so it is still discarded. Store it (one new column)?
- **Q12 — Sources with no reader.** Only `pokemon-news-rss`, `retail-drop-watch` and `ebay-browse` have a job that reads the toggle; toggling the other three does nothing yet. Label them on the page?
- **Q14 — "Verified this week".** Both verification write paths now add a "Verification Marked At" timestamp inside `clz_metadata` (no new column). OK, or a dedicated column?
- **Q15 — Default grading cost.** Is 25 USD per book right?
- **Q16 — Sell-queue accept / reject mark.** Not built: `disposition_history` would also move the eBay sell engine's current disposition, and `inventory_transaction.kind` only allows buy / sell / transfer. Put it in `disposition_history` (as which disposition?) or a new decision-log table?
- **Q18 — Intelligence store switch-over.** Claude left the default on JSON, because in Postgres mode (a) rows only in the JSON file are hidden until imported and (b) predictions / cycle rows / golden cases must name a real `vault_core.asset` UUID (grading a real holding), so the desk's free-text keys like `mega-greninja-ex-sir` get a 400. Plan: run the import dry-run, then set `VIP_INTELLIGENCE_STORE=postgres`. Want an asset lookup by name/slug first, so free-text keys keep working?
- **Q19 — `auto` vs `postgres` once switched.** `auto` writes to JSON while Postgres is down (data splits until re-import); `postgres` refuses with a 503. Recommended: `postgres`.
- **Q20 — Field capture ↔ underwriting link.** Stored as a `[field_capture:<id>]` tag in `acquisition_underwriting.notes`. A proper column needs a migration. Want it?
- **Q21 — Provenance on intelligence rows.** These tables have no provenance columns; provenance is rebuilt at read time (rule version shown is today's, not the one at write time). Add provenance columns?
- **Q22 — Shell redirects (important).** Ingest v1's `next.config.ts` redirected `/collections/*` (Comics and Pokémon terminals), `/scan`, `/intelligence`, `/sources`, `/signals-feed`, `/hunts`, `/theses`, `/ebay`, `/sell-queue` and more into the five concepts — but ADR 0014 says those pages stay reachable by URL, and most targets are still empty states. Left on, they would hide everything built in this pass (bulk scan buttons, Sources editor, resolve form). Claude kept the list but it is **off unless `VIP_SHELL_REDIRECTS=1`**. Turn it on per page as each concept absorbs its page (4.2)?
- **Q17 — Guide ranges in the shell.** Vendor-guide ranges show as low confidence with a "guides" label in ValueRange. OK?
