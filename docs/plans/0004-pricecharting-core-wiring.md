# Plan 0004 — PriceCharting core wiring (VIP / IQVault / Signals / Orchestr8)

**Plan ID:** `PC-CORE-01` (filed)
**Live-repo companion:** [ADR 0011](../adr/0011-pricecharting-wiring-on-live-vip.md)
**Digital Tools:** [plan 0005](0005-pricecharting-digital-tools.md)

The owner plan below was written against a local IQVault clone that assumed
migrations `17`–`24` (`priced_unit`, `condition_key`, `price_series()`) already
landed. Those migrations **do not exist** in this repo. ADR 0011 records the
picks that adapt the plan to live `258_VIP` without waiting on unanswered TCG
plan §2.

**Do not implement the SQL in this file as written.** Use the date-prefix
migration mapping in ADR 0011. Phase A landed as
`infra/db/migrations/20260913_02_pricecharting_source_registry.sql`.

---

# PriceCharting Core Wiring Plan — VIP / IQVault / Signals / Orchestr8

**Plan ID:** `PC-CORE-01`
**Date:** 2026-09-13
**Owner:** Gregory Williamson — 258 Labs
**Target repo root:** `D:\Projects\Business_Ideas\258_Labs\IQVault\`
**Migrations reserved:** `25` – `30` (do not collide with the in-flight TCG expansion, `17`–`24`)
**Depends on:** migrations `11`–`16` (Prediction Ledger, Recommendation Evidence Engine, Grading Optimizer) and `17`–`24` (`priced_unit`, `condition_key`, `price_series()`) **landed and green**

---

## 0. Standing constraints for Cursor

Paste this block into `AGENTS.md` under the existing constraints section before starting.

```
## PC-CORE-01 constraints

HARD STOPS — stop and report, do not resolve silently:
1. If migrations 17–24 are not fully applied, STOP. Report which are missing.
2. If any step would write a current price into a non-time-series column, STOP.
3. If any step would drop, alter, or backfill an existing column in
   inventory_item, market_price_observation, or prediction_ledger, STOP.
4. If a vendor value would be stored without an evidence_class, STOP.
5. If any query reads market_price_observation directly instead of
   price_series(), STOP. The app role does not have that grant.
6. If a condition parameter is optional, defaulted to NULL, or omitted
   anywhere in a new function signature, STOP.
7. Never run against production. Local Docker (pgvector/pgvector:pg16) only.
8. Report design conflicts. Do not choose for me.

CONVENTIONS:
- All migrations wrapped in BEGIN; / COMMIT;
- Reference table seeds run before dependent DDL
- Extensions install into public, never a named schema
- Raw vendor payloads are immutable once written
- needs_review is never auto-cleared
```

---

## 1. What this plan buys

| Capability | Blocked today because | Unblocked by |
| --- | --- | --- |
| Market Cycle Detector | no price time series | Phase C |
| Buy Opportunity Scanner | no market baseline to compare asks against | Phase D |
| Prediction Ledger calibration | outcomes resolved manually or never | Phase E |
| Source registry `historical_accuracy` | asserted, not measured | Phase F |
| Grading Optimizer live inputs | grade ladder hand-maintained | Phase B |
| Orchestr8 evidence bundles | agents have no deterministic price tool | Phase F |

**The non-obvious win:** the PriceCharting API returns *current values only* — no history, no sold comps. That is fine. We snapshot nightly and **build the history ourselves**. Twelve months in, the longitudinal series is proprietary to 258 Labs and is not purchasable by a competitor at any price. The subscription buys the feed; the cron buys the moat.

**The non-obvious risk:** a PriceCharting "market value" is a vendor-derived estimate with an opaque methodology. Under our own provenance rules it is **not** an observed fact. Phase B enforces that at the schema level so it can never be laundered into ground truth.

---

## 2. Phase map

```
A  Source registry + vendor product mapping        migration 25
B  Snapshot ingestion + evidence class             migration 26
C  Derived series: deltas, velocity, ladder        migration 27
D  Deterministic signal emitters                   migration 28
E  Prediction ledger auto-resolution               migration 29
F  Orchestr8 tool contracts + source scoring       migration 30
```

Ship A→F in order. Each phase ends with a green acceptance test and is independently useful.

---

## PHASE A — Source registry and vendor product mapping

**Migration:** `25_pricecharting_source_registry.sql`

### A.1 Reference seeds (run first)

```sql
BEGIN;

