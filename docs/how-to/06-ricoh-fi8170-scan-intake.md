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

## API quick start

```bash
# Capability probe
curl -s localhost:8787/api/scan | jq

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
