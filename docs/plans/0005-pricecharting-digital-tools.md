# Plan 0005 — PriceCharting Digital Tools wiring

**Plan ID:** `PC-TOOLS-01` (filed)
**Depends on:** [plan 0004](0004-pricecharting-core-wiring.md) Phases A–C green on **this** schema
**Live-repo companion:** [ADR 0011](../adr/0011-pricecharting-wiring-on-live-vip.md)

Parked until Core A–C is green here. Do not create `services/edge/` or
migrations `31`–`34` on this pass.

**ShopVault is saved for later** (owner, 2026-09-13). Do not design, migrate,
or scaffold ShopVault, shop inventory, aging reports, or
`/v1/shopvault/*`. The PriceCharting terms email in §4 is only required
when ShopVault comes off the shelf — not for VIP-internal use, and not for
GradeMath / Flip Score if those ship first. `redistribution_allowed` stays
`false` until a written vendor reply is filed under `docs/vendor/`.

Logical migration numbers `31`–`34` map to future `YYYYMMDD_NN_*.sql` files
(ADR 0011). Do not create `25_*.sql` / `31_*.sql` — filename order would run
them before the spine.

---

# PriceCharting → Digital Tools Wiring Plan

**Plan ID:** `PC-TOOLS-01`
**Date:** 2026-09-13
**Owner:** Gregory Williamson — 258 Services LLC
**Depends on:** `PC-CORE-01` Phases A–C complete and green
**Migrations reserved:** `31` – `34`
**New service:** `services/edge/` (FastAPI, deployed Railway or Render)

---

## 0. The one rule this entire plan is built around

`vault_market.data_source.redistribution_allowed = false` for PriceCharting.

Pulling their numbers to power *your* decisions is unambiguously fine — that's what the subscription is for. Shipping those numbers to a paying customer is redistribution, and vendors terminate accounts over it. Two of your five products (Flip Score, ShopVault) are exactly where a sloppy implementation would cross that line without anyone noticing until the cutoff email arrives.

So the architecture has one non-negotiable shape:

> **The edge ships answers, never tables.**

A customer receives `"break-even is $71.40, submit"` or `"Flip Score 82, thin liquidity"`. A customer never receives `{"loose-price": 4200, "graded-price": 9100}`. This is both the compliant design *and* the better product — you're selling judgment, not a price lookup they could get free on the website.

Build the enforcement in code, not in discipline. Discipline fails at 11pm during a launch.

---

## 1. Standing constraints for Cursor

Append to `AGENTS.md`:

```
## PC-TOOLS-01 constraints

HARD STOPS — stop and report:
1. If any edge endpoint would return a raw vendor price field, STOP.
2. If any response schema contains a field name matching the vendor's
   own key names (loose-price, graded-price, retail-new-buy, etc.), STOP.
3. If the edge service imports anything from app.adapters.*, STOP.
   The edge never talks to a vendor. It reads the derived layer only.
4. If a bulk/export/CSV endpoint is added to the edge, STOP and ask.
5. If redistribution_allowed is read as anything other than a hard gate,
   or is hardcoded true, STOP.
6. No customer-facing endpoint may run without a valid license key.
7. Report design conflicts. Do not choose for me.
```

---

## 2. Product → engine map

| Product | Price | Engine it needs | Core-plan dependency |
| --- | --- | --- | --- |
| GradeMath | $19 | grade ladder + fee model | Phase C `grade_premium` |
| 90-Second Comp Check | $12 | static comp cards, no live API | Phase C matview |
| Flip Score System | $37 | scoring endpoint | Phase C `ask_vs_market` + liquidity |
| ShopVault | $147 | buy-offer + margin + aging | Phase B `retail_buy` / `retail_sell` |
| Collector to Dealer | $197 | all of the above, as demos | all |

One data layer. Five price points. That's the leverage — and it's why building the edge properly once is worth more than shipping GradeMath a week earlier with a shortcut.

---

## PHASE 1 — The compliance gate and the edge service

**Migration:** `31_tools_edge_foundation.sql`

### 1.1 The published layer

The edge does not read `market_price_observation`. It reads a deliberately narrow published view that contains **derived outputs only** and physically cannot leak a vendor price.

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS vault_edge;

