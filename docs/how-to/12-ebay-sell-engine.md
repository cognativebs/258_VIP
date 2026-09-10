# eBay closed-loop selling engine

IQVault stays the system of record. VaultOS (decision layer in VIP) recommends
disposition, builds lots, ranks a daily queue, and talks to the **official eBay
Sell APIs**. This is not “mass list everything.”

```text
Physical asset → identify → FMV range → disposition → listing queue
  → human approval → Inventory API (item → offer → publish)
  → orders / traffic → INTERNAL_SALE observation → better next recommendation
```

Browse comps (`docs/how-to/10-ebay-comps.md`) are unchanged: active asks,
unverified. They never write `vault_market.sale`.

## What this is not

- Not a parallel eBay product identity. SKU is `IQV-{CATEGORY}-{holding id}`.
- Not a point `current_fmv` column. FMV is a range + evidence + confidence.
  Listing-time FMV is snapshotted and never overwritten after sale.
- Not auto-publish for high-value cards (`EBAY_HIGH_VALUE_USD`, default $50)
  unless `EBAY_AUTO_PUBLISH_HIGH_VALUE=true`.
- Fees are labeled **estimates** until a final fee source exists.
- Watcher/offer counts stay `null` unless Analytics exposes them.

## Environment

Copy `services/api/env.example` → `services/api/.env`. Sell OAuth is **user**
authorization-code + refresh token, distinct from Browse client-credentials.

```text
EBAY_ENV=sandbox
EBAY_APP_ID=
EBAY_CERT_ID=
EBAY_REDIRECT_URI=          # RuName from the eBay developer portal
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_MERCHANT_LOCATION_KEY=
EBAY_PAYMENT_POLICY_ID=
EBAY_RETURN_POLICY_ID=
EBAY_FULFILLMENT_POLICY_ID=
EBAY_HIGH_VALUE_USD=50
EBAY_AUTO_PUBLISH_HIGH_VALUE=false
```

Refresh tokens persist in `vault_collection.ebay_connection`. They are never
logged. HTTP status is written to `vault_collection.ebay_api_audit`.

## Migration

```bash
python scripts/migrate_db.py
```

Applies `infra/db/migrations/20260905_01_ebay_sell_engine.sql` (idempotent).

### Rollback

Stop the API. Then (destructive — do not run unless asked):

```sql
-- Review before executing. Drops sell-engine tables only.
DROP TABLE IF EXISTS vault_market.market_observation;
DROP TABLE IF EXISTS vault_market.marketplace_order_line;
DROP TABLE IF EXISTS vault_market.marketplace_order;
DROP TABLE IF EXISTS vault_market.listing_metric_snapshot;
DROP TABLE IF EXISTS vault_collection.selling_experiment_cohort;
DROP TABLE IF EXISTS vault_collection.selling_experiment;
DROP TABLE IF EXISTS vault_collection.listing_queue_item;
DROP TABLE IF EXISTS vault_collection.listing_lot_member;
DROP TABLE IF EXISTS vault_collection.listing_lot;
DROP TABLE IF EXISTS vault_collection.marketplace_listing;
DROP TABLE IF EXISTS vault_collection.disposition_history;
DROP TABLE IF EXISTS vault_collection.market_event;
DROP TABLE IF EXISTS vault_collection.ebay_api_audit;
DROP TABLE IF EXISTS vault_collection.ebay_connection;
ALTER TABLE vault_collection.holding
  DROP COLUMN IF EXISTS ebay_sku,
  DROP COLUMN IF EXISTS current_disposition,
  DROP COLUMN IF EXISTS sales_path_state,
  DROP COLUMN IF EXISTS sold_at;
```

Existing `listing_draft`, Browse `listing_observation`, and scan intake stay.

## Operator path

1. `npm run build:packages` then `npm run api` / `npm run web`.
2. Open http://127.0.0.1:3000/ebay — connection card must say Idle until OAuth.
3. Set the RuName **Auth Accepted URL** to
   `http://127.0.0.1:3000/ebay/oauth/callback`. On `/ebay`, click
   **Connect Sandbox seller** (do not copy JSON). The callback stores the
   refresh token. An Allow code works once; if save fails, click Connect again.