-- Evidence classification — the provenance spine for every derived value
CREATE TABLE IF NOT EXISTS vault_core.evidence_class (
    evidence_class   text PRIMARY KEY,
    description      text NOT NULL,
    is_factual       boolean NOT NULL,
    confidence_ceiling numeric(3,2) NOT NULL CHECK (confidence_ceiling <= 1.0)
);

INSERT INTO vault_core.evidence_class VALUES
  ('observed',       'Directly extracted from a primary source or entered by the user', true,  1.00),
  ('normalized',     'Transformed without changing meaning (currency, identifier map)',  true,  0.95),
  ('vendor_derived', 'A third-party vendor estimate with opaque methodology',            false, 0.75),
  ('inferred',       'Estimated by our own rules or models',                             false, 0.70),
  ('opinion',        'Reasoned belief about future value',                               false, 0.60)
ON CONFLICT DO NOTHING;

COMMIT;
```

`confidence_ceiling` is load-bearing. Phase F makes it impossible for an agent to emit a recommendation whose confidence exceeds the ceiling of its weakest evidence class.

### A.2 Data source registry

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS vault_market.data_source (
    data_source_id     smallserial PRIMARY KEY,
    source_key         text UNIQUE NOT NULL,
    display_name       text NOT NULL,
    access_method      text NOT NULL,          -- 'rest_api' | 'bulk_csv' | 'scraper' | 'manual'
    default_evidence_class text NOT NULL REFERENCES vault_core.evidence_class,
    terms_url          text,
    redistribution_allowed boolean NOT NULL DEFAULT false,
    latency_minutes    integer,
    category_coverage  text[] NOT NULL DEFAULT '{}',
    is_active          boolean NOT NULL DEFAULT true,
    -- measured, not asserted; written by Phase F, never by hand
    historical_accuracy numeric(4,3),
    accuracy_sample_n   integer NOT NULL DEFAULT 0,
    accuracy_computed_at timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO vault_market.data_source
  (source_key, display_name, access_method, default_evidence_class,
   redistribution_allowed, latency_minutes, category_coverage)
VALUES
  ('pricecharting', 'PriceCharting Legendary', 'rest_api', 'vendor_derived',
   false, 1440, ARRAY['comics','sports_cards','tcg','lego','video_games','coins']),
  ('ebay_browse',   'eBay Browse API',         'rest_api', 'observed',
   false, 5,    ARRAY['comics','sports_cards','tcg','lego'])
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
```

`redistribution_allowed = false` is deliberately set for PriceCharting. Plan 2 reads this flag at runtime as a hard gate. Do not flip it without written vendor confirmation on file.

### A.3 Vendor product mapping

This is the join seam. PriceCharting product IDs must resolve to our `priced_unit_id`, and the mapping is a first-class reviewable record — not a guess baked into ingestion.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS vault_market.vendor_product_map (
    vendor_product_map_id bigserial PRIMARY KEY,
    data_source_id     smallint NOT NULL REFERENCES vault_market.data_source,
    vendor_product_id  text NOT NULL,
    vendor_product_name text NOT NULL,
    vendor_console_name text,                  -- PC's set/series field
    vendor_upc         text,
    priced_unit_id     bigint REFERENCES vault_core.priced_unit,
    match_method       text NOT NULL,          -- 'upc' | 'exact_name' | 'trgm' | 'manual' | 'unmatched'
    match_confidence   numeric(3,2),
    needs_review       boolean NOT NULL DEFAULT true,
    confirmed_at       timestamptz,
    confirmed_by       text,
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, vendor_product_id)
);

CREATE INDEX IF NOT EXISTS idx_vpm_unit    ON vault_market.vendor_product_map (priced_unit_id)
    WHERE priced_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vpm_review  ON vault_market.vendor_product_map (needs_review)
    WHERE needs_review;