-- Derived-only. No absolute vendor prices. Ratios, bands, and verdicts.
CREATE MATERIALIZED VIEW vault_edge.mv_unit_derived AS
SELECT
    pu.priced_unit_id,
    pu.display_name,
    pu.vertical,
    ck.condition_key,
    -- BANDS, not points. A band is ours; a point is theirs.
    width_bucket(mv.market_value, 0, 10000, 40)          AS value_band,
    round(mv.market_value / nullif(lag_90.market_value,0), 3) AS ratio_90d,
    round(am.ask_over_market, 3)                          AS ask_over_market,
    gp.premium_multiple,
    gp.premium_trend_90d,
    li.annual_units,
    li.annual_units_yoy_pct,
    mv.observation_n,
    mv.last_observed_at,
    'vendor_derived'::text                                AS evidence_class
FROM vault_market.mv_market_daily mv
JOIN vault_core.priced_unit pu USING (priced_unit_id)
JOIN vault_core.condition_key ck USING (condition_key)
LEFT JOIN LATERAL vault_market.grade_premium(pu.priced_unit_id, 'raw_ungraded', ck.condition_key) gp ON true
LEFT JOIN LATERAL vault_market.ask_vs_market(pu.priced_unit_id, ck.condition_key) am ON true
LEFT JOIN vault_market.liquidity_observation li
       ON li.priced_unit_id = pu.priced_unit_id AND li.condition_key = ck.condition_key
LEFT JOIN LATERAL (...) lag_90 ON true
WHERE mv.observed_on = current_date;

CREATE UNIQUE INDEX ON vault_edge.mv_unit_derived (priced_unit_id, condition_key);

COMMIT;
```

**`value_band` is the trick.** The edge needs to reason about value without ever transmitting one. A 40-bucket band over the range is enough for break-even math and scoring, and is not a resellable price list. Where an absolute dollar figure genuinely must reach the customer — GradeMath's break-even, ShopVault's max offer — it is *computed at the edge and returned as a single decision-specific number*, never as a catalog row.

### 1.2 Role separation

```sql
BEGIN;

CREATE ROLE vault_edge_reader NOLOGIN;
GRANT USAGE ON SCHEMA vault_edge TO vault_edge_reader;
GRANT SELECT ON vault_edge.mv_unit_derived TO vault_edge_reader;

-- Explicitly and permanently denied
REVOKE ALL ON SCHEMA vault_market FROM vault_edge_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA vault_market FROM vault_edge_reader;

COMMIT;
```

The edge connects as `vault_edge_reader`. If someone later writes an endpoint that queries a vendor table, it fails with a permission error in dev rather than shipping to customers. **This is the enforcement.** Everything else is a comment.

### 1.3 Licensing

```sql
BEGIN;

CREATE TABLE vault_edge.license (
    license_id     bigserial PRIMARY KEY,
    license_key    text UNIQUE NOT NULL,
    product_sku    text NOT NULL,          -- 'grademath' | 'flipscore' | 'shopvault' | ...
    customer_email text NOT NULL,
    status         text NOT NULL DEFAULT 'active',
    seats          integer NOT NULL DEFAULT 1,
    calls_per_day  integer NOT NULL DEFAULT 200,
    issued_at      timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz,
    payment_ref    text
);

CREATE TABLE vault_edge.usage_log (
    usage_id     bigserial PRIMARY KEY,
    license_id   bigint NOT NULL REFERENCES vault_edge.license,
    endpoint     text NOT NULL,
    called_at    timestamptz NOT NULL DEFAULT now(),
    unit_count   integer NOT NULL DEFAULT 1
);

CREATE INDEX ON vault_edge.usage_log (license_id, called_at DESC);

COMMIT;
```

`calls_per_day` exists for two reasons: it caps your vendor exposure, and it makes "someone bought GradeMath and is running a scraping business through it" visible on day one instead of month four.

### 1.4 Service skeleton

```
services/edge/
  main.py
  auth.py               # license key -> License, rate limit check
  policy.py             # THE GATE — see below
  engines/
    grademath.py
    flipscore.py
    shopvault.py
  schemas/              # Pydantic response models, derived fields only
  tests/
    test_policy.py      # must fail loudly on any raw-price leak
```

`policy.py` is a response middleware, not a convention:

```python
BANNED_RESPONSE_KEYS = {
    "loose_price", "loose-price", "graded_price", "graded-price",
    "box_only_price", "manual_only_price", "bgs_10_price",
    "retail_new_buy", "retail_new_sell", "market_value",
    "vendor_price", "price_table", "grade_ladder_prices",
}

def assert_no_redistribution(payload: dict, source_redistributable: bool) -> None:
    if source_redistributable:
        return
    leaked = _walk_keys(payload) & BANNED_RESPONSE_KEYS
    if leaked:
        raise RedistributionViolation(f"Blocked keys in response: {leaked}")
