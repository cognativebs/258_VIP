# MVP User Journey

## One sentence

A collector imports a collection, scans or searches an item, sees a credible evidence-backed market range, understands liquidity and collection fit, gets a Buy / Hold / Grade / Sell / Pass call, and saves the decision with its evidence and outcome.

## Minimum backend capabilities (nothing else)

In order, these are the only capabilities required to make that sentence true:

1. **Immutable import** — Accept a source file (CLZ first), store a `RawSnapshot`, map into `Asset` + `Holding` without losing fields; regenerable derived rows.
2. **Catalog resolve** — Identify or attach the item to a canonical `Asset` / `PricedUnit` (search or scan → candidates).
3. **Market evidence read** — Return a **range** (`low`–`high`) with matched sale count, recency, and confidence — never a lone point as fact.
4. **Context signals** — Liquidity + collection fit (hunt / pillar / duplicate flags) as evidence inputs, not separate products.
5. **Decision engine** — Emit one canonical action with `reasonCodes`, supporting + opposing evidence, confidence, and rule/model version; honor user constraints.
6. **Decision persistence** — Save the chosen action (or override), the evidence bundle, and later the **outcome**.

The same engine later reframes the recommendation for an LGS (max buy offer + expected margin) by swapping constraints — that is post-MVP proof of F-01, not extra MVP scope.

## Explicitly not MVP

POS, marketplace automation, glasses, crossover ML, full multi-category launch, custom model training, zero-touch signal runs (Phase 4), VaultOS store pilot (Phase 6).
