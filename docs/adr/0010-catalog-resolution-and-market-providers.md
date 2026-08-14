# ADR 0010 — Catalog resolution and market-data providers

Status: accepted (2026-08-10)
Extends: ADR 0008 (scan ingest), ADR 0009 (identity staging)
Scope note: Yu-Gi-Oh (YGOPRODeck) and SportsCardsPro / PriceCharting are
deliberately out of scope for this round.

## Context

Identification is the bottleneck. ADR 0009 made it safe to be wrong — candidates
stage separately and only cross into inventory at resolution — but the only
catalog behind it is a five-card fixture, so nearly every real scan lands in
`needs_review`.

Two conclusions from surveying providers:

1. There is no Scryfall-quality free catalog for modern sports cards with the
   full parallel matrix. Commercial APIs are materially better there.
2. The free/open stack is excellent for TCG (TCGdex for Pokémon, Scryfall and
   MTGJSON for Magic).

Provider capabilities and prices below are as published on 2026-08-10 and must
be re-checked at implementation time — they are inputs to a build order, not
commitments.

## Decision

### 1. Identity, valuation, and listing are three different jobs

They get three different seams. Conflating them is how a product ends up unable
to change pricing vendors without touching identification.

| Job | Question | Seam | Providers |
|---|---|---|---|
| Identity | "What card is this?" | `CatalogAdapter` (ADR 0009) | CardSight, TCGdex, Scryfall/MTGJSON |
| Valuation | "What is it worth, and is that trustworthy?" | `CompsAdapter` (existing) | Card Hedge, eBay sold, TCGplayer |
| Listing | "How does eBay refer to it?" | listing enrichment | eBay Catalog ePID |

### 2. VIP owns the canonical identity; providers are only cross-references

The spine already supports this and it does not change:

- `vault_core.asset.id` (UUID) is the master identifier.
- `vault_core.asset.slug` is the stable human-readable key
  (e.g. `2019-prizm-mclaurin-301-silver`).
- `vault_core.external_id (source, external_value)` — UNIQUE — holds
  `cardsight`, `tcgdex`, `scryfall`, `ebay_epid`, `cardhedge`, …

No provider id is ever a foreign key from `holding`, `sale`, or a decision.
Dropping a vendor must be a matter of stopping writes to one `external_id`
source, nothing more.

### 3. Resolution is an ordered, category-aware fan-out — not a single call

```
              staged scan unit
                     │
              ┌──────▼──────┐
              │ CatalogResolver
              └──────┬──────┘
     ┌───────────────┼────────────────┐
     ▼               ▼                ▼
 CardSight       category-native   Postgres assets
 (all cats)      TCGdex / Scryfall (already-confirmed)
     └───────────────┼────────────────┘
                     ▼
        merged candidates → confidence policy → staging
```

Rules for the resolver:

- Every adapter's output is scored by the **same** pipeline scorer, so a swap
  cannot silently redefine what `0.9` means (already true of `identifyUnit`).
- Candidates merge on canonical identity (matching `external_id`), not on
  display name. Two adapters agreeing is a **corroboration signal**, recorded in
  `match_reasons`, not a duplicate row.
- One adapter failing or being rate-limited degrades that adapter only. A dead
  provider must never fail a batch.
- Adapter id is already persisted per candidate
  (`scan_unit_candidate.adapter_id`), so accuracy is measurable per provider.

### 4. Provider responses are immutable evidence

Every external identification/pricing response is written to
`vault_evidence.raw_snapshots` before it is parsed (rule 3). Identification must
be reproducible after a vendor changes its model or disappears.

### 5. Identification is cached by image content hash

Scans are already hashed and deduped (`raw_snapshots.content_hash`). Cache
identification against that hash, so re-scans, retries, and re-runs after a
catalog upgrade cost zero API calls. This is a correctness property as much as a
cost one: the same bytes must not yield two different identities on two runs.

With a metered free tier (CardSight publishes 750 calls/month), an uncached
resolver would exhaust quota during a single benchmark.

### 6. Valuation providers obey rule 4 — ranges, never a point

Card Hedge exposes FMV with its own confidence and explanation. That must not
become `currentPrice = $X`. A pricing provider enters through `CompsAdapter` and
either:

- returns individual transactions as separate `CompSale` rows (preferred), or
- returns a range, which we record as boundary observations so
  `marketRange()` produces a real spread with `matchedSales`, `recencyDays`, and
  `confidence`.

A provider's own FMV number may be stored as *evidence*, never as the valuation.
When a provider is unconfigured it returns `emptyReason` and zero sales, exactly
like `ebay-sold` today — never a fabricated comp.

### 7. Licensing is a gate, not a footnote

Before any provider's data reaches a surface beyond Greg's own tooling, its
terms must be checked for redistribution / third-party-access limits, and the
answer recorded in the source registry `terms` field. This is why
SportsCardsPro is excluded from this round.

## Consequences

- We can defer building a sports-card computer-vision model, which is the single
  largest piece of work avoided here.
- We take on vendor dependency for the *quality* of identification, but not for
  its *structure*: canonical ids, staging, and confidence policy are ours.
- Cost is bounded by the content-hash cache plus an explicit per-run call
  budget.
- Accuracy becomes measurable per adapter, which is what makes "should we pay
  for this?" answerable with data instead of impressions.

## Alternatives rejected

- **One provider for everything.** Violates rule 5, and no single provider is
  best at both sports identity and TCG catalog depth.
- **Adopt a provider's id as our card id.** Cheap now, migration nightmare later,
  and it would leak a vendor into every downstream table.
- **Build the sports visual matcher first.** Months of work to reach a standard
  that a metered API already meets; revisit only if provider accuracy proves
  insufficient on the benchmark below.
