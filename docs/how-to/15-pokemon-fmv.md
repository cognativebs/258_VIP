# Pokémon FMV (PriceCharting guide)

What it is: a fair-market-value **range** for each Pokémon card you own or have on
your Binder wishlist, per condition (ungraded shown as "NM assumed", grades 7 / 8 /
9 / 9.5 from any grader, PSA / BGS / CGC / SGC 10). It comes from PriceCharting's
price guide, saved once a day. It is a vendor guide built from completed sales —
**not sold comps** — so confidence never goes above 0.75 (ADR 0012).

## Where you see it

- **Collection → Pokémon** (`http://localhost:3000/collections/pokemon`): the
  **FMV (GUIDE)** column, e.g. `NM assumed $15.00–$19.00 · PSA 10 $107.30 · 3× · 0d · conf 0.75`
  (range · how many daily snapshots · days since the newest · confidence). Click a
  card: the right panel lists every condition. Sort by the column to rank by the
  ungraded low.
- **Signals → Pokémon SIGNALS**: when a signal matches a card you own or want, its
  proposal lists that card's guide range as evidence, and so does the question sent
  to Orchestr8. Buy / Sell / Grade stay withheld — a guide is not sold comps
  (operator decision 2026-10-06).
- API: `http://localhost:8787/api/pokemon/fmv` (add `?externalId=me1-133` for one card).

Ranges start one day wide and widen as daily snapshots build up (30-day window).

## How it runs

The background jobs (window **IQVault Jobs**, started by the IQVault launcher) run
`pokemon-prices` once a day. Run it by hand (PowerShell, from the live folder):

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP-signals-spine
npm run job:pokemon-prices -- --dry-run
npm run job:pokemon-prices
```

It needs `PRICECHARTING_TOKEN` in `services\api\.env`. Without it the job says
`blocked` and prices nothing.

## Reviewing matches

A card is priced automatically only when exactly one English PriceCharting product
has the same set, number and name. Variants, duplicates and near misses wait for you;
the page shows **match needs review** and the panel shows the command.

```powershell
npm run job:pokemon-prices -- review
npm run job:pokemon-prices -- confirm <card id> <PriceCharting product id> --confirm-operator
```

`review` lists each card with the suggested product and why it was held back.
`confirm` accepts it (leave off the product id to accept the suggestion); the card is
priced on the next run.
