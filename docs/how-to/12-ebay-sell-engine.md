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
3. `GET /api/ebay/sell/auth/start` → open the URL → callback stores refresh token.
4. Open `/ebay/queue` or an item at `/ebay/item/{holdingId}`.
5. Create draft → review title/images/price → Approve/publish.
6. Sandbox: create/replace inventory item → create offer → publish offer.
7. Order ingest (`POST /api/ebay/sell/orders/ingest` or `npm run job:ebay-order-sync`)
   maps SKU → holding, marks SOLD, writes `INTERNAL_SALE`.

## Jobs (independent)

| Job | Command | Cadence |
|-----|---------|---------|
| Listing state | `npm run job:ebay-listing-sync` | every few hours |
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

`/listings` remains the older draft queue (`submitReady: false`).
