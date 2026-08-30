# How-to: Ricoh fi-8170 → inventory intake

## Goal

Scan sports / TCG cards on a Ricoh fi-8170, pair front/back, identify them with
traceable evidence, confirm draft inventory (with duplicate alerts), and
optionally queue an eBay listing draft once developer tokens exist.

Museum-quality photography, grading, pricing, and TWAIN control are **out of
scope**. Intake quality only (`qualityTier: intake`).

## Hardware setup (operator)

1. Install **PaperStream Capture** (or Capture Pro) for the fi-8170.
2. Create profile **`004_Cards`**:
   - Duplex on
   - Color, **600 DPI**
   - Output: JPEG or PNG to a watched folder, e.g. `D:\VIP\scans\fi8170\`
   - Prefer filenames that include `front` / `back` (or rely on sequential ADF)
3. Optional: write OCR next to each image as `<same-name>.txt`.

## Where to put scans

1. Preferred: set the API inbox once, then drop files there.

```powershell
setx VIP_SCAN_INBOX "D:\VIP\scans\fi8170"
```

On this Linux cloud VM:

```bash
export VIP_SCAN_INBOX="/workspace/data/scan-inbox"
# PaperStream (or a copy of its output) → $VIP_SCAN_INBOX or a subfolder
```

2. Acceptance / dry-run fixture (20 cards / 40 images):

`data/scan-inbox/ricoh-v1-fixture/`

Replace any `*_front` / `*_back` pair with real 600 DPI scans of the same stem
and re-import. Card 19 is an intentional byte-identical reimport. Card 20 has
conflicting front/back OCR sidecars.

3. Or upload the images from IQVault **Scan** (file picker) — no inbox required.

## Start processing

1. Restart the VIP API after changing env (`npm run api`).
2. Open IQVault → **Scan** (`http://127.0.0.1:3000/scan`).
3. Leave the folder blank (uses `VIP_SCAN_INBOX`) **or** type a subfolder /
   absolute path **or** choose files.
4. Pairing: **Auto** (filename labels if most pages are labeled, else sequential
   duplex). PaperStream default names (`IMG_0001.jpg`, `IMG_0002.jpg`) are
   sequential ADF order — leave Auto or choose **Sequential duplex**. Use
   **Filename** only for `*_front` / `*_back` lots.
5. Click **Process selected images**. The browser sends one scan at a time
   (600 DPI lots exceed Next’s 10MB proxy if sent as one request).
   Same-PC folder import is still the fastest path for a full box.

API equivalent:

```bash
curl -s -X POST localhost:8787/api/scan/import-folder \
  -H 'content-type: application/json' \
  -d '{"folder":"ricoh-v1-fixture","categoryHint":"sports","pairing":"filename_front_back","scannerProfile":"004_Cards"}'
```

## If every image becomes its own LOW card

A status like `HIGH 0 · MEDIUM 0 · LOW 46` on a 23-card duplex lot means pairing
created **46 units** (one image each), not 23 front/back cards. Do **not**
confirm that batch.

1. Pull this branch and restart `npm run api` / `npm run web`.
2. Set Pairing to **Auto** or **Sequential duplex (ADF order)**.
3. Import the same folder again.
4. Expect `23 card(s) from 46 image(s)`. Identity may still be LOW if filenames
   are generic `IMG_####` and there is no OCR sidecar — that is identification,
   not pairing. Do not invent player/year from the image count.

## Where to review uncertain cards

**IQVault → Scan → Review queue** (`/scan`).

Front and back render together. Routes:

| Route | Meaning |
|---|---|
| `HIGH` | Draft candidate can proceed (still confirm unless auto-resolve is on) |
| `MEDIUM` | Candidate exists — quick confirmation required |
| `LOW` | `needs_review` — do not treat identity as known |
| `CONFLICT` | Front/back/catalog disagree — never silently chosen |

Confirm writes a **draft** holding (Dealer Inventory · Sell · NM assumed ·
unverified) linked to the scan unit and master hashes. Reject keeps the
captures for a later catalog re-run.

Same **card type** already held ≠ same **physical scan**. Physical reimports
show “same physical scan”. Extra copies of a type are legitimate.

## Software pipeline

Package: `@vip/scan-ingest`  
API: `@vip/api` `/api/scan/*`  
Contracts: `@vip/core-model` `CardScanObject` / `CardIdentityEvidence`

```
PaperStream files
  → copy immutable masters (data/scan-masters/<batchId>/)
  → pairPagesForReview (filename | sequential | auto)
  → fuseCardEvidence (front_text + back_text; conflicts listed)
  → base vs parallel confidence (weak parallel does not void base)
  → HIGH / MEDIUM / LOW / CONFLICT (VIP_SCAN_HIGH_MIN / VIP_SCAN_MEDIUM_MIN)
  → staging (vault_media.scan_batch / scan_unit / capture_image)
  → operator confirm → Holding (source=ricoh_fi8170, Dealer, Sell)
```

## Staging vs inventory (ADR 0009)

An imported card is **staged**, not owned. Nothing is written to
`vault_core.asset` or `vault_collection.holding` until a unit resolves.

Auto-resolution is **off by default**. Enabling it requires
`VIP_SCAN_AUTO_RESOLVE=1`, route HIGH, a catalog candidate, no identity
duplicate, and no physical reimport.

```powershell
setx VIP_SCAN_AUTO_RESOLVE 1
setx VIP_SCAN_HIGH_MIN 0.8
setx VIP_SCAN_MEDIUM_MIN 0.45
setx VIP_SCAN_MASTER_DIR "D:\VIP\scan-masters"
```

## Provenance rules

- Identification is inferred · unverified until confirm
- After confirm: identity observed/verified by operator; condition remains
  **NM assumed · unverified** until a grading / museum capture pass
- Evidence origin is one of: `front_text` | `back_text` | `catalog` | `inference`
  (`front_visual` / `back_visual` reserved — no vision model in this slice)
- Masters are never contrast/saturation/sharpen/foil enhanced

## Later pipelines (not built here)

The same master hashes can later feed Museum condition, centering, Binder
imagery, pricing, and eBay listing generation. Do not destructively edit
`data/scan-masters`.
