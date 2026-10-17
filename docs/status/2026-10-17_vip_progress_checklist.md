# VIP progress checklist — 2026-10-17

Snapshot after the SIGNALS completion pass on branch `cursor/signals-complete`.
Re-scored from code and the live stack today: §1 ops rows, §3 "Feed FMV into
signal proposals", §5 SIGNALS (all rows), §7 prediction resolution, §8 merge
state. Other rows are carried over from the
[2026-10-04 snapshot](2026-10-04_vip_progress_checklist.md) unchanged.

**Bands:** **POC** = built and working on fixtures / dev. **Testing** = automated
tests pass and it has been checked against real data. **Production** = merged to
`main`, running unattended from the launcher, sources enabled, trusted for
decisions. Percentages are estimates. *Unmerged* = lives on a branch not in
`main` yet, which caps Production.

## 1. Platform & ops
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Postgres schema + migration runner | 100 | 100 | 90 | |
| Raw snapshots kept unchanged forever (rule 3) | 100 | 100 | 95 | |
| CI on every PR (build, typecheck, tests, Python) | 100 | 100 | 90 | |
| One-click launcher + Stop, incl. jobs scheduler | 100 | 90 | 85 | Merged; logon task restarts it after reboots (2026-10-17) |
| **Merge open branches to main** | 100 | 90 | 80 | Earlier branches merged (#99–#102 and others); `cursor/signals-complete` open |
| Docs for admin spend keys | 0 | 0 | 0 | |

## 2. Comics inventory
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Comics collection in Postgres (2,700 holdings) | 100 | 100 | 90 | |
| Comics Terminal (grid, filters, edits) | 100 | 90 | 80 | |
| **ComicBase as the inventory source** (ADR 0016) | 10 | 0 | 0 | Waiting on the first ComicBase export |
| ComicBase matching: keep history, review list | 0 | 0 | 0 | |
| Retire CLZ (drop zone, importer, CI gate) | 0 | 0 | 0 | After ComicBase lands |
| Verification burn-down (2,684 marked "Needs Verification") | 5 | 0 | 0 | |
| Asks: comics comps walk (eBay listing prices) | 100 | 80 | 60 | |
| "LIVE range" column on the Collection tab | 100 | 80 | 60 | |
| PriceCharting comics price guide (daily) | 90 | 50 | 0 | Unmerged branch |
| Sold comps for comics | 0 | 0 | 0 | Needs eBay Marketplace Insights |

## 3. Pokémon / TCG inventory
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Binder Vault on Postgres, writing to VIP | 100 | 90 | 80 | |
| Pokémon FMV from PriceCharting (ranges, confidence) | 100 | 80 | 30 | Unmerged; needs the registry branch |
| FMV match review / confirm | 100 | 70 | 30 | |
| Feed FMV into signal proposals | 100 | 85 | 80 | Guide range is evidence only (operator 2026-10-06) |
| Pokémon asks via eBay | 0 | 0 | 0 | Deferred by operator |
| Pokémon sold comps | 0 | 0 | 0 | Needs a licensed source |
| Full TCG holdings in VIP (not just 5 seeds) | 20 | 0 | 0 | |
| Scheduled Binder price refresh + saved price snapshots | 30 | 0 | 0 | |
| Multi-game TCG schema v2 | 10 | 0 | 0 | Blocked on D1/D2 decisions |
| Magic catalog (Scryfall + MTGJSON) | 100 | 30 | 0 | Needs 25 real Magic scans |
| Sports card catalog (CardSight) + benchmark | 0 | 0 | 0 | |
| TCG + comics in one terminal grid | 10 | 0 | 0 | |
| Shared provenance package inside Binder | 0 | 0 | 0 | |
| Merge Binder into the web app (optional) | 0 | 0 | 0 | |

## 4. Scanning & identification
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Ricoh scan intake + `/scan` review | 100 | 80 | 50 | |
| Pokémon identification check (25 scans, 80%+ correct) | 100 | 40 | 0 | |
| Live catalogs replace the fixture matcher | 60 | 20 | 0 | Pokémon live; sports not |
| Bulk review actions | 0 | 0 | 0 | |
| Museum-quality capture tier | 0 | 0 | 0 | |

## 5. SIGNALS
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Signals core (events, evidence, three scores, read-time priority) | 100 | 100 | 90 | |
| Sports: ESPN + classifier + 80/10/5/5 daily list | 100 | 95 | 85 | Rules-only classify runs after every ingest (operator 2026-10-10) |
| Collectibles news (ComicsBeat, TAG, Alpha live) | 100 | 90 | 75 | PSA feed found (official YouTube); one operator command enables it |
| Headlines US / World / business (GDELT DOC API) | 100 | 70 | 20 | Optional channel now: circuit breaker, 6 h probe; GDELT's legacy search is overloaded |
| **GDELT radar (GDELT 5 Web NGrams, local matching)** | 100 | 85 | 45 | Live 2026-10-17; watch registry + Tier A/B/C; Prod jumps on merge |
| PokéBeach ingestion + dedupe | 100 | 95 | 75 | Homepage Cloudflare-challenged since Oct 5; community-feed fallback stores new articles (2026-10-17) |
| Pokémon entity extraction | 100 | 90 | 85 | |
| Clustering into stored events | 100 | 90 | 80 | |
| Cross-source corroboration (outlets join Pokémon events) | 100 | 80 | 70 | Hourly items job |
| Pokémon themes (classifier 0.2.0) | 100 | 90 | 85 | Merged |
| Synthesis, bands, "why it shows" | 100 | 85 | 80 | Merged |
| Proposals + Pokémon FMV guide as evidence | 100 | 85 | 80 | Buy/Sell/Grade withheld until sold comps |
| **Daily Orchestr8 brief → Thesis** | 100 | 90 | 40 | Verified live 2026-10-17 (1 thesis stored); Prod jumps once the branch is merged |
| **Theses table + operator lifecycle** | 100 | 90 | 40 | Same branch |
| **Signal Desk dashboard** | 100 | 80 | 40 | Same branch |
| Open theses in Orchestr8 context (councils, Analysis tab) | 100 | 80 | 40 | Same branch |
| Prediction calibration (Brier) + scoring UI | 100 | 70 | 30 | First measurements due 2026-10-24 |
| Re-classify command | 100 | 90 | 40 | Same branch |
| Jobs stay up (supervisor + logon task) | 100 | 80 | 80 | Logon task registered 2026-10-17; PC sleep pauses feeds (operator choice) |
| Tracked PokéBeach members setup | 100 | 50 | 0 | |
| Member activity ingestion | 0 | 0 | 0 | Blocked: forum 403 + Cloudflare; never bypassed |
| Community Pulse UI | 0 | 0 | 0 | Needs member activity |
| Source weighting / calibration | 10 | 0 | 0 | Needs member data and resolved predictions |
| SEC EDGAR lane | 10 | 0 | 0 | Needs a contact email for the SEC User-Agent |
| Finance newsletters lane (Gmail) | 10 | 0 | 0 | Needs Gmail access |
| Retail drops / Whatnot (manual entries) | 0 | 0 | 0 | Needs a schema decision (a manual source type) |
| Sources editor UI | 50 | 0 | 0 | API done; Desk shows read-only feed health |
| Market data track (FRED indices; metals) | 0 | 0 | 0 | Outside the spine; needs a storage decision (HS-2/HS-3) |

## 6. Orchestr8
*Re-scored 2026-10-17 after the Orchestr8 completion pass (branch `cursor/orchestr8-complete`).*

| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Gateway, 22 agents, councils, saved runs | 100 | 95 | 85 | |
| Console: Team, Build Spec, Runs, Specs, Diff Review, custom roles and councils | 100 | 90 | 75 | |
| Live run health (heartbeats) + a Stop that really stops | 100 | 95 | 85 | Verified on a paid run 2026-10-17 |
| Analysis tab sign-off (operator verifies one saved run) | 100 | 80 | 50 | Needs your own run from the Analysis tab |
| Credit pause / resume | 100 | 90 | 70 | |
| Challenge Council second pass on high-dollar picks | 100 | 80 | 70 | Offered, never automatic (2026-10-10) |
| Richer inventory filters in Analysis | 100 | 80 | 70 | Pillar, publisher, min value (2026-10-10) |
| Delete custom roles | 100 | 90 | 75 | |
| Promote a custom role to a shipped agent | 100 | 90 | 40 | No custom role exists yet to promote |
| Diff review loop (O2) | 100 | 95 | 50 | Offline gate 13/13; live council reject + approve 2026-10-17 |
| Model catalog current (Claude 5.5 family) + refusal fallback | 100 | 95 | 50 | Live Haiku 5.5 / Opus 5.5 calls 2026-10-17; role defaults unchanged (your call) |
| Daily SIGNALS brief council (Signal Hunter → Thesis Manager → Critic → Synthesizer) | 100 | 90 | 60 | Runs once a day |

## 7. Decisions, valuation & intelligence
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Decision engine v0.1 + backtest | 100 | 90 | 50 | |
| Recommendations that admit missing evidence | 100 | 90 | 60 | |
| Liquidation-ready valuations end to end | 40 | 10 | 0 | Blocked on sold comps |
| Sell queue: top 20 the operator trusts | 60 | 20 | 0 | |
| Intelligence core (package, API, `/intelligence` page) | 100 | 90 | 40 | |
| Move the intelligence store from JSON to Postgres | 0 | 0 | 0 | |
| Prediction resolution workflow | 60 | 50 | 20 | SIGNALS thesis predictions: Held / Did not hold on the Desk; intelligence-store predictions still manual |
| Binder chase completion per page | 0 | 0 | 0 | |
| Phase 2 market-cycle scoring | 0 | 0 | 0 | Gated |

## 8. Hunts
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Hunts explorer | 100 | 80 | 50 | |
| Marvel Midnight Universe HUNT basics | 100 | 90 | 60 | Merged to main (a29b3bb) |
| Hunts served from Postgres, not seed files | 100 | 80 | 60 | Merged to main (acb2799) |
| HUNT market slice (asks, price alerts, bundles, status edits) | 60 | 40 | 30 | Part 1 merged (0130eba, 5183347); sold comps and bundles wait on Marketplace Insights |
| Hunt completion % vs shelf | 100 | 70 | 50 | Merged to main (c4cdd3a) |

## 9. Selling (eBay)
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| eBay listing lookups (production keys) | 100 | 80 | 60 | |
| eBay account-deletion notifications | 100 | 100 | 100 | |
| Listing automation (Sell APIs, queue, lots) | 100 | 60 | 0 | Sandbox only; Production not attempted |
| Apply for eBay Marketplace Insights (sold data) | 0 | 0 | 0 | **Operator action**; unblocks four rows above |

## 10. Product trial & future
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| 7-day dogfood vs spreadsheets | 0 | 0 | 0 | |
| Mobile Show Mode | 0 | 0 | 0 | |
| VaultOS store pilot | 5 | 0 | 0 | |
| Names cleared (Crucible · Forge · Temper) | 50 | 0 | 0 | |

## Roll-up

SIGNALS is now close to complete on the build side: every planned lane that does
not wait on someone else is built, tested and running on real data, and the loop
SIGNALS → daily Orchestr8 brief → draft theses → operator decision → measured
predictions works end to end (verified live 2026-10-17). What still holds
Production back:

1. Merging `cursor/signals-complete` (brief, theses, desk, reclassify, feed fallback).
2. Outside blocks: PokéBeach Cloudflare challenge and forum 403 (never bypassed). GDELT's 429s no longer block anything: discovery runs on the radar.
3. A licensed sold-comps source, which unlocks Buy / Sell / Grade and market confirmation.
4. Operator inputs: PSA enable command, SEC contact email, Gmail access, manual-entry and market-data decisions.

## Dropped because later work replaced them

- CLZ as the inventory source → ComicBase (ADR 0016).
- TCGplayer price history / latest sales → PriceCharting guide (TCGplayer returns 403).
- Read-time clusters and the old synthesis job → #98's stored clusters plus read-time synthesis.
- The hourly items job → manual items index.
- Gateway "step_start" events → heartbeats.
- Binder on SQLite (ADR 0005) → Postgres (ADR 0007).