CREATE INDEX IF NOT EXISTS idx_vpm_name_trgm
    ON vault_market.vendor_product_map USING gin (vendor_product_name gin_trgm_ops);

COMMIT;
```

**Matching rules (implement in `services/api/app/adapters/pricecharting/matcher.py`):**

1. UPC exact → `match_method='upc'`, confidence `0.98`, `needs_review = false`
2. Normalized name + set exact → `'exact_name'`, `0.90`, `needs_review = false`
3. `pg_trgm` similarity ≥ `0.82` → `'trgm'`, confidence = similarity, **`needs_review = true`**
4. Anything below → `'unmatched'`, `priced_unit_id = NULL`, `needs_review = true`

> **Invariant:** a row with `confirmed_at IS NOT NULL` is never overwritten by an automated re-match. New vendor data updates `last_seen_at` and nothing else.

### A.4 Adapter skeleton

```
services/api/app/adapters/
  base.py                       # MarketDataAdapter protocol — the swap seam
  pricecharting/
    __init__.py
    client.py                   # HTTP, token, retry, rate limit
    matcher.py                  # vendor_product_id -> priced_unit_id
    mapper.py                   # vendor fields -> (price_type, channel, condition_key)
    ingest.py                   # orchestration, idempotency, raw snapshot write
    models.py                   # Pydantic response models
```

`base.py` defines the protocol so PriceCharting, a future sold-comps vendor, and eBay Browse are interchangeable behind one interface. Nothing upstream imports `pricecharting` directly.

```python
class MarketDataAdapter(Protocol):
    source_key: str
    def fetch_snapshot(self, since: datetime | None) -> Iterable[RawVendorRecord]: ...
    def normalize(self, raw: RawVendorRecord) -> list[PriceObservation]: ...
```

### A.5 Environment

Append to `services/api/.env`:

```
PRICECHARTING_TOKEN=your-40-character-token
PRICECHARTING_BASE_URL=https://www.pricecharting.com
PRICECHARTING_RATE_LIMIT_RPS=1
PRICECHARTING_SNAPSHOT_DIR=D:/Projects/Business_Ideas/258_Labs/IQVault/data/raw/pricecharting
PRICECHARTING_ENABLED=true
```

### A.6 Acceptance — Phase A

- [ ] `evidence_class` and `data_source` seeded; `pricecharting` row present with `redistribution_allowed = false`
- [ ] Dry-run match over 500 known units reports counts by `match_method`
- [ ] ≥ 70% of comics inventory matched at `needs_review = false`
- [ ] Zero rows where `priced_unit_id IS NOT NULL AND needs_review = false AND match_confidence < 0.90`
- [ ] Re-running the matcher twice produces zero changes to confirmed rows

---

## PHASE B — Snapshot ingestion

**Migration:** `26_pricecharting_observations.sql`

### B.1 Extend the observation table

```sql
BEGIN;

ALTER TABLE vault_market.market_price_observation
  ADD COLUMN IF NOT EXISTS data_source_id  smallint REFERENCES vault_market.data_source,
  ADD COLUMN IF NOT EXISTS evidence_class  text REFERENCES vault_core.evidence_class,
  ADD COLUMN IF NOT EXISTS raw_snapshot_id bigint;

-- Backfill existing rows honestly rather than leaving NULLs
UPDATE vault_market.market_price_observation
   SET data_source_id = (SELECT data_source_id FROM vault_market.data_source WHERE source_key='ebay_browse'),
       evidence_class = 'observed'
 WHERE data_source_id IS NULL;

ALTER TABLE vault_market.market_price_observation
  ALTER COLUMN data_source_id SET NOT NULL,
  ALTER COLUMN evidence_class SET NOT NULL;

COMMIT;
```

> **Cursor hard stop:** if the backfill `UPDATE` would touch rows whose true source is not eBay Browse, stop and report the distinct existing source values instead of guessing.

### B.2 Immutable raw snapshots

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS vault_market.raw_vendor_snapshot (
    raw_snapshot_id  bigserial PRIMARY KEY,
    data_source_id   smallint NOT NULL REFERENCES vault_market.data_source,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    record_count     integer NOT NULL,
    payload_sha256   text NOT NULL,
    payload_path     text NOT NULL,
    ingest_status    text NOT NULL DEFAULT 'pending',
    UNIQUE (data_source_id, payload_sha256)
);

REVOKE UPDATE, DELETE ON vault_market.raw_vendor_snapshot FROM PUBLIC;

COMMIT;
```

