# How-to: Ricoh fi-8170 → inventory intake

## Goal

Scan sports / TCG cards on a Ricoh fi-8170, identify them, confirm into VIP
inventory (with duplicate alerts), and optionally queue an eBay listing draft
once developer tokens exist.

Museum-quality photography is **out of scope** for this path (`qualityTier: intake`).

## Hardware setup (operator)

1. Install **PaperStream Capture** (or Capture Pro) for the fi-8170.
2. Create a profile:
   - Duplex on
   - Color / 300 dpi is enough for intake ID (museum station comes later)
   - Output: JPEG or TIFF to a watched folder, e.g. `D:\VIP\scans\fi8170\`
   - Prefer filenames that include `front` / `back`, or rely on sequential duplex
3. Optional: enable OCR / barcode in PaperStream and pass text through later.

## Software pipeline

Package: `@vip/scan-ingest`  
API: `@vip/api` `/api/scan/*`

```
ADF duplex pages
  → FolderWatchAdapter (pair front/back)
  → openScanBatch (RawSnapshot descriptors + ID candidates)
  → operator review (duplicate alert if already held)
  → confirm → Holding (source=ricoh_fi8170, action=Hold)
  → optional EbayListingDraft (idle without EBAY_* tokens)
```

## Staging vs inventory (ADR 0009)

An imported card is **staged**, not owned. Identity candidates live in
`vault_media.scan_unit_candidate` with their own confidence and provenance;
nothing is written to `vault_core.asset` or `vault_collection.holding` until a
unit resolves. A database CHECK enforces it: a `scan_unit` may not carry
`confirmed_asset_id` / `holding_id` without a `resolution_mode` and rule
version.

Confidence bands shown in the review queue:

| Band | Meaning |
|---|---|
| `auto` | Would auto-resolve (only when auto-resolution is enabled) |
| `review` | Plausible match, needs a human |
| `weak` | Low score — treat as a guess |
| `none` | No candidate; the catalog has nothing close |

Auto-resolution is **off by default**. Enabling it requires all of: confidence
above the threshold, a clear margin over the runner-up, an identity-grade match
reason (external id or collector number), and no duplicate alert.

```powershell
setx VIP_SCAN_AUTO_RESOLVE 1          # opt in
setx VIP_SCAN_AUTO_RESOLVE_MIN 0.95   # optional, default 0.9
setx VIP_SCAN_AUTO_RESOLVE_MARGIN 0.2 # optional, default 0.15
```

Rejecting a unit keeps the scan and its candidates, so a better catalog can be
re-run against the same capture instead of forcing a re-scan.

## From IQVault (no curl)

1. Set the drop folder once, so you never type a full path:

```powershell
setx VIP_SCAN_INBOX "D:\VIP\scans\fi8170"
```

Restart the VIP API (or `Launch IQVault.bat`) so it picks the variable up.

2. Scan in PaperStream Capture (duplex → that folder).
3. Open IQVault → **Scan** (`http://127.0.0.1:3000/scan`).
4. Pick the category, optionally a subfolder, then **Import scanned batch**.
5. Review each unit's candidates and duplicate rows, then **Confirm**.

Confirm writes a Holding with `source=ricoh_fi8170`, action **Hold**, and
condition **NM assumed · unverified**. Units with duplicates require the
explicit confirm click, which sends `acknowledgeDuplicates`.

File naming helps identification: the matcher reads the file name when
PaperStream OCR text is absent, so `1986_topps_michael_jordan_57_front.jpg`
identifies far better than `img001.jpg`.

## API quick start

```bash
# Capability probe (includes the configured inbox root)
curl -s localhost:8787/api/scan | jq

# Start a batch from the drop folder (what the Scan page calls)
curl -s -X POST localhost:8787/api/scan/import-folder \
  -H 'content-type: application/json' \
  -d '{"folder":"box1","categoryHint":"sports"}' | jq

# Open a batch from paired pages (OCR text helps ID)
curl -s -X POST localhost:8787/api/scan/batches \
  -H 'content-type: application/json' \
  -d '{
    "categoryHint": "sports",
    "pages": [
      {
        "storageRef": "scans/fi8170/001_front.jpg",
        "contentHash": "aaa",
        "ocrText": "1986 Topps Michael Jordan 57",
        "face": "front"
      },
      {
        "storageRef": "scans/fi8170/001_back.jpg",
        "contentHash": "bbb",
        "face": "back"
      }
    ]
  }' | jq

# Confirm unit into inventory (acknowledgeDuplicates if 409)
curl -s -X POST localhost:8787/api/scan/units/<unitId>/confirm \
  -H 'content-type: application/json' \
  -d '{
    "selectedCandidateKey": "sports:topps:1986:jordan:57",
    "acknowledgeDuplicates": true,
    "queueEbayListingDraft": true
  }' | jq
```

## eBay listing drafts

Without `EBAY_OAUTH_TOKEN` (or client id/secret), drafts stay
`pending_credentials` and are **not** submitted. Comps browsing still uses the
existing `ebay-sold` adapter separately.

## Provenance rules

- ID candidates: inferred · unverified until confirm
- After confirm: identity observed/verified by operator; condition remains
  **NM assumed · unverified** until a grading / museum capture pass
- Duplicates require explicit `acknowledgeDuplicates: true`
