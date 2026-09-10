# ADR 0011 — Category and vertical OCR identity profiles

Status: accepted (2026-09-07)
Extends: ADR 0008 (scan ingest), ADR 0009 (identity staging), ADR 0010 (catalog adapters)

## Context

Scan identification in `@vip/scan-ingest` used one sports-shaped OCR
classifier (`classifyOcr`) and one sports parser (`sportsIdentity`). TCG
lots (Pokémon, Magic, One Piece) share that path: biography/stats markers,
2–3 word player titles, year + brand completeness, and `#123` numbers.

Those assumptions are wrong for TCG and only partly right across sports.

| Anatomy | Sports | TCG |
|---|---|---|
| Name | Player (2–3 words) | Card name (1–6 words; single-token Pokémon names) |
| Number | `#195` / `No. 195` | `4/102`, `LEA 232`, `OP01-003` |
| Back text | Bio / stats (must never become the name) | Rules / attacks / oracle (same rule, different lexicon) |
| Completeness | year + brand + player + number | name + collector number (year optional) |
| Poison numbers | Unlabeled leftovers | HP, power/toughness, DON!! / Life / Power |

A generic “sports vs TCG” switch is necessary but not sufficient.
Football Contenders, Bowman baseball, Merlin soccer, and Hoops basketball
share sports anatomy and still differ in brands, teams, and body language.
Pokémon, Magic, and One Piece differ in collector-number grammar and
copyright marks.

## Decision

**OCR and identity use a two-layer profile. Inventory category stays the
family bucket.**

1. **Family** (`sports` | `tcg`) — Tesseract page-seg, title shape,
   completeness, and which parser runs.
2. **Vertical** (`football` | `baseball` | `soccer` | `basketball` |
   `pokemon` | `mtg` | `one_piece`) — lexicons, number regexes, team
   lists, copyright/product tokens, catalog filter.

Operator hint is authoritative. A family-only hint (`sports`, `tcg`) may
be refined from OCR tokens; that refinement is **inferred · unverified**
and never stored as a confirmed vertical. Detected “Magic” requires
“Magic the Gathering” / `mtg` / Wizards — Orlando Magic stays basketball.

`ScanCategory` remains `sports | pokemon | mtg | one_piece` for inventory
and catalog adapters. Football/baseball/soccer/basketball map to
`sports`. Profiles live in `packages/scan-ingest/src/ocr/profiles.ts`
(`scan-ocr-profile@1.0.0`).

Tesseract settings stay modest (sports PSM 6, TCG PSM 4). Accuracy comes
from classification + parse + catalog, not a unique engine binary per
sport.

## Consequences

- Scan UI exposes Sports vs TCG groups and the seven verticals.
- Re-identify can re-run a different profile against the same immutable
  capture (ADR 0009).
- One Piece is a scan/identity category now; it is **not** a `vault_tcg`
  schema change (ADR 0007 occupancy + 2026-08-19 plan §2 still open).
- Catalog adapters (ADR 0010) stay swappable; the profile only chooses
  which adapter family is asked.

## Alternatives rejected

- **One classifier with a bigger token list.** Sports bio and TCG oracle
  text both look like “long lines”; without a family split they steal the
  title field from each other.
- **Seven independent Tesseract pipelines.** Page-seg and language are
  almost the same; the costly differences are field grammar and catalogs.
- **Promote football/baseball/… to `vault_core` categories.** Inventory
  already buckets sports as one kind. Profiles are an identification
  concern, not a new asset taxonomy.