```

Wire it as a FastAPI response middleware on every route. Test it with a deliberately non-compliant fixture that **must** raise. If `test_policy.py` ever gets skipped or xfailed, that's a stop-the-line event.

### 1.5 Acceptance — Phase 1

- [ ] Edge service cannot `SELECT` from `vault_market.*` — verified by an integration test that expects a permission error
- [ ] `test_policy.py` fails the build when given a payload containing a banned key
- [ ] Every endpoint 401s without a license key and 429s past `calls_per_day`
- [ ] `mv_unit_derived` contains zero absolute vendor prices — verified by a column-name assertion test

---

## PHASE 2 — GradeMath ($19)

**Migration:** `32_grademath.sql` (fee tables only)
**Ship target:** first, per your build order. This is the one that proves the whole edge works.

### 2.1 What changes about the product

Right now GradeMath is conceived as a calculator: the buyer types in numbers they looked up. With the edge behind it, the buyer types in a **card name** and the grade ladder arrives automatically. That is a different product at the same price, and it's the difference between a $19 one-time sale and something you can raise to $29 with a straight face.

### 2.2 Fee model — the part that's actually yours

```sql
CREATE TABLE vault_edge.grading_tier (
    grading_tier_id serial PRIMARY KEY,
    grader          text NOT NULL,        -- 'PSA' | 'CGC' | 'BGS'
    tier_name       text NOT NULL,
    max_declared    numeric,
    fee_per_card    numeric NOT NULL,
    turnaround_days integer,
    vertical        text NOT NULL,
    effective_from  date NOT NULL,
    effective_to    date,
    UNIQUE (grader, tier_name, vertical, effective_from)
);
```

Versioned by `effective_from` because grader fees change 2–3× a year and your customers will absolutely email you about it. Being correct the week PSA changes prices is a small, cheap reputation win.

### 2.3 The endpoint

```
POST /v1/grademath/breakeven
{
  "query": "Absolute Batman #1 CGC",   // or priced_unit_id
  "grader": "CGC",
  "tier": "modern",
  "shipping_out": 18.00,
  "shipping_return": 22.00,
  "insurance_pct": 1.0,
  "cards_in_submission": 12,
  "expected_grade_distribution": { "9.8": 0.55, "9.6": 0.30, "9.4": 0.15 }
}
```

Returns:

```json
{
  "verdict": "SUBMIT",
  "breakeven_raw_value": 71.40,
  "expected_value_after_fees": 143.20,
  "expected_margin_pct": 48.0,
  "downside_if_9_4": -12.60,
  "all_in_cost_per_card": 26.83,
  "grade_premium_trend_90d": -4.2,
  "confidence": 0.75,
  "confidence_note": "Capped — valuation is a third-party estimate",
  "sample_size": 6,
  "warnings": ["Grade premium compressing — value gap narrowing over 90 days"]
}
```

Three things make this defensible rather than a spreadsheet:

- **`downside_if_9_4`** — every competitor shows upside only. Showing the bad case is the thing that makes a dealer trust you.
- **`grade_premium_trend_90d`** — direct from `PC-CORE-01` Phase C. Nobody at this price point has this, because nobody else has been snapshotting for a year.
- **`confidence_note`** — the same ceiling rule from the core plan, surfaced honestly to the customer. Counterintuitively this *sells*; it reads as a professional who knows what their data is.

### 2.4 Delivery

Static React page on Vercel, license key in localStorage, calls the edge. No account system, no database on the customer side. Gumroad delivers the key on purchase via webhook → `POST /v1/licenses/issue`.

### 2.5 Acceptance — Phase 2

- [ ] Unknown card returns a graceful "not in catalog, enter values manually" path — the calculator still works offline
- [ ] Response contains no vendor price keys (policy middleware green)
- [ ] Fee math verified against 5 hand-calculated submissions you've actually done
- [ ] Works on a phone at a card show on cellular in under 3 seconds

---

## PHASE 3 — 90-Second Comp Check ($12)

**No migration. No live API.**

This one stays static on purpose. It's a $12 checklist; putting a live API behind it creates support burden that the price can't carry, and creates redistribution exposure for no revenue.

**Build:** a nightly generator (`jobs/generate_comp_cards.py`) that produces a PDF + printable card for the top ~200 units per vertical containing *methodology*, not prices:

- the 90-second sequence itself (what to check, in what order)
- condition-anchor photos from your own captures
- the ratio rules — "if ask is more than 1.25× recent market, walk" — which are *your* thresholds derived from your own emitters, not vendor data
- a QR code to the GradeMath page, which is the upsell path

**The strategic point:** this product's job is to be the $12 thing that proves you know what you're talking about, and to funnel to Flip Score and the course. Don't over-engineer it. Ship it in a weekend.

### Acceptance — Phase 3
- [ ] PDF generates deterministically from the matview
- [ ] Contains zero dollar figures sourced from the vendor
- [ ] QR conversion tracked with a UTM so you know if the funnel works

---

## PHASE 4 — Flip Score System ($37)

**Migration:** `33_flipscore.sql`

### 4.1 The scoring model

Flip Score was originally going to need invented proxies for liquidity and spread. Now it has real inputs:

| Dimension | Weight | Source |
| --- | --- | --- |
| Spread | 30% | `retail_sell − retail_buy` ratio (computed at edge, band-safe) |
| Liquidity | 25% | `annual_units` + listing depth |
| Momentum | 20% | `ratio_90d` + `price_acceleration` signal |
| Ask discount | 15% | `ask_over_market` vs the specific deal's ask |
| Grade upside | 10% | `premium_multiple` + trend |

Store the weights in a table, not in code — you will tune these, and a customer-visible "model v1.3" is a feature.

```sql
CREATE TABLE vault_edge.score_model (
    score_model_id serial PRIMARY KEY,
    model_version  text UNIQUE NOT NULL,
    weights        jsonb NOT NULL,
    published_at   timestamptz NOT NULL DEFAULT now(),
    is_current     boolean NOT NULL DEFAULT false
);
```

### 4.2 Endpoint

```
POST /v1/flipscore
{ "query": "...", "asking_price": 340.00, "condition": "raw_ungraded" }
→ {
    "flip_score": 82,
    "band": "STRONG",
    "model_version": "1.0",
    "reason_codes": [
      "SPREAD_WIDE", "LIQUIDITY_THIN", "MOMENTUM_POSITIVE", "ASK_BELOW_MARKET"
    ],
    "primary_risk": "Thin liquidity — 14 annual units. Budget 60+ days to exit.",
    "confidence": 0.75
  }