Gzipped payload lands on disk under `PRICECHARTING_SNAPSHOT_DIR`; only the hash and path go in the row. The `UNIQUE` on `(data_source_id, payload_sha256)` gives free idempotency — an unchanged daily pull is a no-op, which also stops the series from accumulating fake "observations" on days the vendor didn't move.

### B.3 Field mapping

The PriceCharting grade ladder maps onto our orthogonal dimensions. **Do not invent condition keys** — map onto the existing seeded `condition_key` reference table and fail loudly if a target key is missing.

| PriceCharting key | `price_type` | `channel` | `condition_key` |
| --- | --- | --- | --- |
| `loose-price` | `market_value` | `pricecharting` | `raw_ungraded` |
| `graded-price` | `market_value` | `pricecharting` | `graded_9` |
| `box-only-price` | `market_value` | `pricecharting` | `graded_9_5` *(cards)* / `graded_9_2` *(comics)* |
| `manual-only-price` | `market_value` | `pricecharting` | `graded_9_8` *(comics)* |
| `bgs-10-price` | `market_value` | `pricecharting` | `graded_10` |
| `retail-new-buy` | `retail_buy` | `pricecharting` | `raw_ungraded` |
| `retail-new-sell` | `retail_sell` | `pricecharting` | `raw_ungraded` |

> **Cursor hard stop:** PriceCharting overloads the same JSON keys across categories — `box-only-price` means something different for a comic than for a card. The mapper must branch on the vertical resolved from `priced_unit`, not on the key name alone. If the vertical cannot be resolved, write `needs_review` and skip. Do not default.

`sales-volume` is not a price and does not belong in the price table:

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS vault_market.liquidity_observation (
    liquidity_observation_id bigserial PRIMARY KEY,
    priced_unit_id   bigint NOT NULL REFERENCES vault_core.priced_unit,
    condition_key    text NOT NULL REFERENCES vault_core.condition_key,
    data_source_id   smallint NOT NULL REFERENCES vault_market.data_source,
    observed_at      timestamptz NOT NULL,
    annual_units     integer,
    evidence_class   text NOT NULL REFERENCES vault_core.evidence_class,
    raw_snapshot_id  bigint REFERENCES vault_market.raw_vendor_snapshot,
    UNIQUE (priced_unit_id, condition_key, data_source_id, observed_at)
);

COMMIT;
```

### B.4 The nightly job

`services/api/app/jobs/pricecharting_snapshot.py`, scheduled **05:00 America/Chicago** — same slot as the existing IQVault signals agent, sequenced to run *before* it so signals see fresh prices.

Order of operations, all inside one transaction per batch:
1. Pull → write gzip to disk → insert `raw_vendor_snapshot` (`pending`)
2. If hash already exists → mark `duplicate`, exit 0
3. Match/refresh `vendor_product_map` (confirmed rows untouched)
4. Insert `market_price_observation` + `liquidity_observation` rows, all `evidence_class='vendor_derived'`
5. Mark snapshot `complete`

### B.5 Acceptance — Phase B

- [ ] Two consecutive runs on identical data create exactly one snapshot row
- [ ] Every new observation row has non-null `data_source_id`, `evidence_class`, `raw_snapshot_id`
- [ ] `SELECT count(*) FROM vault_market.market_price_observation WHERE evidence_class='observed' AND data_source_id = <pricecharting>` returns `0`
- [ ] `price_series(unit, condition, ...)` returns PriceCharting points alongside eBay points, distinguishable by channel
- [ ] Raw gzip file exists at the recorded path and its sha256 matches the row

---

## PHASE C — Derived series

**Migration:** `27_market_derived_series.sql`

No stored derived columns — that decision was already reversed once. Everything here is a function or a refreshable matview.

```sql
BEGIN;

