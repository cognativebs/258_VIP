# How-to: card price history (TCGplayer)

Daily price history for the cards in your binders. Same job runs scheduled or
ad-hoc. TCGplayer is the source of truth; **NM is the condition** unless you ask
for another.

## Run it from Binder Vault (easiest)

Open Binder Vault (`npm run binder`, http://127.0.0.1:3010), then in the
**Ledger** panel under "Prices as of ...":

- **Update Prices** - today's Near Mint prices for the open binder
- **Backfill 1 yr** - the one-time history pull (see below)

Both record history and refresh the ledger, and report what changed
("Updated 2 card(s) - 60 new day(s) ... through 2026-08-16").

## Run it from the command line

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP
npm run job:price-history
```

Or double-click **`Update Card Prices.bat`**. Same code path as the button.

Safe to run repeatedly: history is keyed on card + day + printing + condition, so
a second run on the same day updates that day's row instead of adding another.

## First run: backfill instead of starting empty

TCGplayer serves history, so you do not have to wait weeks to accumulate it.
Measured against live data:

| Flag | Buckets | Granularity | Span |
|---|---|---|---|
| *(default)* | 30 | **1 day** | last ~30 days |
| `--range=quarter` | 30 | 3 days | ~87 days |
| `--backfill=annual` | 52 | 7 days | ~1 year |

```powershell
npm run job:price-history -- --backfill=annual   # one year, weekly
npm run job:price-history                        # then daily from here on
```

Run the annual backfill once, then let the daily job fill in fine detail going
forward. The two merge into the same table without conflicting.

## Schedule it daily

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\schedule_price_history.ps1
```

Registers a Windows task at 06:00 that catches up if the machine was asleep.

```powershell
Start-ScheduledTask   -TaskName "VIP Card Price History"   # run now
Get-ScheduledTaskInfo -TaskName "VIP Card Price History"   # last result
Unregister-ScheduledTask -TaskName "VIP Card Price History"
```

Pass `-Time "22:30"` to change the hour. The in-process scheduler
(`npm run start -w @vip/jobs schedule`) also runs it every 24h alongside the
other jobs, if you would rather keep one long-running process.

## Other flags

```powershell
npm run job:price-history -- --dry-run              # report, write nothing
npm run job:price-history -- --cards=base1-4        # one card
npm run job:price-history -- --condition=LP         # price a different grade
npm run job:price-history -- --limit=50             # first 50 cards
npm run job:price-history -- --concurrency=2        # be gentler on the API
```

## What gets stored, and what it means

Table: `vault_market.card_price_history`, one row per card / day / printing /
condition. It is **card-grained, not slot-grained**, so history survives
rearranging or deleting binder pages.

| Column | Meaning |
|---|---|
| `market_price` | TCGplayer's computed value for that day |
| `low_sale_price` / `high_sale_price` | Observed sale range; NULL when nothing sold |
| `transaction_count` / `quantity_sold` | Evidence count for the day |
| `condition` / `condition_assumed` | NM unless told otherwise; `condition_assumed` is TRUE only when TCGplayer did not report that grade |
| `prov_method` | `observed` when real trades backed the day, `normalized` when the price is TCGplayer's model with no sales |

That last distinction matters. TCGplayer publishes a market price **even on days
with zero sales** — for the Charizard used in testing, only 7 of 30 days had any
transactions. Those quiet days are recorded as `normalized · unverified`, not as
evidence of a trade, so a valuation built on this data can weight real sales
properly (rule 4).

## Condition

Prices are Near Mint by default, chosen explicitly: TCGplayer reports each grade
separately (NM / LP / MP / HP / Damaged) and the job filters for NM. Only when a
card has no NM row at all does it fall back to another grade, and that row is
flagged `condition_assumed = true` with `unverified` provenance.

Pricing a different grade is a read-only query — a `--condition=LP` run records
LP history but **never** changes your binder's displayed value, which always
represents an NM copy.

## Useful queries

```sql
-- How fresh is my collection's pricing, honestly (oldest, not newest)?
SELECT min(observed_on) AS oldest, max(observed_on) AS newest, count(DISTINCT external_id) AS cards
FROM vault_market.card_price_history WHERE condition = 'NM';

-- 30-day movement for one card, days with real sales only
SELECT observed_on, market_price, low_sale_price, high_sale_price, transaction_count
FROM vault_market.card_price_history
WHERE external_id = 'base1-4' AND condition = 'NM' AND transaction_count > 0
ORDER BY observed_on DESC;

-- Biggest movers over the last 30 days
WITH bounds AS (
  SELECT external_id,
         (array_agg(market_price ORDER BY observed_on DESC))[1] AS latest,
         (array_agg(market_price ORDER BY observed_on ASC))[1]  AS earliest
  FROM vault_market.card_price_history
  WHERE condition = 'NM' AND observed_on >= current_date - 30 AND market_price IS NOT NULL
  GROUP BY external_id
)
SELECT external_id, earliest, latest,
       round(100 * (latest - earliest) / NULLIF(earliest, 0), 1) AS pct_change
FROM bounds WHERE earliest IS NOT NULL ORDER BY pct_change DESC NULLS LAST LIMIT 20;
```

## Coverage limits

- Only cards with `source = 'pokemontcg'` and an external id are priced. Manually
  entered slots are skipped and counted in the report.
- Sports cards are not covered — that needs the catalog work in
  [ADR 0010](../adr/0010-catalog-resolution-and-market-providers.md).
- The job reads its database from `IQVAULT_DATABASE_DSN` / `DATABASE_URL`, so
  Postgres must be up (`docker compose up -d`).