```

**Reason codes, not prose.** They're deterministic, they're translatable into the Notion template, they're testable, and they cost no tokens. The Notion product ships with a lookup table mapping each code to a paragraph — which means the $37 template has depth without you writing an LLM bill into your margin.

### 4.3 Notion delivery

The Notion template holds the framework and the code lookups; a button block calls the edge. Customers who never wire up the key still get a usable manual scorer — which matters, because roughly half of Notion template buyers never configure anything.

### Acceptance — Phase 4
- [ ] Score is deterministic: same inputs → same score, always
- [ ] `LIQUIDITY_THIN` fires correctly on a hand-picked thin unit
- [ ] Manual-mode Notion template produces a score within ±8 of the API on 10 test items
- [ ] No endpoint returns spread in dollars — only the derived ratio and band

---

## PHASE 5 — ShopVault ($147)

**Owner hold (2026-09-13): saved for later. Skip this phase.** Do not
implement anything in this section until the owner unparks ShopVault.

**Migration:** `34_shopvault.sql`

This is the highest-revenue product and the highest redistribution risk. A card shop's whole desire is "give me a price list." That is precisely the thing you cannot sell.

### 5.1 Reframe: offer engine, not price list

The shop doesn't get prices. The shop gets **offers on specific items they are actually holding or considering.** Same information value to them, entirely different artifact.

```
POST /v1/shopvault/intake
{
  "items": [ { "query": "...", "condition": "...", "qty": 3 }, ... ],
  "margin_target_pct": 40,
  "cash_available": 800,
  "velocity_preference": "fast"
}
→ {
    "lot_max_offer": 612.00,
    "lot_expected_resale": 1180.00,
    "lot_expected_margin_pct": 48.1,
    "items": [
      { "line_ref": 1, "max_offer": 84.00, "expected_days_to_sell": 21,
        "verdict": "TAKE", "reason_codes": ["MARGIN_OK","VELOCITY_FAST"] },
      { "line_ref": 2, "max_offer": 0,      "verdict": "PASS",
        "reason_codes": ["LIQUIDITY_DEAD","MARGIN_THIN"] }
    ],
    "cash_constraint_note": "Offer trimmed to fit $800 — 2 lines dropped by lowest margin"
  }
}
```

`max_offer` is an absolute dollar figure, and that's fine: it's *your* computation from *their* inputs (margin target, cash, velocity), not a vendor catalog value. One number per item they're holding in their hand. A competitor cannot rebuild a price guide from it at any reasonable rate, and `calls_per_day` caps the attempt.

### 5.2 Inventory aging

```sql
CREATE TABLE vault_edge.shop_inventory (
    shop_inventory_id bigserial PRIMARY KEY,
    license_id     bigint NOT NULL REFERENCES vault_edge.license,
    priced_unit_id bigint,
    free_text      text,
    condition_key  text,
    cost_basis     numeric NOT NULL,
    acquired_on    date NOT NULL,
    listed_on      date,
    sold_on        date,
    sold_price     numeric,
    UNIQUE (license_id, shop_inventory_id)
);
```

Row-level isolation by `license_id` on every query — enforce with RLS, not a `WHERE` clause someone forgets:

```sql
ALTER TABLE vault_edge.shop_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON vault_edge.shop_inventory
    USING (license_id = current_setting('app.license_id')::bigint);