-- Price change over a window, per unit+condition+channel
CREATE OR REPLACE FUNCTION vault_market.price_delta(
    p_priced_unit_id bigint,
    p_condition_key  text,          -- MANDATORY, no default
    p_channel        text,
    p_window_days    integer
) RETURNS TABLE (
    first_observed  timestamptz,
    last_observed   timestamptz,
    first_price     numeric,
    last_price      numeric,
    pct_change      numeric,
    observation_n   integer
) LANGUAGE sql STABLE AS $$
    WITH s AS (
        SELECT observed_at, price
          FROM vault_market.price_series(p_priced_unit_id, p_condition_key)
         WHERE channel = p_channel
           AND observed_at >= now() - make_interval(days => p_window_days)
         ORDER BY observed_at
    )
    SELECT min(observed_at), max(observed_at),
           (array_agg(price ORDER BY observed_at))[1],
           (array_agg(price ORDER BY observed_at DESC))[1],
           CASE WHEN (array_agg(price ORDER BY observed_at))[1] > 0
                THEN round(((array_agg(price ORDER BY observed_at DESC))[1]
                          - (array_agg(price ORDER BY observed_at))[1])
                          / (array_agg(price ORDER BY observed_at))[1] * 100, 2)
           END,
           count(*)::int
      FROM s;
$$;

COMMIT;
```

Then three more in the same migration:

- **`vault_market.grade_premium(p_priced_unit_id, p_low_condition, p_high_condition)`** → the multiple between two rungs of the ladder, plus its 90-day trend. Compressing premium = population catching up with demand = stop submitting. This is the direct feed into the existing Grading Optimizer.
- **`vault_market.ask_vs_market(p_priced_unit_id, p_condition_key)`** → median active eBay Browse ask ÷ PriceCharting market value. The single most useful number in the whole system, because it joins the two feeds we actually have.
- **`vault_market.mv_market_daily`** matview → one row per unit/condition/day with market value, median ask, annual units, 7/30/90d deltas. Refresh `CONCURRENTLY` at 05:30 CT after ingestion.

### C.1 Acceptance — Phase C

- [ ] Calling any function without a condition argument is a syntax error, not a default
- [ ] `price_delta` over a window with a single observation returns `pct_change = NULL`, not `0`
- [ ] `ask_vs_market` returns NULL rather than a ratio when either side has zero observations in the window
- [ ] Matview refresh completes in under 60s on the full catalog

---

## PHASE D — Deterministic signal emitters

**Migration:** `28_signal_emitters.sql`

This is the phase that unblocks Market Cycle Detector and Buy Opportunity Scanner. Critically: **these emitters contain no LLM call.** They are SQL and arithmetic, which means they cannot hallucinate and they are unit-testable. Orchestr8 agents *interpret* these signals; they do not generate them.

### D.1 Four emitters

| Emitter | Fires when | Reads as |
| --- | --- | --- |
| `ask_divergence_high` | median ask ÷ market value > 1.25, ≥ 5 active listings, sustained 3 days | sellers pricing ahead of the market — either a move starting or wishful thinking; resolves in ~7 days |
| `ask_divergence_low` | median ask ÷ market value < 0.85, ≥ 5 listings | liquidation pressure; in comics this often front-runs a real decline |
| `price_acceleration` | 30d delta > 15% **and** 7d delta > 7d delta of prior week | move underway, not just a level change |
| `lull_detected` | 90d \|delta\| < 3% **and** annual units down > 20% YoY | the "lull" you've been calling by feel, expressed as a number |
| `grade_premium_compression` | grade premium down > 15% over 90d | pop growth outrunning demand — Grading Optimizer should cool off |

### D.2 Signal row contract

Every emitted signal writes an evidence bundle, not a sentence:

```sql
CREATE TABLE IF NOT EXISTS vault_market.market_signal (
    market_signal_id bigserial PRIMARY KEY,
    emitter_key      text NOT NULL,
    emitter_version  text NOT NULL,
    priced_unit_id   bigint NOT NULL REFERENCES vault_core.priced_unit,
    condition_key    text NOT NULL REFERENCES vault_core.condition_key,
    fired_at         timestamptz NOT NULL DEFAULT now(),
    direction        text NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
    strength         numeric(3,2) NOT NULL CHECK (strength BETWEEN 0 AND 1),
    novelty          numeric(3,2) NOT NULL,
    evidence         jsonb NOT NULL,
    evidence_class   text NOT NULL REFERENCES vault_core.evidence_class,
    superseded_by    bigint REFERENCES vault_market.market_signal,
    UNIQUE (emitter_key, priced_unit_id, condition_key, fired_at)
);
```

`novelty` is the guard against the thing that kills signal systems: the same condition re-firing daily and drowning the real ones. Compute it as `1.0` on first fire, decaying toward `0.1` for each consecutive day the same emitter fires on the same unit. Anything under `0.3` is quarantined, not deleted — you want the false-positive pattern preserved for Phase F.

### D.3 Acceptance — Phase D

- [ ] Emitters run with zero network calls and zero LLM calls
- [ ] Backtest over the existing eBay observation history produces a plausible fire rate (target: under 2% of tracked units per day; if it's 40%, the thresholds are wrong — report, do not tune silently)
- [ ] Same emitter firing 5 days running produces 5 rows with strictly decreasing novelty
- [ ] Every row's `evidence` jsonb contains the input values that triggered it, sufficient to recompute the decision offline

---

## PHASE E — Prediction ledger auto-resolution

**Migration:** `29_prediction_resolution.sql`

The Prediction Ledger exists from migrations 11–16 and has never been automatically closed out. This phase makes the system able to learn.

```sql
ALTER TABLE vault_core.prediction_ledger
  ADD COLUMN IF NOT EXISTS resolution_method   text,     -- 'auto_price_series' | 'manual' | 'unresolvable'
  ADD COLUMN IF NOT EXISTS resolved_value      numeric,
  ADD COLUMN IF NOT EXISTS brier_score         numeric(4,3),
  ADD COLUMN IF NOT EXISTS resolution_evidence jsonb;