4. Run **Publish preflight** on `/ebay` (or `npm run job:ebay-preflight`)
   before the first publish and again after any environment switch. See
   [Preflight](#preflight).
5. Open `/ebay/queue` or an item at `/ebay/item/{holdingId}`.
6. Create draft → review title/images/price → Approve/publish.
7. Sandbox: ensure Inventory location (warehouse city/state/postal, key
   `EBAY_MERCHANT_LOCATION_KEY` or fallback `iqv_home`) → inventory item →
   offer (GTC, no MAP, listingDescription) → publish offer. Comics use
   category `259104` with Publisher / Issue Number / Era aspects.
8. Order ingest (`POST /api/ebay/sell/orders/ingest` or `npm run job:ebay-order-sync`)
   maps SKU → holding, marks listing SOLD, persists `holding.ebay_sku` /
   `sales_path_state=sold` / `sold_at`, writes `INTERNAL_SALE`.
   `daysToSale` is only computed when `listedAt` was set by a real publish.

## Preflight

`GET /api/ebay/sell/preflight` (button on `/ebay`, or `npm run job:ebay-preflight`)
rehearses the publish chain with GETs only. It creates nothing, so it is safe
against Production. One run reports every blocker instead of one per
Approve/publish click:

| Check | What a failure means |
|-------|----------------------|
| Granted OAuth scopes | The stored token predates a scope change — reconnect |
| Seller account privileges | Seller registration is incomplete on the connected account |
| Merchant inventory location | The key is not an **Inventory API** location. Seller Hub locations are a different list; the report prints the real keys |
| Payment / return / fulfillment policy | The configured ID is not on this account for this marketplace. The report prints the real IDs and names |
| Listing category | eBay rejects the category ID — offers only accept leaf categories. The report walks the subtree and prints the real leaf IDs and names from your own tree |
| Required item aspects | The category requires aspects the draft does not carry. Map them from stored fields; never invent values |
| Draft payload | The sample holding is missing images, identity or an FMV range |

Exit code is non-zero when any check fails. Category and aspect checks use a
client-credentials application token, because a Sell-scoped user token does not
carry `api_scope`. When that token cannot be minted the two checks report
`SKIP` — unverified, never `PASS`.

## Listing categories

An eBay offer can only carry a **leaf** category. Publishing under a parent
fails with `#25005 … The category selected is not a leaf category`, after the
offer has already been created — so the offer sits unpublished until the
category is fixed.

Defaults per asset kind (EBAY_US leaves, eBay's June 2026 structure):

| Kind | Category | Path |
|------|----------|------|
| `comic` | `259104` | Comic Books & Memorabilia 63 › Comics 259103 › Comics & Graphic Novels |
| `sports` | `261328` | Sports Trading Cards 212 › Trading Card Singles |
| `pokemon`, `mtg` | `183454` | Collectible Card Games 2536 › CCG Individual Cards |
| `other` | none | Spans the whole site, so no default can be right |

eBay renumbers categories on its own schedule and Sandbox trees lag
Production, so each kind is overridable with `EBAY_CATEGORY_<KIND>`
(`EBAY_CATEGORY_COMIC`, `EBAY_CATEGORY_SPORTS`, `EBAY_CATEGORY_POKEMON`,
`EBAY_CATEGORY_MTG`, `EBAY_CATEGORY_OTHER`). A renumbered category is a config
change, not a release.

When no category resolves, the draft carries `categoryId: null` and publish is
blocked with `CATEGORY_REQUIRED` rather than sending a placeholder eBay would
reject. Preflight's category check names the env var to set, and when eBay
rejects an ID it walks `get_category_subtree` and prints the real leaves
underneath it — read the answer off your own tree rather than a published list.

## Environment precedence

`EBAY_ENV=production` is the only thing that points publish at Production.
Anything else — unset, empty, `sandbox`, a typo — means Sandbox.
`EBAY_ENVIRONMENT` belongs to Browse comps, which default to Production and are
configured that way in `env.example`; it is deliberately ignored here so a comps
setting can never arm real, money-bearing listings.

`vault_collection.ebay_connection` keeps one row per environment, and the token
the engine reads is the row for whichever environment `EBAY_ENV` names. Sandbox
and Production tokens therefore coexist: switching back to Sandbox reuses the
Sandbox consent, and neither environment's token can be handed to the other's
API host. **Connect** and **Disconnect** both act on the current environment
only.

Before converting to Production: change `EBAY_ENV`, re-run **Connect** (each
environment needs its own consent, and preflight reports the unconnected one by
name), point the policy and location IDs at the Production account, and re-run
preflight. Production keysets also require the marketplace account deletion
endpoint in [11-ebay-marketplace-deletion.md](11-ebay-marketplace-deletion.md).

Publish auto-creates a missing Inventory API location on Sandbox only. On
Production the location must exist first, and preflight fails rather than warns
when it does not.

## Jobs (independent)

| Job | Command | Cadence |
|-----|---------|---------|
| Preflight | `npm run job:ebay-preflight` | Before a first publish and after any environment switch |
| Listing state | `npm run job:ebay-listing-sync` | GET offer per listing with an offer id; idle without OAuth |
| Orders | `npm run job:ebay-order-sync` | hourly while selling |
| Traffic | `npm run job:ebay-traffic-sync` | daily |

A traffic failure does not run inside the order job.

## Tests

```bash
npm run test -w @vip/ebay-sell
npm run test -w @vip/api
```

Live Sandbox publish is skipped without seller tokens. Unit tests cover SKU,
disposition bands, lot exclusivity, pricing math, FMV snapshot, days-to-sale,
duplicate order ingest, and duplicate publish prevention.

## UI

| Route | Purpose |
|-------|---------|
| `/ebay` | Connection, sales, funnel, errors, stale |
| `/ebay/queue` | Ranked daily queue |
| `/ebay/lots` | Low-dollar lot proposals |
| `/ebay/item/[id]` | Identity / valuation / disposition / listings / traffic / orders / observations / decisions |
| `/ebay/experiments` | $1–$5 singles vs lots experiment |

`/listings` remains the older local draft queue (`submitReady: false`). The
queue UI shows card titles (and cover thumbnails when present). Drafting a
listing mints and persists `holding.ebay_sku`.
