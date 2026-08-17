# Plan 0002 — Live ops weekend: news, inventories, launch, bulk scan + eBay

**Status:** accepted as the working plan (2026-08-14)  
**Companion:** ADR 0001 (product boundaries), ADR 0008–0010 (scan / staging / catalogs), [plan 0001](0001-catalog-adapter-rollout.md), [backlog](../backlog.md)  
**Operator:** Gregory Williamson  
**Builder:** Cursor on this branch, then `main` after merge

This is the overnight report you asked for. It is an audit of every VIP plan
and the code that actually exists, then a concrete cut for: live news into
Orchestr8, live inventories with market **ranges** for comics / Pokémon /
Magic / sports, a working double-click launch, and bulk scan + bulk eBay
listing — without fake precision, silent fill-in, or auto-list.

---

## 0. Answer first

We can be **up and running this week** for:

1. **Double-click launch** — already coded and **merged** (PR #27). Pull
   `main`, retarget the Desktop shortcut, double-click. Collector opens at
   `http://127.0.0.1:3000/collections`.
2. **Comics inventory** — already live (~2,700 holdings from CLZ XML). Drop
   zone + `clz-sync` work. Values on the grid are **CLZ catalog snapshots**,
   not sold comps. That label stays until eBay sold comps are wired with a
   token.
3. **Pokémon inventory** — already live if Binder pockets are owned and
   **Push to VIP** has run. Binder prices are point quotes labeled low-conf;
   TCGplayer ranges exist in code and light up when the network path works.
4. **Live news** — RSS adapter + hourly `pokemon-drops` job already exist.
   IQVault `/signals` already reads the feed. Orchestr8 Analysis/Ask does
   **not** see it yet. That pipe is a small, high-leverage change.
5. **Bulk scan intake** — Ricoh folder import + per-card Confirm/Reject
   already exist on `/scan`. Missing: bulk confirm/reject, and any real
   catalog (today the matcher knows **five** fixture cards).
6. **Bulk eBay** — drafts exist; live Inventory API submit is explicitly
   deferred and `submitReady: false` even with tokens. End-of-week honest
   cut: **bulk drafts from operator-priced Sell items**, optional submit
   behind a human click. Never silent auto-list.

We **cannot** honestly promise, in the same week, all of: CardSight-quality
sports parallel ID, four-category liquidation-ready ranges persisted to
`vault_market`, Magic collection ingest, and unattended eBay submit of
unreviewed scans. Those are different jobs (ADR 0010). The cut below ships
the operator loop; the catalog/market adapters are sequenced so each one is
useful alone.

---

## 1. What “done this week” means (gates, not dates)

A gate is a check you can run on the machine. If it fails, that workstream
is not done — we do not paper over it with a point price or a fake listing.

| # | Operator-facing gate | Passes when |
|---|----------------------|-------------|
| G0 | Launch | Double-click `Launch IQVault.bat` (or Dev Environment **[A]**) opens `http://127.0.0.1:3000/collections` with Comics / TCG / Sports / Scan in the nav. Orchestr8 health `GET :5210/v1/health` is `ok: true` if keys are set. |
| G1 | News → Orchestr8 | `npm run job:pokemon-drops` writes live items (not the offline fixture). IQVault **Signals** shows `job_feed`. Comics **Ask** / Console **Analysis** include a `signals` slice in the LLM context. Provenance: `unverified`, source id, rule version. |
| G2 | Comics inventory + range | Comics terminal loads Postgres holdings. Selected / sell-high rows show a **range** (`low`–`high`, matched count, recency, confidence) when `EBAY_OAUTH_TOKEN` works; otherwise the UI says **insufficient market evidence**, not `$0` and not a invented number. CLZ `Current Price` stays labeled catalog snapshot. |
| G3 | Pokémon inventory + range | `/collections/pokemon` shows owned Binder pockets (not seeds). Recommendations / TCG rows can show a TCGplayer **range** when `pokemontcg` external ids exist. Binder point sum stays labeled low-conf. |
| G4 | Magic + sports on the scan path | A real (non-fixture) Pokémon scan and a real Magic scan produce candidates from TCGdex / Scryfall. Sports without `CARDSIGHT_API_KEY` still IDs only the fixture cards and says so. Confirmed units become holdings with `source=ricoh_fi8170`, condition **NM assumed · unverified**. |
| G5 | Bulk scan | `/scan` can **Confirm all `auto`** and **Reject all `none`** in one click. Auto-resolve remains **off** unless you opt in. Nothing crosses into inventory without a resolution_mode. |
| G6 | Bulk eBay | From confirmed units (and/or sell-queue items you marked **Sell**), one action queues listing **drafts**. Without tokens: `pending_credentials`. With tokens: `draft_ready`, still `submitReady: false` until you set a price inside the evidence range and click **Submit selected**. No draft is posted because a scan landed. |

If a gate needs a secret you have not put on the machine, the adapter stays
idle and the UI says why. That is success, not a bug (rule 4, rule 5).

---

## 2. Split: you vs Cursor

Overnight / while you sleep, Cursor can land code, tests, and this plan.
You still own hardware, secrets, and the human Sell decision.

### You (operator) — blocking inputs

Do these once on the Windows box after `git pull origin main`:

| Need | Why | Where |
|------|-----|--------|
| Pull merged launcher | PR #27 is merged; old Desktop shortcut may still point at a stale clone | `git pull` then `scripts\create_iqvault_shortcut.ps1` |
| `orchestr8/.env` | Ask / Analysis / councils | Copy `orchestr8/.env.example`; paste **matching** OpenAI / Anthropic / xAI keys ([how-to 05](../how-to/05-orchestr8-env-keys.md)) |
| `VIP_POKEMON_NEWS_RSS_URL` | Live news vs offline fixture | User env or `.env` the jobs process reads. Official Pokémon news RSS or another **allowed** RSS URL — no scrape of blocked sites |
| `EBAY_OAUTH_TOKEN` | Comics sold comps **and** listing drafts | eBay developer app, `buy.browse` for comps; sell scopes later for submit |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | Listing drafts without a user token | Same eBay app |
| `VIP_SCAN_INBOX` | Skip typing the Ricoh output folder | e.g. `D:\VIP\scans\fi8170` ([how-to 06](../how-to/06-ricoh-fi8170-scan-intake.md)) |
| Ricoh fi-8170 + PaperStream | Bulk scan is a folder drop | Duplex JPEG/TIFF into that inbox |
| Binder **Push to VIP** | Pokémon “live inventory” is owned pockets, not seeds | Binder `:3010` |
| CLZ Comic Collector XML | Comics stay current | Drop on `/collections/comics` or `E:\ComicArchive\inbox\` ([how-to 07](../how-to/07-clz-inbox-sync.md)) |
| Optional `CARDSIGHT_API_KEY` | Sports visual ID beyond 2 fixture cards | Only if you want sports bulk ID this week |
| Optional `CARD_HEDGE_API_KEY` | Paid valuation ranges | Plan 0001 Phase 4 — **after** identity is canonical |

You do **not** need to paste keys into git. Cloud Dashboard secrets or
Windows User env (`setx`) only.

### Cursor (this week’s build order)

Coded in this order so each merge is usable alone:

1. **W0 — Launch verify + operator checklist** (docs; PR #27 already merged).
2. **W1 — Signals into Orchestr8 context** (G1). Types/zod first.
3. **W2 — Surface comps as ranges** on comics + TCG + recommendations (G2, G3).
   Persist into `vault_market.sale` only if the write path is small; otherwise
   live-fetch with provenance and say “not persisted yet”.
4. **W3 — Catalog adapters Phase 0 scaffolding + Phase 1 TCGdex + Phase 2 Scryfall**
   (G4). CardSight only if the key is present.
5. **W4 — Bulk review actions** on `/scan` (G5).
6. **W5 — Listing queue + bulk draft + opt-in submit** (G6). Submit is a
   separate, gated function. High-dollar items still get a critic path.

---

## 3. Current status — every plan, ADR, and surface

Feature freeze is **OFF** (ADR 0004, lifted 2026-08-02). Non-trivial work
still prefers Build Spec → Cursor (ADR 0003). Engineering rules 1–6 in
`AGENTS.md` still apply.

### 3.1 Product (ADR 0001)

One intelligence core. IQVault (collector) and VaultOS (LGS) are faces.
Orchestr8 advises; it does not own truth. We will not fork a second pricing
brain into the comics terminal or Binder.

| Product | Owns | Local URL |
|---------|------|-----------|
| VIP core | Model, snapshots, ingest, decision engine, signals, API, jobs | `:8787` |
| IQVault | Collector UX | `:3000` |
| Binder Vault | TCG pocket layout + Binder prices | `:3010` |
| Comics API | CLZ-shaped grid (same Postgres) | `:5200` |
| Orchestr8 gateway | Agents, councils, traces | `:5210` |
| Orchestr8 Console | Team / Build Spec / Analysis / Runs | `:3001` |

There is **no hosted public VIP**. Live means your LAN: `127.0.0.1`.

### 3.2 ADRs — what is decided vs what is built

| ADR | Decision | Built? |
|-----|----------|--------|
| 0001 Product boundaries | One core, two faces, Orchestr8 consumes | Yes — routing table still the map |
| 0002 Orchestr8-first | Historical sequencing | Done; freeze later lifted |
| 0003 Orchestr8 authors specs; Cursor builds | Autonomy 0 | In force |
| 0004 Freeze off | Work may proceed | In force |
| 0005 Binder SQLite then Postgres | Superseded | **ADR 0007 shipped Postgres.** Historical backlog “Shipped” still lists the SQLite checkbox — treat 0007 as truth |
| 0006 Python CLZ ingest | Python authoritative; no second parser | Yes |
| 0007 Binder + comics in Postgres | `vault_tcg` + `vault_collection.holding` | Yes |
| 0008 Ricoh scan ingest | Folder drop → ID → confirm → optional eBay draft | Pipeline yes; live catalogs no; live submit no |
| 0009 Identity staging | Candidates as rows; holding only at resolve | Yes |
| 0010 Catalog vs comps vs listing | Three seams; CardSight last; ranges never a point | Plan 0001 written; **no live catalog adapter coded** |

### 3.3 Plans

| Plan | Role | Status |
|------|------|--------|
| [0001 Catalog + market adapter rollout](0001-catalog-adapter-rollout.md) | How scan ID and valuations get real providers | **Unstarted in code.** Fixture catalog is 5 cards (Charizard, Pikachu, Jordan, Wembanyama, Black Lotus) |
| **0002 (this doc)** | How we get to a usable live-ops loop this week | Active |

### 3.4 Backlog A–N — honest snapshot (2026-08-14)

Prefer **code + section L** over stale checkboxes. Two contradictions to
ignore:

- **J** still says live comps are `adapter_pending`. **L** and
  `services/api/src/lib/comps/` say eBay sold + TCGplayer **shipped idle**.
  L is correct.
- Historical **E / Shipped** still says “Postgres later” (ADR 0005). ADR 0007
  is done.

| Area | Shipped | Still open (matters this week) |
|------|---------|--------------------------------|
| **A Orchestr8 Analysis** | Comics inventory load, compact context, Ask on collector | Signals not in context; market ranges in context still CLZ points; Challenge Council on high-dollar not gated |
| **B Console UX** | Runs, keep-alive, council strip, launcher rewrite | `step_start` events |
| **C O2 diff review** | Spec exists | Never started — skip this week |
| **D Signals** | RSS adapter, job feed, `/api/signals`, `/api/sources`, evidence bridge into recommend() | Sources editor UI; Orchestr8 does not ingest the feed; retail-drop still stub |
| **E Binder** | Postgres, Push to VIP, price snapshots schema | Scheduled Binder price refresh; `price_snapshot` write-on-refresh; full catalog vs 5 VIP seeds |
| **F Bloomberg terminal** | Comics grid, TCG page, Sports stub, Scan page, CLZ drop | Unified comics+TCG grid; **bulk review actions**; sports ingest |
| **N Catalog adapters** | Seam + fixture + bands + staging | Entire Phase 0–5 of plan 0001 |
| **G Trust trial** | — | 7-day dogfood, hunt % vs shelf, sell-queue top 20 |
| **H Mobile show** | — | Out of week |
| **I VaultOS / scan** | Capture session, `/scan`, staging | Backlog still says write-through to Postgres — `scanStorePg.ts` already writes staging; confirm the leftover is “operator review UX + live catalogs” |
| **J Data leftovers** | — | Liquidation-ready ranges end-to-end; hunts still seed |
| **K DevEx** | CI, typecheck, one-shot launcher, **PR #27 launch fix merged** | Spend-key docs |
| **L Trust debt** | No synthetic comps; live holdings; no sample-portfolio lie | 2,684 / ~2,700 comics `Needs Verification` (NM assumed); hunts seed file |

### 3.5 MVP (`docs/mvp.md`) vs this week

MVP is: import → catalog resolve → **range** → context signals → decision
(Buy/Hold/Grade/Sell/Lot/Pass) → persist. Marketplace automation is
**explicitly not MVP**. We are stretching MVP for eBay drafts because you
asked for bulk list. The stretch is drafts + opt-in submit, not a second
brain and not unattended posting.

---

## 4. Goal-by-goal: what is true on disk today

### 4.1 Double-click quick launch — **code done, verify on your box**

**Merged:** [PR #27](https://github.com/cognativebs/258_VIP/pull/27)
(`a43d811`, `323de77`, `6936d32`).

What was broken (your Dev Environment log):

- Empty `%*` into `powershell -File` on Windows PowerShell 5.1.
- Stack started **minimized** with `-NoBrowser`, so “warming up” looked like
  nothing.
- PATH on Explorer-launched bats missing Machine/User entries.
- Binder already on `:3010` is fine — launcher should skip it.

What it does now:

- `Launch IQVault.bat` / `Start Dev Environment.bat` do not pass empty `%*`.
- **[A]** waits for `:3000`, opens `/collections`, keeps the stack window
  **Normal**.
- Transcript: `scripts/logs/launcher.log`.
- Desktop `IQVault.lnk` retargeted at this repo when the shortcut script runs.

**Your first action after sleep:** `git pull origin main`, recreate the
shortcut if the old `.lnk` still points at a different folder, double-click,
confirm nav: Collections, Comics, TCG, Sports, Scan, Signals.

Orchestr8 is **not** a top nav tab. On comics: **Ask** (top bar) and
**Analytics** (right panel) → gateway `:5210`. Console: `:3001`.

### 4.2 Live news into Orchestr8 — **pipeline yes, Orchestr8 no**

| Piece | Status |
|-------|--------|
| `@vip/signals` RSS adapter | Built. Live URL from `VIP_POKEMON_NEWS_RSS_URL` or `RSS_FEED_URL`. Otherwise **offline fixture** |
| Job `pokemon-drops` | Built. Scheduler: hourly. Writes `signals-feed.json` |
| `GET /api/signals` | Prefers job feed over seeds |
| IQVault `/signals` | Shows feed; quarantine visible |
| `GET/PATCH /api/sources` | Registry + persistence; **no Sources editor UI** |
| Decision engine | `signalsToEvidenceRefs` into `recommend()` |
| Comics `analyticsContext.ts` | Inventory slice only — **no signals** |
| Console `analysisContext.ts` | Comics inventory only — **no signals** |
| Orchestr8 gateway | No signals fetch |

So “live news” today means: set the RSS URL, run the job, look at
**Signals**. Ask/Analysis will not mention a drop until W1.

Retail-drop-watch is still a stub. Comics news RSS is not a registered
source. Do not scrape; add RSS adapters the same way (env URL, snapshot,
provenance).

### 4.3 Live inventories + market values

Rule 4: valuations are **ranges + evidence count + recency + confidence**.
A single `Current Price` on the comics grid is a **catalog snapshot**, not
a fact. TCG page already warns: “Market sums are Binder point prices, not
verified ranges.”

#### Comics

| | |
|--|--|
| Inventory | **Live.** Postgres via Comics API `:5200` (VIP `:8787` fallback). CLZ XML → immutable `raw_snapshots` → holdings |
| Count | ~2,700 |
| Ingest | Drop zone `POST /api/comics/inbox` + `npm run job:clz-sync` (every 6h in scheduler) |
| “Value” on grid | CLZ `currentprice` → `Current Price` / `current_price_snapshot` |
| Comps | `ebaySoldAdapter` — comics only, idle without `EBAY_OAUTH_TOKEN`, never fabricates |
| Recommendations | Return `insufficientMarketEvidence` when adapters idle |
| Verification | Vast majority `Needs Verification` / NM assumed · unverified — **do not bulk-mark verified** |

#### Pokémon / TCG

| | |
|--|--|
| Inventory | **Live Binder path.** `vault_tcg` + holdings `source=binder_vault` after Push to VIP |
| If you never pushed | Page shows **5 seed cards** and says so |
| Prices | Binder market sum (point). Comps: `tcgplayerMarketAdapter` via `pokemontcg` external id |
| Drop zone | Disabled (no TCG XML inbox) |
| Scan ID | Fixture: Charizard + Pikachu only until TCGdex (plan 0001 Phase 1) |

#### Magic

| | |
|--|--|
| Inventory | **None.** No MTG ingest, no Binder Magic, no CLZ Magic |
| Scan ID | Fixture: Black Lotus only |
| Catalog plan | Scryfall + MTGJSON mirror (Phase 2) — not built |
| This week | Scan → Scryfall candidates → confirm → holding. No Bloomberg Magic grid unless a thin list of scan-confirmed MTG holdings is enough |

#### Sports

| | |
|--|--|
| Inventory | **Stub terminal.** `vault_sports` is catalog schema (product / subset / parallel / card), **no holdings loader** |
| Drop | Disabled |
| Scan ID | Fixture: Jordan 1986 Topps, Wembanyama Prizm |
| Real sports ID | CardSight (Phase 3), metered, needs `CARDSIGHT_API_KEY` + messy-card benchmark |
| This week without CardSight | You can bulk-scan sports into staging; almost every card will be `none` / `weak`. Confirming those as inventory would be silent fill-in — **we will not do that** |

#### Shared market plumbing

| | |
|--|--|
| `CompsAdapter` | eBay sold (comics), TCGplayer (Pokémon). Card Hedge not built |
| `vault_market.sale` / `market_value` | Schema exists, **unwired** |
| `id_observation` | Schema exists, **unwired** |
| Recommendations page | Shows range when comps return; else “Insufficient comps” |
| Sell queue | CLZ-derived MUS/INV/LIQ + flags — **not** live sold ranges |

### 4.4 Bulk scan + bulk list eBay

Scan path (ADR 0008/0009), already in IQVault:

```
Ricoh ADF → folder → POST /api/scan/import-folder
  → staged units + candidates (inferred · unverified)
  → Confirm (Hold, NM assumed · unverified) or Reject
  → optional EbayListingDraft
```

| Capability | Today |
|------------|--------|
| Import folder | Yes (`/scan`) |
| Per-unit Confirm / Reject | Yes |
| Duplicate acknowledge | Yes (409 until click) |
| Postgres staging | Yes (`scanStorePg`) |
| Auto-resolve | Off unless `VIP_SCAN_AUTO_RESOLVE=1` **and** band/margin/identity-grade/no-dup |
| Bulk confirm all `auto` | **No** (backlog F) |
| Bulk reject all `none` | **No** |
| Catalog | 5-card fixture |
| eBay draft builder | `buildEbayListingDraft` |
| No tokens | `pending_credentials` |
| With tokens | `draft_ready` but **`submitReady: false`** |
| Live Inventory API | Listed in `scanMeta().deferred` |
| Bulk list UI | **No** |
| Auto-submit on scan | Forbidden (AGENTS.md rule 1: action + confidence + reasons; high-dollar critic) |

Confirming a scan today sets action **Hold**, not Sell. Listing must be a
second decision: operator (or decision-engine with evidence) says **Sell**,
picks a price **inside a range**, then we draft / submit.

---

## 5. How we actually make it happen

Workstreams. Each has a code shape, a test, a provenance rule, and a
failure behavior. Cursor implements; you run the gate on the desktop.

### W0 — Launch (verify only)

**Code:** already on `main` via PR #27.  
**You:** pull, shortcut, double-click, read `scripts/logs/launcher.log` if
the browser does not open. Docker Desktop must be running for Postgres.  
**If Binder is already on :3010:** leave it; launcher should not fight it.  
**Orchestr8 keys:** if Ask fails, keys are swapped or missing — see how-to 05.

No new launcher features this week unless G0 fails on your log.

### W1 — Live news into Orchestr8 (G1)

**Problem:** feed dies at IQVault `/signals`. Analysis/Ask never see it.

**Build (zod/types first):**

1. Shared compact `SignalsContext` (id, title/body, sourceId, publishedAt,
   quarantineStatus, confidence, ruleVersion) — cap ~25 active items.
2. Fetch `GET /api/signals` (same job feed) from:
   - `apps/iqvault-web/src/lib/analyticsContext.ts` (Comics Ask)
   - `apps/orchestr8-console/src/lib/analysisContext.ts` (Console Analysis)
3. Inject a `signals` block into the compact LLM payload. Quarantined items
   stay out of the prompt (still visible on `/signals`).
4. Provenance line in the prompt: “News is inferred · unverified RSS;
   not a market fact; do not invent comps from headlines.”
5. Optional: register a second RSS source (`comics-news-rss`,
   `sports-news-rss`) behind env URLs — same adapter, no new host in core.
   Only if you supply URLs. Default remains Pokémon.

**Tests:** context builder includes fixture signals; excludes quarantined;
empty feed → omit block, do not hallucinate “no news” as a priced event.

**Failure:** missing URL → job keeps fixture, UI says `fixture` / seed.
429 from feed → empty adapter result, existing feed file untouched.

**You:** set `VIP_POKEMON_NEWS_RSS_URL`, run `npm run job:pokemon-drops`,
open Signals, then Ask “what news should change a Sell this week?” and
confirm the model cites the feed ids.

### W2 — Inventories with honest market values (G2, G3)

**Problem:** four categories are in four different states; two UIs show
point prices.

**Comics (already inventoried):**

1. Keep CLZ `Current Price` as **catalog snapshot** (label it).
2. For visible / selected / sell-high rows, call existing
   `fetchCompsForHolding` → `marketRange()` (low, high, matchedSales,
   recencyDays, confidenceBand).
3. Recommendations already know how to show a range — lift that chip onto
   the comics inspector and Analysis context (`valueRange` not `value` as
   truth).
4. Without token: chip = `insufficientMarketEvidence` + emptyReason from
   adapter. **Never** copy CLZ into the range.

**Pokémon (Binder live):**

1. Ensure owned pockets have `pokemontcg` (or later `tcgdex`) external ids
   so `tcgplayerMarketAdapter.matches()` is true.
2. Same range chip beside Binder point price.
3. Do not treat Binder `ownedMarketSum` as verified FMV (page already
   warns).

**Magic:** no import this week unless you have a CSV/Scryfall collection
export you want as a **new** inbox adapter. Default path is **scan**. After
Scryfall adapter (W3), confirmed MTG units are holdings; list them on TCG
or a thin `/collections/mtg` table — not a fake Bloomberg.

**Sports:** no CLZ Sports XML loader this week unless you drop a real
export and we add a dedicated inbox (new adapter, rule 3 snapshots). Default
path is scan + CardSight **if** the key exists. Otherwise sports inventory
stays “catalog schema + scan staging only”.

**Persist comps (`vault_market.sale`)** is follow-up, not a blocker for the
chip. If we write sales, snapshot the raw HTTP first (rule 3).

**You:** put `EBAY_OAUTH_TOKEN` on the API process; Push to VIP from Binder;
spot-check 5 comics and 5 Pokémon that a range appears or the idle reason
is visible.

### W3 — Catalog adapters so bulk scan IDs real cards (G4)

This is the difference between “bulk scan works” and “bulk scan stages 200
unknown JPEGs”.

Follow [plan 0001](0001-catalog-adapter-rollout.md) **compressed**:

| Slice | Build | Skip / defer |
|-------|--------|----------------|
| Phase 0 (minimum) | `CatalogResolver` fan-out + failure isolation; snapshot provider bytes; cache by `content_hash` so retries are free | Full benchmark harness can be a script, not a product UI |
| Phase 1 | `TcgdexCatalogAdapter` (Pokémon, keyless). Catalog **only** — no TCGdex prices as valuation | — |
| Phase 2 | `ScryfallCatalogAdapter` (Magic). MTGJSON mirror if we have disk time; else Scryfall with rate limit | Offline-disabled gate can wait |
| Phase 3 | `CardSightCatalogAdapter` **only if** `CARDSIGHT_API_KEY` is set. Hard call budget, loud stop | 100–250 card parallel benchmark is the **real** sports gate — do not enable auto-resolve on sports without it |
| Phase 4 | Card Hedge | After identity; optional this week |
| Phase 5 | eBay ePID on drafts | Nice-to-have for listing quality |

**Wire:** `services/api/src/lib/scanIngest.ts` today hard-codes
`FIXTURE_CATALOG`. Resolver must replace that. Fixture stays as last-resort
/ test adapter (rule 5: removing TCGdex cannot break sports).

**Provenance:** every candidate `inferred · unverified` until resolve,
regardless of provider score.

**You:** scan 10 Pokémon and 10 Magic with readable file names or OCR
(`charizard_base_4_front.jpg` beats `img001.jpg`). Sports: either provide
CardSight key or accept fixture-only ID.

### W4 — Bulk scan review (G5)

**Build:**

- `POST /api/scan/batches/:id/bulk-resolve` with `{ action: "confirm_auto" | "reject_none", acknowledgeDuplicates?: boolean }`.
- Zod body; per-unit results; skip `review`/`weak` on confirm_auto (those
  stay for human eyes).
- UI: two buttons on the batch header.
- Auto-resolve env flag remains a **separate** opt-in. Bulk confirm of
  `auto` is still a human click.

**Tests:** mixed batch; `auto` confirms, `none` rejects, `review` untouched;
duplicates still 409 without acknowledge.

**You:** PaperStream duplex into `VIP_SCAN_INBOX`, Import scanned batch,
use bulk actions, then spot-check holdings.

### W5 — Bulk eBay list (G6)

**Non-negotiable:** scan confirm ≠ list. Listing requires:

1. Identity resolved (not staged).
2. Action **Sell** (operator or decision-engine with range + reasons).
3. Price chosen **inside** the evidence range (or explicit override with
   note).
4. Credentials present.
5. Human **Submit selected** (or per-item Submit). High-dollar: critic /
   Challenge Council available, not silent.

**Build:**

1. Listing queue page (or Scan + Sell-queue panel): drafts from
   `buildEbayListingDraft`.
2. Bulk “Queue eBay drafts” for checked resolved units / sell-queue rows.
3. Status chips: `pending_credentials` | `draft_ready` | `submitted` |
   `failed` + emptyReason.
4. Keep `submitReady: false` until price ∈ range (or override) **and**
   Sell action.
5. **Optional submit:** one function `submitEbayInventoryItem(draft)`
   calling eBay Inventory API. Idle/error reasons, snapshot response,
   never retry-storm. If the API contract is not ready in time, **stop at
   drafts** — that is still a working bulk-list **prep** loop. Do not fake
   a listing id.

**You:** eBay app tokens; pick 3 cheap cards as the live submit dogfood;
leave keys / high-value slabs for critic.

Marketplace automation remains deferred in backlog on purpose. This week
we promote **drafts + opt-in submit**, not unattended selling.

---

## 6. Category matrix (end of week target)

| Category | Inventory this week | Market value this week | Scan ID this week | eBay this week |
|----------|---------------------|------------------------|-------------------|----------------|
| **Comics** | Live CLZ (already) | Range from eBay sold **if token**; else idle reason. CLZ snapshot labeled | N/A (XML ingest) | Drafts from sell-queue / marked Sell, not from scan |
| **Pokémon** | Live Binder if pushed | TCGplayer range if external id; Binder point labeled | TCGdex + fixture fallback | Drafts from confirmed scans with Sell |
| **Magic** | Scan-confirmed holdings only | Range only if a comps adapter matches (likely idle until eBay/Scryfall-linked comps) | Scryfall | Same draft path |
| **Sports** | Scan-confirmed **only if** ID is real (CardSight or operator-picked candidate). No silent fixture | eBay sold does not match sports today; Card Hedge optional | CardSight if key; else almost all `none` | Same draft path; do not list `none` matches |

---

## 7. What we will not do (quality)

- Invent comps, listing ids, or grades.
- Store inferred identity as verified.
- Bulk “Mark verified” on 2,684 NM-assumed comics.
- Enable sports auto-resolve on a 2-card fixture.
- Use TCGdex embedded prices as FMV (catalog only).
- Auto-submit eBay because a scan landed.
- Scrape blocked / ToS-hostile sites for news.
- Fork Binder pricing into a second decision engine.
- Pretend Magic/sports Bloomberg grids exist.

---

## 8. Suggested execution while you sleep vs when you wake

### Cursor can land without you

- W1 signals → Orchestr8/Ask context + tests.
- W2 range chips on comics inspector + TCG (idle-safe).
- W3 CatalogResolver + TCGdex + Scryfall (keyless).
- W4 bulk resolve API + `/scan` buttons.
- W5 listing queue UI + bulk draft; submit function **behind a flag**.
- Keep this plan and backlog pointers current.

### Needs you before it is “live”

- `git pull` + double-click (G0).
- Secrets in the table in §2.
- One CLZ XML drop (comics freshness).
- Binder Push to VIP (Pokémon).
- One Ricoh batch (scan).
- Three-card eBay dogfood if you want **submitted** not just drafted.
- CardSight key **only** if sports bulk ID is in scope.

### Morning checklist (15 minutes)

1. Pull `main` (or the PR that carries W1–W5).
2. Double-click Launch IQVault → `/collections`.
3. Signals page: feed source line.
4. Comics: drop or confirm last XML; inspect one book for range vs snapshot.
5. TCG: owned count ≠ seeds.
6. Scan: import last Ricoh folder; bulk confirm `auto` only if adapters are live.
7. Do **not** Submit eBay until you have looked at the draft titles and prices.

---

## 9. Risks (technical, not calendar)

| Risk | What we do |
|------|------------|
| eBay Browse is **asks**, not sold ledger | Adapter already marks unverified quotes; range UI must say so |
| TCGplayer history is buckets, not invoices | Already in adapter notes; `quantitySold` raises confidence |
| CardSight quota (published 750/month) | Cache by content hash; hard budget; no sports auto-resolve |
| Resolver merge double-counts | Merge on `external_id`, corroborate in `match_reasons` (plan 0001) |
| Launcher vs already-running Binder | Skip bound ports; do not kill `:3010` |
| Analysis context too large with signals | Cap 25; drop quarantined |
| Live submit scope blow-up | Ship drafts first; submit is a flag + 3-card dogfood |

---

## 10. Definition of done (this plan)

- Types + zod for new payloads (signals context, bulk-resolve, listing queue).
- Provenance on every derived range, candidate, draft, and signal in prompts.
- Tests: idle adapters, fixture catalog still isolated, bulk-resolve mix, news context.
- PR body note: **User** (Greg, collector + LGS operator) · **Decision** (live-ops loop this week, drafts ≠ auto-list) · **Input evidence** (backlog A–N, ADRs 0008–0010, plan 0001, PR #27, code audit 2026-08-14) · **Output action** (workstreams W0–W5, gates G0–G6).

When G0–G6 pass on your desktop, you are up and running. Remaining plan 0001
phases (CardSight benchmark, Card Hedge persist, ePID, unified Bloomberg
grid) stay on the backlog — they are the next quality steps, not blockers
for a working week.