```

**Resolver job** (`jobs/resolve_predictions.py`, daily 06:00 CT):

1. Select predictions where `expires_at < now()` and `outcome IS NULL`
2. For each, evaluate its stated condition against `price_series()` at expiry
3. Write `outcome`, `resolved_value`, `resolution_evidence` (the actual series points used)
4. Compute Brier: `(probability - actual)²` where actual ∈ {0,1}
5. If the series has no observation within ±3 days of expiry → `resolution_method='unresolvable'`, **not** a guess

**Calibration view:** `vault_core.v_calibration` → mean Brier by category, by horizon, by originating agent, by evidence_class, with sample counts. Under 20 resolved predictions, report "insufficient sample" rather than a number. A confident calibration score computed from six predictions is worse than none.

### E.1 Acceptance — Phase E

- [ ] A prediction with no nearby observation resolves to `unresolvable`, never to `false`
- [ ] Brier scores only compute for predictions that carried an explicit probability
- [ ] `v_calibration` refuses to emit a score below n=20
- [ ] Re-running the resolver is idempotent — already-resolved rows are never rewritten

---

## PHASE F — Orchestr8 tool contracts and source scoring

**Migration:** `30_agent_market_tools.sql` + code

### F.1 Agent tool surface

Orchestr8 agents get three tools and **no direct database access**:

```python
# services/api/app/orchestr8/tools/market.py

@tool(contract="market.price_series.v1")
def get_price_series(priced_unit_id: int, condition_key: str,
                     window_days: int = 90) -> PriceSeriesResult:
    """Returns points with channel, evidence_class, and confidence_ceiling attached."""

@tool(contract="market.liquidity.v1")
def get_liquidity(priced_unit_id: int, condition_key: str) -> LiquidityResult:
    """Annual units, listing depth, days-to-sale estimate, and sample size."""

@tool(contract="market.grade_ladder.v1")
def get_grade_ladder(priced_unit_id: int) -> GradeLadderResult:
    """Every condition rung with value, premium vs raw, and 90d premium trend."""
