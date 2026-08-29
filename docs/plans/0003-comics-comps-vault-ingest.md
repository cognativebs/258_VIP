# Plan 0003 — Comics vault comps walk (Browse listings, not a sold overwrite)

Status: **plan only** — no code until the persist-target decision below is answered.
Companion: [how-to 10](../how-to/10-ebay-comps.md), [plan 0002 §W2](0002-live-ops-weekend.md), ADR 0010 §6, AGENTS.md rules 2–5.

This is **not** a CLZ re-import. The comics vault is already ingested. This plan
walks every comic **holding** through the existing comps adapters, stores
immutable evidence, and shows a **live range beside** catalog dollars.

---

## What is already true (do not rebuild)

| Fact | Detail |
|------|--------|
| Auth | PR #69 on `main`. Production `EBAY_APP_ID` + `EBAY_CERT_ID` mint with public `api_scope`. The 2-hour paste token and `invalid_client` path are **closed**. |
| Analysis cap | `COMPS_HOLDING_CAP` / `ANALYSIS_COMPS_CAP` = **12**. Analysis / Challenge only see that slice. A council prompt cannot see the rest of the vault. |
| Liquidation gate | Sell / Lot / Buy only when `matchedSales >= 3` after a live adapter pass (`liquidationGate.eligibleHoldingIds`). Thin comps stay Hold / Pass. Critic veto stays. |
| Catalog dollars | Collection Tab **VALUE** = CLZ `current_price_snapshot` · unverified. Never replaced by eBay. |
| Adapter truth | `ebaySoldAdapter` hits Browse `item_summary/search`. Observations are **active listings · unverified**, not Marketplace Insights sold history. |
| Existing job | `services/jobs` `ebay-browse-comps` is a **single query** → JSON feed (Charizard-style). It is not a per-holding vault walk. |
| Persist | `vault_market.sale` / `market_value` schema exists and is **unwired**. Analysis reads live adapters. |

