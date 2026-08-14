# Plan 0001 — Catalog + market adapter rollout

Companion to ADR 0010. Phases are ordered so that each one is useful alone and
the risky, metered provider is not the first thing we depend on.

Out of scope this round: Yu-Gi-Oh (YGOPRODeck), SportsCardsPro / PriceCharting.

## Where we are

Already shipped (ADR 0009, PR #23):

- `CatalogAdapter` seam + fixture adapter
- Candidates staged as rows with confidence, match reasons, adapter id
- Confidence bands and an opt-in auto-resolve gate
- Canonical write only at resolve, transactional and idempotent

Missing: any real catalog, a resolver that fans out to several adapters,
response snapshotting, an identification cache, and accuracy measurement.

## Phase 0 — Resolver, cache, snapshots, benchmark harness

No provider accounts needed. This is the scaffolding every later phase plugs
into, and it is the phase that makes the metered free tier survivable.

**Build**

1. `CatalogResolver` in `@vip/scan-ingest`: ordered, category-aware fan-out over
   `CatalogAdapter[]`; per-adapter timeout and failure isolation; merge
   candidates on `external_id` match, recording corroboration in
   `match_reasons`.
2. Identification cache keyed on `raw_snapshots.content_hash` → resolver output.
   Same bytes must always yield the same candidates without a network call.
3. Snapshot every provider response into `vault_evidence.raw_snapshots` before
   parsing (ADR 0010 §4).
4. Wire `vault_market.id_observation` — it already exists and is unused. On
   resolve, write `predicted_asset_id`, `predicted_confidence`,
   `confirmed_asset_id`, `was_correct`, `ocr_text`. This table *is* the
   benchmark.
5. `scripts/benchmark_identification.py` (or a `@vip/jobs` task) reporting, per
   adapter: top-1 accuracy, exact-parallel accuracy, card-number accuracy,
   confidence calibration (predicted vs actual by band), failure rate, calls
   consumed.

**Gate:** replay a staged batch twice; second run makes zero provider calls and
produces byte-identical candidates. `id_observation` rows appear on resolve.

**Risk:** merging candidates on identity is the subtle part. Two adapters
returning the same card must corroborate, not double-count into a false margin —
which would wrongly satisfy the auto-resolve margin check.

## Phase 1 — TCGdex (Pokémon, free, no key)

First real adapter. Free and keyless, so it proves the resolver end to end
without spending anything or waiting on signup.

**Build:** `TcgdexCatalogAdapter` — search by name/number/set, map to
`CatalogCard`, populate `external_ids: [{ source: "tcgdex", value }]`.
Register for `category: "pokemon"`.

**Gate:** 25 real Pokémon scans; top-1 ≥ 80%; every candidate carries a `tcgdex`
external id; zero writes to `holding` before confirm.

**Note:** TCGdex embeds TCGplayer/Cardmarket prices and documents that some
variant→marketplace mappings are still wrong. Use TCGdex as **catalog truth
only**; pricing continues to come through `CompsAdapter`. Do not let a catalog
price become a valuation (rule 4).

## Phase 2 — Scryfall + MTGJSON (Magic, free)

**Build:** `ScryfallCatalogAdapter` (online, honour their rate-limit guidance)
and an MTGJSON bulk mirror for offline/local matching. Prefer the local mirror,
fall back to Scryfall.

**Gate:** 25 Magic scans; top-1 ≥ 85%; adapter works with the network disabled
when the mirror is present.

## Phase 3 — CardSight (sports + multi-category visual ID, metered)

The phase that decides whether we skip building computer vision.

**Prerequisite:** account + `CARDSIGHT_API_KEY` in secrets. Confirm the free
tier's published 750 calls/month and whether it includes full API access.

**Build:** `CardSightCatalogAdapter` as the primary resolver entry for
`sports`, and a cross-check for `pokemon`/`mtg`. Hard per-run call budget with a
loud stop when exceeded — never a silent partial batch.

**Gate — the real benchmark.** 100–250 deliberately messy cards from the actual
collection: Panini parallels (Silver vs Hyper vs Red Ice vs numbered), inserts,
serial-numbered, Pokémon illustration rares, older cards, and known duplicates.

| Metric | Target |
|---|---|
| Top-1 identity | ≥ 90% |
| Exact parallel | ≥ 75% |
| Card number | ≥ 95% |
| Confidence calibration | high band ≥ 90% actually correct |
| Hard failure (no candidate) | ≤ 5% |

Parallel accuracy is the metric that matters. Getting "2021 Prizm Ja Morant" and
missing "Red Ice /99" is a pricing error of an order of magnitude, and it is
exactly the case where a high confidence score would be most dangerous.

**Decision point:** if exact-parallel accuracy is poor but top-1 is strong,
keep CardSight for identity and add a parallel-disambiguation step (serial
number OCR, `image_embedding` on `asset`) rather than discarding the provider.

**Only after this gate passes** is enabling auto-resolution
(`VIP_SCAN_AUTO_RESOLVE=1`) worth discussing, and then only for the band the
calibration data supports.

## Phase 4 — Card Hedge (valuation, paid)

Separate seam, separate decision. Do not start before Phase 3 has a canonical
identity worth pricing.

**Build:** `cardHedgeAdapter` in `services/api/src/lib/comps/`, matching the
existing `CompsAdapter` contract: `matches()`, `fetchComps()`, `emptyReason`
when unconfigured. Prefer real transactions; if only a range is available,
emit boundary observations so `marketRange()` yields a genuine spread. Register
in `DEFAULT_ADAPTERS` and in `packages/signals` `DEFAULT_SOURCES` with
`authority: "market"` and its licence terms.

**Gate:** a holding with Card Hedge evidence shows a range with
`matchedSales > 0`, `recencyDays`, and a confidence band; with the key removed
the adapter goes idle and `insufficientMarketEvidence` stays true. No point
value is ever presented as fact.

**Follow-up:** persist observations into `vault_market.sale` →
`market_value`/`market_value_history`, which the schema already anticipates but
nothing currently writes.

## Phase 5 — eBay Catalog ePID (listing enrichment)

**Build:** after identity is confirmed, look up the eBay catalog product and
store `ebay_epid` as an `external_id`. Use it to prefill listing drafts
(title, aspects, stock imagery).

**Gate:** a confirmed card produces a listing draft carrying an ePID; drafts
stay `pending_credentials` without tokens and are never auto-submitted.

## Cross-cutting

- **Secrets:** `CARDSIGHT_API_KEY`, `CARD_HEDGE_API_KEY`, existing `EBAY_*`.
  Cloud Dashboard → Secrets; never committed.
- **Provenance:** every candidate stays `inferred · unverified` until resolve,
  regardless of provider confidence (rule 2).
- **Rule 5 check per phase:** if removing a provider breaks anything other than
  that adapter and its `external_id` rows, the seam is wrong.
- **Licence check per phase:** record terms in the source registry before the
  data reaches any surface beyond internal tooling.
