# Build Spec — Card Identification v2 (Pokémon first)

**ID:** `scan-id-v2-pokemon`
**Verification:** draft — authored in Claude Code from the 2026-10-11 operator review; **not yet run through the Build Spec / Challenge Council**. Run a Challenge pass (ADR 0003 · O2) before Cursor executes.
**Operator decisions (Greg, 2026-10-11):** stop patching the v1 pipeline (P1); Pokémon first, sports after (P2); identification budget up to **$0.04 per card** (P3); the operator review of batches `ed919c12` (Pokémon) and `7025bfdd` (sports) is done (P4).

> Execute in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Why (evidence)

v1 is a chain: OCR the whole card → guess name/number from words → text search a catalog → token-overlap score. One misread breaks it, and the score does not mean what it says.

- Pokémon batch `ed919c12` (25 cards): **20/25 right** by the card images. All five misses trace to the bottom identifier strip (`PFL 005/094`, `MEE 003`, `MEG 124/132`) not being read: a reprint from another set (Lotad → McDonald's 2015), a wrong card with the same number (Narrow Gym vs Premium Power Pro), and three Basic Energy cards whose type is an icon.
- Review made it worse: the operator confirmed 4 of the 5 misses because Review offered no way to pick the right card, and edited names come out garbled (`2021 2021 Panini Donruss Donruss Baker Mayfield #195`).
- Measurement is blind: `id_observation.was_correct` stays null whenever the guess came from a live catalog (no asset id yet), so `score_scan_identification.py` reports "unknown" for every card.
- Sports batch `7025bfdd` (23 cards): right player usually, exact card (parallel) often not — the right card sat at #3 or #5 for two of them.

## Goal

Identify a scanned Pokémon card to the exact printing (TCGdex id) from the master images, with a confidence that means something, and give the operator a Review screen where confirming or correcting a card takes seconds. Measure every change against a fixed truth set before it ships.

## Pass bar (acceptance, measured by the benchmark in O5)

- On `data/scan-golden/ed919c12-pokemon.json`: **top-1 exact printing ≥ 24/25 (95%)**, right card within the top 3 for **25/25**.
- **Zero confident-wrong:** no card the pipeline marks HIGH may be wrong.
- The double-fed card (unit 0045) is flagged.
- Mean identification cost **≤ $0.04 per card**, measured and recorded per card.
- The five `verification: "unverified"` truth rows must be confirmed by the operator before the bar is declared passed.

## Constraints

- AGENTS.md applies in full: provenance on every derived field (source, method, rule/model version, confidence, verification); inferred values never stored as verified; raw captures immutable; `needs_review` is never auto-cleared; confirmed identities are never silently overwritten; adapters swappable; no TCGplayer API.
- TypeScript + zod contracts first; apps consume packages; packages never reach the DB.
- v2 runs behind `VIP_SCAN_ID_V2=1` until the pass bar is met; v1 stays the default and is not patched further (operator P1).
- Every provider response (catalog JSON, official card image, vision reply) is a raw snapshot; processed results are regenerable from snapshots. Vision readings reuse the existing `scan_vision` cache (merged `bd047ec`).
- Budget is enforced in code, not by convention: a per-card meter stops escalation at $0.04 and records spend in provenance.
- Sports, MTG and comics are out of scope for this spec; nothing here may regress them (v1 path unchanged for them).
- No new table or column beyond those in the file plan; anything else is reported, not added.

## Pipeline

1. **O1 · Strip reader.** Crop the identifier strip from the full-resolution front master (modern Pokémon: bottom band, left third — region per OCR profile, not hard-coded in the pipeline). Read it with Tesseract (`--psm 7`, 3× upscale) and parse `SETCODE [LANG] NNN[/TTT]`. Map the set code with TCGdex `set.abbreviation.official` (`PFL→me02`, `JTG→sv09`, `MEE→mee`, `SVE→sve`, `MEG→me01`, `PBL→me05`), plus a small reviewed override table for codes TCGdex lacks. If the strip OCR does not parse, send **only the strip crop** to vision (low detail) — not the whole card. A parsed code + number is an exact lookup (`/cards/{setId}-{localId}`).
2. **Candidates.** Union of: the strip lookup (if any), the existing name/number TCGdex search, and confirmed VIP assets. Keep at most 5.
3. **O2 · Picture check.** For each candidate, fetch the official image (TCGdex `image` + `/low.webp`, cached on disk as a raw snapshot keyed by URL hash). Compare the scan's art box to the candidate's with a perceptual hash (free, local). If the top two are within the ambiguity margin, ask vision one pairwise question ("same printing? yes/no + why") for the top two only, within budget.
4. **O3 · Agreement confidence.** Band from independent signals, never from token overlap alone:
   - HIGH: strip resolves to exactly one card **and** name agrees **and** picture match ≥ threshold.
   - MEDIUM: two of the three agree, none contradicts.
   - LOW / CONFLICT: otherwise; the reason names the signal that disagreed.
   Thresholds are named constants with a rule version, to be calibrated from confirmations later (N3), never adjusted silently.
5. **O4 · Review screen.** Per card: the scan beside the official image of the top candidate; alternatives as an image strip; a search box that finds any TCGdex card by name / set code / number (the missing correction path); keys `Enter` confirm, `1–5` pick, `/` search, `R` reject. Names come from the catalog record, never concatenated from fields (fixes the duplicated words). A correction writes a new confirmation and keeps the old one (`identity_correction` history) — never an in-place overwrite.
6. **O5 · Benchmark + feedback.** `npm run scan:benchmark -- --golden data/scan-golden/ed919c12-pokemon.json` re-runs v2 on the preserved masters (no writes to batches, vision via cache) and prints top-1, top-3, confident-wrong, double-feed and cost. Every operator correction also becomes a golden case (N2) and feeds a per-batch correction report grouped by cause (N1).

## Contracts / schemas first (DoD)

- `packages/core-model/src/scan-id-v2.ts` — zod: `StripRead` (raw text, setCode, lang, localId, printedTotal, method `tesseract|vision`, confidence, provenance); `VisualMatch` (candidateId, method `dhash|vision_pairwise`, distance/answer, provenance); `AgreementVerdict` (band, signals[], disagreements[], ruleVersion); `CardIdSpend` (steps[], usd, capUsd, capped); `IdentityCorrection` (unitId, fromCatalogKey, toCatalogKey, reason, operator, at); `GoldenCase` (file schema `vip_scan_golden_v1`).
- `packages/scan-ingest/src/v2/*` exports typed functions only; the API decides persistence.

## File plan

| Path | Action | Notes |
|---|---|---|
| `packages/core-model/src/scan-id-v2.ts` | create | Contracts above; export from index. |
| `packages/scan-ingest/src/image/imageOps.ts` | create | The only module that touches the image library (decode, crop, resize, greyscale, dHash). See open decision D1. |
| `packages/scan-ingest/src/v2/stripRegions.ts` | create | Strip crop regions per OCR profile (Pokémon modern; energy layout). |
| `packages/scan-ingest/src/v2/stripReader.ts` | create | Crop → Tesseract psm 7 → parse; vision-on-crop fallback through the budget meter. |
| `packages/scan-ingest/src/v2/setCodes.ts` | create | Code → TCGdex set id from `abbreviation.official` + reviewed overrides. |
| `packages/scan-ingest/src/v2/visualMatch.ts` | create | dHash compare; pairwise vision verify for the top two when ambiguous. |
| `packages/scan-ingest/src/v2/agreement.ts` | create | O3 bands with rule version `scan-id-v2-agreement@0.1.0`. |
| `packages/scan-ingest/src/v2/budget.ts` | create | Per-card spend meter, cap from `VIP_SCAN_ID_BUDGET_USD` (default 0.04). |
| `packages/scan-ingest/src/v2/identifyV2.ts` | create | Orchestrates 1–4; returns candidates + verdict + spend. |
| `packages/scan-ingest/src/catalog/tcgdexAdapter.ts` | modify | Add exact `setId + localId` lookup by set code; keep the v1 search intact. |
| `services/api/src/lib/catalogImageCache.ts` | create | Fetch/cache official images as raw snapshots; serve to the web app. |
| `services/api/src/lib/reidentifyBatch.ts`, `ricohIntake.ts` | modify | Call `identifyV2` when `VIP_SCAN_ID_V2=1` and category is Pokémon. |
| `services/api/src/lib/scanStorePg.ts` | modify | Correction writes history; confirm stores `was_correct` from catalog key, not only asset id. |
| `services/api/src/app.ts` | modify | `GET /api/scan/catalog-search`, `GET /api/scan/catalog-image/:key`, `POST /api/scan/units/:id/correct`. |
| `services/api/src/scanBenchmarkCli.ts` + `package.json` script `scan:benchmark` | create | O5 benchmark; read-only against batches. |
| `infra/db/migrations/<date>_NN_scan_identity_corrections.sql` | create | `vault_media.identity_correction` (history) and a `scan_unit_id` link on `vault_core.identification_golden_case` (today it only has `card_scan_id`). Idempotent, `COMMENT ON TABLE`. |
| `apps/iqvault-web/src/components/scan/ReviewCard.tsx`, `CardSearchPicker.tsx` | create | O4 side-by-side review, image alternatives, search, keyboard. |
| `apps/iqvault-web/src/components/scan/ScanIntake.tsx` | modify | Use `ReviewCard` for Pokémon batches. |
| `data/scan-golden/ed919c12-pokemon.json` | exists | Truth set (20 operator-confirmed, 5 pending confirmation). |

## Acceptance tests

1. AT-01 Strip parse: fixtures `PFL EN 005/094`, `MEE EN 003`, `MEG EN 124/132`, `JTG EN 029/159` parse to set code + number; garbage returns null, never a guess.
2. AT-02 Set codes: every set code in the golden file maps to its TCGdex set id; an unknown code returns null and is reported.
3. AT-03 Exact lookup: strip `PFL 005/094` resolves to `me02-005` only (not McDonald's Lotad).
4. AT-04 Picture check: dHash ranks the true printing first for the golden Lotad and Premium Power Pro cases (fixture images).
5. AT-05 Agreement: HIGH requires all three signals; a strip/name disagreement can never be HIGH; the verdict names the disagreeing signal.
6. AT-06 Budget: a card that would exceed $0.04 stops escalating, is marked `capped`, and lands in Review; spend is recorded per step.
7. AT-07 Benchmark: `npm run scan:benchmark` meets the pass bar above and writes nothing to scan batches.
8. AT-08 Correction history: correcting a confirmed unit keeps the old identity in `identity_correction`; the holding changes only through that path.
9. AT-09 Names: a confirmed name is the catalog name (`Lotad`, `Basic Water Energy`), never a concatenation with repeated words.
10. AT-10 Double feed: unit 0045 is flagged (existing `double-feed-size@0.1.0`).
11. AT-11 No regression: sports/MTG/comics still use v1 unchanged; the full `npm test` stays green, and the scan tests leave the database row counts unchanged (`scanTestCleanup.ts`).
12. AT-12 Raw snapshots: each catalog reply, official image and vision reply used is a raw snapshot; re-running the benchmark from snapshots (no network) gives the same result.

## Open decisions (operator)

- **D1 · Image library.** `sharp` (fast, native binary, standard choice) vs `jimp` (pure JavaScript, slower, no native install). Recommendation: `sharp`.
- **D2 · Picture match method.** Perceptual hash (free, local) + vision pairwise only when ambiguous, vs local CLIP embeddings in pgvector (free per card, larger setup; better for catalog-wide search later). Recommendation: dHash + pairwise now; CLIP when sports needs catalog-wide image search.
- **D3 · Fixing the 4 wrong Pokémon confirmations and garbled sports names (Q1/Q2).** Through the new correction path (recommended, keeps history) or a one-off script now.

## Risks

- Strip position varies by era and card type (older sets, full-art, promos); regions must live in profiles and be added as new layouts appear.
- TCGdex images can be missing for very new sets; the picture check then abstains (never counts as agreement).
- dHash on holo/foil scans is noisier; the ambiguity margin routes those to the pairwise check or Review.
- Vision pricing can change; the meter reads the model price from config.