Dogfood that is **not** a full-vault result: one Analysis run priced 12 books;
2 cleared `matchedSales >= 3` (Justice #1C, Justice #5B); ~thousands of
holdings were not sent.

---

## Conflicts (stop — do not pick silently)

AGENTS.md: if a prompt conflicts with a design doc, stop and report.

### C1. Do not write Browse listings into `vault_market.sale`

`infra/db/migrations/20260704_04_market_sealed_id.sql` defines `sale` as
**observed transactions** (“eBay sold is the ground truth”). Browse returns
active asks. Writing them as `sale` rows would store inferred listings as if
they were sold.

**Owner pick required before any persist migration:**

| Option | What | Verdict |
|--------|------|---------|
| **P1** | New `vault_market.listing_observation` (ask rows + provenance + `condition_key` NOT NULL, `'any'` when unknown) | Honest. **Needs owner OK** — new table. |
| **P2** | Per-holding cache (Postgres jsonb or job state) keyed by `holding_id`, raw HTTP in `vault_evidence.raw_snapshots` | No new market table. Weaker as a moat. Fine for v1 if P1 is deferred. |
| **P3** | Insert Browse into `vault_market.sale` with `source=ebay` | **Reject.** Conflicts with sale = transactions and with rule 2. |

Recommendation: **P2 for the first walk** (cache + raw snapshots), **P1 before
the Collection Tab column is treated as durable**, **never P3**. Insights sold
comps (when granted) are the only path that should write `vault_market.sale`.

### C2. Do not overwrite Collection Tab VALUE

Replacing CLZ `Current Price` with one eBay number stores an inferred market as
a fact (rules 2 and 4). Plan 0002 G2 already forbids this.

### C3. “>3 sales in the past 60 days” is not available on this API

That filter needs Marketplace Insights (`buy.marketplace.insights`). Greg’s
Production client-credentials list does **not** include it (or `buy.browse`).
Browse recency is **listing age** (Justice #5B already showed ~76d). A UI
chip may say `6 listings · 19d · unverified`. It must not say `6 sales in 60
days`.

### C4. Uncapped Analysis pass

Lifting `COMPS_HOLDING_CAP` so one council run prices the whole vault would
burn rate limit, still not be sold history, and dump thousands of rows into
the LLM context. The walk is a **job**. Analysis stays capped at 12.

### C5. `condition_key` vs live `sale` DDL

AGENTS.md requires `(priced_unit_id, condition_key)` and forbids NULL meaning
“any”. The 2026-07-04 `sale` table has **no** `condition_key`. Do not sneak
that column onto `sale` in this work. If P1 is chosen, the new table carries
`condition_key TEXT NOT NULL` with explicit `'any'`.

### C6. `market_value.market_price` is a scalar

That column must not become Collection Tab VALUE. If a rollup is computed
later, the grid still shows **range + n + recency + confidence**.

---

## Track A — Batched comics comps job

**Goal:** walk holdings through the **same** `fetchCompsForHolding` /
`ebaySoldAdapter` path Analysis uses, 12 at a time, pause/resume, publisher
filter.

**Not a council prompt.** Challenge still only sees the 12 highlights of
whatever Analysis run you start.

### A.1 Contract (types + zod first)

- Job input: `{ publishers?: string[]; batchSize: 12; staleAfterHours; dryRun; resumeCursor }`
- Job cursor: `{ lastHoldingId, processed, skippedFresh, errors, paused }`
- Per holding result: range + matched count + recencyDays + confidence +
  `observationKind: "browse_listing"` + provenance (source, method, rule
  version, verificationStatus=`unverified`)
- Copy: **listings**, never “sold sales”
- Empty adapter → explicit `emptyReason`, zero observations, no fabricated comps

Reuse `COMPS_HOLDING_CAP = 12` as `batchSize`. Do not invent a second cap.

### A.2 Behavior

1. Load comics holdings from the live VIP/Postgres path (same as Collection).
2. Filter `publisher` in `{Marvel, DC}` for the first operator run; later
   `publishers=[]` means **all comics**.
3. Skip holdings with a fresh cache row newer than `staleAfterHours` (default 24).
4. For each batch of 12: call existing adapters; snapshot raw Browse JSON into
   `vault_evidence.raw_snapshots` (`source=ebay_browse`, INSERT-only) **before**
   parse (rule 3, ADR 0010 §4).
5. Write cache (P2) or `listing_observation` (P1) — never `current_price_snapshot`.
6. Sleep `VIP_EBAY_RATE_LIMIT_MS` (default 1000) between holdings. Pause file /
   SIGINT must leave the cursor durable so the next start resumes.
7. On HTTP 429 / 403 / OAuth error: stop the job, keep cursor, surface the
   reason. Never fill gaps with CLZ.

### A.3 Scale (technical, not calendar)

~2,700–3,025 comic holdings. One Browse search per holding.

- 1s spacing → ~45–50 minutes of API time for a full vault.
- Stay under a conservative **500 calls/hour** budget if eBay throttles
  (sleep ~7s): a full walk is a long job, which is why pause/resume exists.
- Marvel+DC first cuts volume before “all publishers.”
- Analysis remains 12-at-a-time regardless of job progress.

### A.4 Surfaces

- CLI: `npm run job:comics-comps -- --publishers=Marvel,DC --resume`
- Status: processed / total / last error / cursor (log + optional
  `GET /api/comps/walk` later — not required for v1 if CLI prints it)
- Do **not** auto-start Challenge on the full vault.

### A.5 Tests

- Fixture Browse JSON → cache row with `verificationStatus=unverified` and
  `observationKind=browse_listing`
- Publisher filter excludes other publishers
- Resume skips already-fresh ids
- Cap 12 per batch
- Idle / 401 / 429 → emptyReason, no invented range
- Never writes `current_price_snapshot`

---

## Track B — Collection Tab live-range column

**Goal:** a second column next to VALUE. VALUE stays CLZ.

Example cell: `$3.59–$3.98 · 6 listings · 19d · unverified`

Empty / not yet walked: `not fetched` (not `$0`, not CLZ copied into the range).

### B.1 Rules

- New column id e.g. `Live range` / label **LIVE** — not a rewrite of `Current Price`.
- Totals: catalog sum unchanged. Optional footer: `N / vault live-fetched`.
- Sort-by-live is allowed; default sort stays catalog VALUE unless the operator
  clicks LIVE.
- Inspector / selected row: same chip as the grid; catalog snapshot labeled.
- Page load must **read cache**, not fire 2,700 Browse calls.
- `matchedSales >= 3` is a **liquidation** gate, not a condition for showing
  the chip. A title with 1 listing still shows `1 listing · unverified`.

### B.2 What B depends on

B without A would either live-fetch the visible page (rate-limit) or stay
empty. **Build A (cache) before B (column).**

### B.3 Tests

- Grid fixture: CLZ $46 + live $3.59–$3.98 both visible; VALUE still 46
- No cache → `not fetched`, VALUE untouched
- Copy never says “sold” for Browse rows

---

## Full-vault ingest (after A cache exists)

This is the operator run, not a new architecture.

| Step | Scope | Pass criteria |
|------|--------|----------------|
| 0 | Auth already on `main` | `/health` `ebayComps.configured=true`, `mode=client_credentials` |
| 1 | Dry-run batch of 12 (any publishers) | Cursor advances; snapshots on disk/DB; no CLZ writes |
| 2 | `--publishers=Marvel,DC` | Coverage report: fetched / unmatched / errors |
| 3 | `--publishers=` (all comics) | Same report for the rest of the vault |
| 4 | Incremental | Re-run skips fresh rows; only stale + new holdings hit eBay |
| 5 | Collection Tab (after B) | LIVE column populated where cache exists; VALUE still CLZ |
| 6 | Analysis / Challenge | Still 12 highlights. Liquidation still `matchedSales >= 3` on **that** slice. Job coverage does not mean “council reviewed the vault.” |

Nightly schedule (optional, after step 3 is proven): same job, stale window 24h,
same rate limit. Not in the first PR.

---

## Later (gated) — real sold ledger

Only if eBay grants Marketplace Insights (or another sold aggregator adapter):

1. New `CompsAdapter` (`ebay-insights` or swap behind the existing seam).
2. Then write `vault_market.sale` (transactions) + raw snapshots.
3. Then a 60-day **sold** window is a valid `marketRange({ windowDays: 60 })` input.
4. Then Collection copy may say `n sold · 60d` for **that** adapter only.
5. High-dollar Sell still needs Challenge; gate stays `matchedSales >= 3`.

Until that grant exists, do not schedule “sold in 60 days” work.

---

## Copy / naming debt (small, with A)

The adapter id `ebay-sold` and labels like “eBay sold / completed listings”
are product-false for Browse. Rename **user-visible** strings to “eBay Browse
listings · unverified”. Keep the adapter id if a rename is noisy; do not teach
the council that Browse is a sold ledger.

---

## Explicitly out of scope

- Uncapping Analysis / dumping the vault into a council prompt
- Overwriting `current_price_snapshot` / Collection VALUE
- Fabricating comps for unmatched titles
- Auto-clearing `needs_review` or bulk-accepting `NM assumed`
- TCG / Binder walk (different adapter, different ids)
- Applying for eBay scopes from this repo
- Merging unrelated Orchestr8 UX

---

## Build order (Cursor)

1. Zod/types for walk cursor + observation cache (P2) or P1 table if owner picks P1.
2. Job + tests (Track A). Marvel/DC filter + resume.
3. Operator dry-run of 12, then Marvel+DC.
4. Collection Tab LIVE column reading cache only (Track B).
5. Full comics walk.
6. Insights / `sale` writer — **blocked** on C3.

Do not ship A and B as a silent price overwrite. Do not start B until A has a
cache the grid can read without calling eBay on render.
