# VIP progress checklist — snapshot 2026-10-04

Built from `docs/backlog.md`, the session memory, and the work through commit
`abc1266` on `cursor/signals-sports-classifier`. Ideas that later work replaced
are dropped (listed at the bottom).

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
| One-click launcher + Stop, incl. jobs scheduler | 100 | 80 | 60 | Jobs part unmerged; runs from the worktree |
| **Merge open branches to main**: signals-sports-classifier, pricecharting-core-wiring, hunt-midnight-universe | 100 | 90 | 0 | Operator action; then back to one folder |
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
| Feed FMV into signal proposals | 0 | 0 | 0 | |
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
| Signals core (events, evidence, three scores, read-time priority) | 100 | 100 | 80 | |
| Sports: ESPN + classifier + 80/10/5/5 daily list | 100 | 90 | 40 | Real classify run not done (rules-only vs LLM is the operator's call) |
| Collectibles news (ComicsBeat live) | 100 | 80 | 30 | PSA, TAG, Alpha need confirmed feeds |
| Headlines US / World / business (GDELT) | 100 | 70 | 20 | GDELT throttles with 429s |
| PokéBeach ingestion + dedupe (homepage-only) | 100 | 90 | 70 | |
| Pokémon entity extraction | 100 | 90 | 70 | |
| Clustering into stored events (#98) | 100 | 90 | 60 | Unknown sets (e.g. "Delta Reign") don't group |
| Pokémon themes (classifier 0.2.0) | 100 | 90 | 40 | Unmerged |
| Synthesis, bands, "why it shows" | 100 | 80 | 40 | Unmerged |
| Orchestr8 hand-off (proposals, Evaluate link) | 100 | 70 | 30 | Unmerged |
| Tracked PokéBeach members setup | 100 | 50 | 0 | |
| Member activity ingestion | 0 | 0 | 0 | Blocked: forum returns 403 |
| Community Pulse UI | 0 | 0 | 0 | Needs member activity |
| Source weighting / calibration | 10 | 0 | 0 | |
| Cross-source clustering | 30 | 0 | 0 | Manual items index exists |
| Re-classify command | 0 | 0 | 0 | |
| SEC EDGAR lane | 10 | 0 | 0 | Needs a contact email |
| Finance newsletters lane (Gmail) | 10 | 0 | 0 | Needs Gmail access |
| Retail drops / Whatnot (manual entries) | 0 | 0 | 0 | |
| Sources editor UI | 50 | 0 | 0 | API is done |
| Prediction accuracy (Brier score) on the Signals page | 30 | 0 | 0 | |
| Market data track (FRED indices; metals) | 0 | 0 | 0 | |

## 6. Orchestr8
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Gateway, 22 agents, councils, saved runs | 100 | 90 | 80 | |
| Console: Team, Build Spec, Runs, Specs, custom roles and councils | 100 | 80 | 70 | |
| Live run health (heartbeats) + a Stop that really stops | 100 | 80 | 30 | Unmerged; not yet checked on a real paid run |
| Analysis tab sign-off (operator verifies one saved run) | 100 | 60 | 30 | |
| Credit pause / resume | 100 | 90 | 70 | |
| Challenge Council second pass on high-dollar picks | 0 | 0 | 0 | |
| Richer inventory filters in Analysis | 0 | 0 | 0 | |
| Delete / promote custom roles | 0 | 0 | 0 | |
| Diff review loop (O2) | 5 | 0 | 0 | |

## 7. Decisions, valuation & intelligence
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Decision engine v0.1 + backtest | 100 | 90 | 50 | |
| Recommendations that admit missing evidence | 100 | 90 | 60 | |
| Liquidation-ready valuations end to end | 40 | 10 | 0 | Blocked on sold comps |
| Sell queue: top 20 the operator trusts | 60 | 20 | 0 | |
| Intelligence core (package, API, `/intelligence` page) | 100 | 90 | 40 | |
| Move the intelligence store from JSON to Postgres | 0 | 0 | 0 | |
| Prediction resolution workflow | 0 | 0 | 0 | |
| Binder chase completion per page | 0 | 0 | 0 | |
| Phase 2 market-cycle scoring | 0 | 0 | 0 | Gated |

## 8. Hunts
| Task | POC | Testing | Prod | Note |
|---|---|---|---|---|
| Hunts explorer | 100 | 80 | 50 | |
| Marvel Midnight Universe HUNT basics | 100 | 70 | 0 | Unmerged |
| Hunts served from Postgres, not seed files | 40 | 20 | 0 | |
| HUNT market slice (asks, price alerts, bundles, status edits) | 0 | 0 | 0 | |
| Hunt completion % vs shelf | 0 | 0 | 0 | |

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

Platform, inventory and SIGNALS are mostly built (POC around 80–100%), but
Production sits around 30–50%. Three things hold most of it back:

1. Merging the three open branches (the biggest single jump).
2. The first ComicBase export.
3. A licensed sold-comps source (valuation, sell queue and HUNT market
   tracking all wait on it).

## Dropped because later work replaced them

- CLZ as the inventory source → ComicBase (ADR 0016).
- TCGplayer price history / latest sales → PriceCharting guide (TCGplayer returns 403).
- Read-time clusters and the old synthesis job → #98's stored clusters plus read-time synthesis.
- The hourly items job → manual items index.
- Gateway "step_start" events → heartbeats.
- Binder on SQLite (ADR 0005) → Postgres (ADR 0007).