```

Each result object carries `evidence_class` and `sample_n` on every value. Not on the response envelope — on every value.

### F.2 The confidence ceiling rule

Wire into the Recommendation Evidence Engine as a validator that runs *after* the agent produces output and *before* it is persisted:

```python
def enforce_confidence_ceiling(rec: Recommendation) -> Recommendation:
    ceiling = min(e.confidence_ceiling for e in rec.evidence_bundle)
    if rec.confidence > ceiling:
        rec.confidence = ceiling
        rec.add_note(f"Confidence capped at {ceiling} — "
                     f"weakest evidence is {weakest.evidence_class}")
    return rec
```

A recommendation built entirely on PriceCharting values cannot exceed `0.75` confidence. Ever. That is the mechanical expression of "a vendor estimate is not a fact," and it means the Critic agent no longer has to catch this by reading carefully.

### F.3 Critic agent rule additions

Add to the Critic contract:

- Reject any recommendation citing a single price point where `sample_n < 3`
- Reject any grading recommendation that does not cite `grade_premium` trend, not just current spread
- Flag any recommendation where `ask_vs_market` and `price_acceleration` disagree in direction — that's genuine ambiguity and should surface as ambiguity, not get averaged away

### F.4 Source accuracy backfill — closing the loop

Weekly job that finally makes `data_source.historical_accuracy` a measurement:

1. For each signal that fired ≥ 30 days ago, check whether the predicted direction matched the actual 30-day price move
2. Aggregate hit rate by `data_source_id` and by `emitter_key`
3. Write `historical_accuracy`, `accuracy_sample_n`, `accuracy_computed_at`
4. Emitters below 45% hit rate over n≥50 get auto-flagged for review — **flagged, not disabled**. Report to you; don't self-modify.

### F.5 Acceptance — Phase F

- [ ] An agent given only PriceCharting evidence cannot persist a recommendation above 0.75 confidence
- [ ] Every persisted recommendation has a replayable evidence bundle — same inputs reproduce the same output
- [ ] Critic rejects a synthetic single-point recommendation in test
- [ ] `historical_accuracy` is non-null for `pricecharting` after the first weekly run with sufficient sample

---

## 3. `.iqvplan.json` tags

```json
{
  "plan_id": "PC-CORE-01",
  "created": "2026-09-13",
  "phases": [
    { "id": "A", "title": "Source registry + vendor mapping",   "migration": 25, "status": "Now" },
    { "id": "B", "title": "Snapshot ingestion",                 "migration": 26, "status": "Now" },
    { "id": "C", "title": "Derived series",                     "migration": 27, "status": "Next" },
    { "id": "D", "title": "Signal emitters",                    "migration": 28, "status": "Next" },
    { "id": "E", "title": "Prediction auto-resolution",         "migration": 29, "status": "Next" },
    { "id": "F", "title": "Orchestr8 tools + source scoring",   "migration": 30, "status": "Next" }
  ],
  "blocked": [
    { "item": "PSA pop-report ingestion", "reason": "PSA connection deferred by decision" },
    { "item": "True sold comps",          "reason": "eBay Insights closed; PriceCharting official API has no sales history" }
  ]
}
```

---

## 4. What this plan explicitly does NOT do

- It does not replace the sold-comps gap. PriceCharting's official API has no sales history. The swap-seam in `base.py` stays open for a real comps vendor later.
- It does not touch CardSight, field modes, or any capture UX.
- It does not build a UI. Every phase is verified by SQL and pytest.
- It does not ingest pop reports. Deferred by prior decision; `grade_premium` is the interim proxy.
- It does not expose any vendor data outside the local stack. That's Plan 2, and it has its own gate.

---

## 5. Suggested Cursor run order

```
Opus      → review this plan against live schema, report conflicts, STOP
Composer  → Phase A migration + adapter skeleton + matcher
[you]     → run matcher dry-run, eyeball the needs_review queue
Composer  → Phase B migration + ingest job
[you]     → run 3 nightly cycles, confirm idempotency
Opus      → Phase C function design (condition-mandatory signatures)
Composer  → Phase C + D migrations
Grok      → pressure-test emitter thresholds against backtest, report fire rates
Opus      → Phase E + F contracts
Composer  → Phase E + F implementation
```