```

**The aging report is the retention hook.** "These 14 items have been sitting 90+ days and are down 8% since you bought them — here's the markdown that still clears your floor." That's the thing a shop owner opens every Monday, and it runs entirely on the price history you started building in `PC-CORE-01` Phase B. It is impossible to offer without a year of snapshots, which is your actual competitive position.

### 5.3 Acceptance — Phase 5
- [ ] RLS verified: license A cannot read license B's inventory even with a crafted request
- [ ] `cash_available` constraint provably respected — sum of offers never exceeds it
- [ ] `PASS` verdicts explain themselves with reason codes
- [ ] Aging report runs against ≥ 90 days of snapshot history or degrades gracefully with a stated sample size

---

## PHASE 6 — Collector to Dealer ($197)

No build. The course is the **demonstration layer** for everything above.

Structure each module around a live tool:

| Module | Tool used on camera |
| --- | --- |
| Reading a grade ladder | GradeMath |
| The 90-second floor decision | Comp Check |
| Scoring a deal you're offered | Flip Score |
| Buying a collection | ShopVault intake |
| Knowing when a market has stalled | the lull signal from Phase D |

The course sells the tools and the tools prove the course. Price the bundle at $247 and every tool becomes a lead magnet for the highest-margin product you have.

**One content asset worth building:** a public-facing monthly "state of the market" post generated from your own signal emitters. It costs you a cron job, it's genuinely proprietary (nobody else has your time series), and it's the single best top-of-funnel artifact available to you. Instagram-native, no ad spend.

---

## 3. `.iqvplan.json`

```json
{
  "plan_id": "PC-TOOLS-01",
  "created": "2026-09-13",
  "depends_on": ["PC-CORE-01:A", "PC-CORE-01:B", "PC-CORE-01:C"],
  "phases": [
    { "id": 1, "title": "Compliance gate + edge service", "migration": 31, "status": "Now" },
    { "id": 2, "title": "GradeMath",                      "migration": 32, "status": "Now" },
    { "id": 3, "title": "90-Second Comp Check",           "migration": null, "status": "Next" },
    { "id": 4, "title": "Flip Score System",              "migration": 33, "status": "Next" },
    { "id": 5, "title": "ShopVault",                      "migration": 34, "status": "Later" },
    { "id": 6, "title": "Collector to Dealer",            "migration": null, "status": "Later" }
  ],
  "blocked": [
    { "item": "ShopVault aging report",
      "reason": "Needs 90+ days of snapshot history from PC-CORE-01 Phase B" }
  ]
}
```

ShopVault is tagged `Later` for a reason beyond effort: its best feature needs 90 days of accumulated history. Start the core snapshot job now and ShopVault becomes buildable in December with a feature nobody can copy.

---

## 4. Before you write any of this

**Email PriceCharting.** One paragraph:

> I subscribe at the Legendary tier and use the API for internal valuation. I'm building tools I sell to collectors and card shops that return *derived outputs only* — a break-even calculation, a 0–100 deal score, a maximum-offer figure — never raw price fields, price tables, or bulk exports. Customers are rate-limited and licensed individually. Can you confirm this is within terms, and if not, what tier or agreement would cover it?

Cost: five minutes. Value: you find out before ShopVault's architecture assumes an answer. If they say no, Phases 2 and 4 still ship unchanged (they return computed verdicts), and Phase 5 needs a different data path — much cheaper to learn now than at $147 × 30 shops.

Put their reply in `docs/vendor/` and reference it in `data_source.terms_url`. If they say yes in writing, that's when `redistribution_allowed` gets reconsidered — by you, in a commit with the email attached, and never by Cursor.

---

## 5. What this plan explicitly does NOT do

- No bulk export endpoint, at any tier, for any customer. Ever.
- No customer-facing raw price lookup — that's the vendor's product, not yours.
- No LLM in the scoring path. Scores are deterministic arithmetic; margins survive.
- No multi-tenant auth system beyond license keys until ShopVault has 10 paying shops.
- No mobile app. Mobile web, phone-sized, works at a show. Revisit after revenue.
