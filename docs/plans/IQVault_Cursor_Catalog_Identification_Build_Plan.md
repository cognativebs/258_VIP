# IQVault Cursor — Catalog Identification Build Plan (Phase 0)

Cursor work order for ADR 0010 / [plan 0001](0001-catalog-adapter-rollout.md) Phase 0.
The named file was not in the repo; this is the committed spec for the scaffolding
that later adapters (TCGdex, Scryfall, CardSight) plug into.

**Out of scope this slice:** live TCGdex/Scryfall/CardSight rollout gates,
Card Hedge valuation, eBay ePID, auto-resolve enablement, Yu-Gi-Oh,
SportsCardsPro / PriceCharting.

## Goal

Identification stays staged (ADR 0009). The resolver fans out to swappable
`CatalogAdapter`s, caches by scan `content_hash`, snapshots provider bytes
before parse, and writes `vault_market.id_observation` on resolve so accuracy
is measurable.

## Build

1. **Types + zod first** — `CatalogResolverResult`, adapter outcomes,
   `IdObservationRecord`, benchmark case/report in `@vip/scan-ingest`.
2. **`CatalogResolver`** — ordered, category-aware fan-out; per-adapter
   timeout and failure isolation; merge on `external_id` (corroboration in
   `match_reasons`, **no confidence boost**).
3. **Identification cache** keyed on `raw_snapshots.content_hash`. Same bytes
   → same candidates, zero provider calls.
4. **Snapshot sink** — write provider payload to `vault_evidence.raw_snapshots`
   (memory sink in tests; same hash-dedupe contract as live snapshots).
5. **`id_observation` on resolve** — `predicted_asset_id`,
   `predicted_confidence`, `confirmed_asset_id`, `was_correct`, `ocr_text`,
   `image_url`. Legacy table is `BIGSERIAL`; the link is
   `scan_unit.id_observation_ref` (text). `was_correct` stays null when the
   prediction had no asset id (do not treat “we just created this asset” as
   a correct prediction).
6. **Benchmark harness** — `scoreIdentificationBenchmark` (TS) and
   `scripts/benchmark_identification.py`: top-1, exact-parallel, card-number,
   confidence calibration by band, failure rate, calls consumed.

## Gates

- Replay the same `content_hash` twice: second run `providerCalls === 0` and
  byte-identical canonicalized candidates.
- A dead adapter does not fail the batch.
- Two adapters returning the same `external_id` produce one candidate;
  confidence equals the best single-adapter score.
- Resolve inserts an `id_observation` row and stamps `id_observation_ref`.
- Candidates remain `inferred · unverified` until operator confirm.

## Provenance

Every derived candidate: `method=inferred`, `verificationStatus=unverified`,
`ruleOrModelVersion=catalog-resolver@0.1.0` / `scan-id-matcher@0.1.0`.
Raw provider bytes are `observed` snapshots (rule 3).

## Decision this slice ends in

Review (default) or Hold/Sell only after confirm. Auto-resolve stays opt-in
and off (`VIP_SCAN_AUTO_RESOLVE`).
