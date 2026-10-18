# ADR 0016 — ComicBase is the comics inventory source

**Status:** Accepted (2026-10-18): ComicBase is the comics inventory. CLZ is a metadata source only. Removing the CLZ importer (decision 3) is still open.
**Date:** 2026-10-04 · amended 2026-10-06, 2026-10-18
**Renumbered:** filed as ADR 0014 on 2026-10-04; renumbered 2026-10-06 because the
uncommitted shell ADR 0014 (2026-09-22) and Ingest ADR 0015 (2026-09-23) predate it.
**Owner:** Gregory Williamson / 258 Services
**Supersedes (on acceptance):** ADR 0006 (Python-authoritative CLZ ingest)

## Context

The comics collection (2,700 holdings) entered VIP from CLZ XML exports
(`scripts/import_clz.py`, ADR 0006). The operator now keeps the collection in
ComicBase 2026 Professional Edition and wants it to be the inventory source.

Facts checked on the operator's machine (2026-10-04):

- ComicBase has no API. The collection lives in
  `C:\ComicBase\ComicBase Databases\My Collection.cbdb` (2.2 GB: the full
  ComicBase catalogue plus the operator's stock).
- `.cbdb` is an **encrypted** SQLite database (System.Data.SQLite; the file
  header is not `SQLite format 3`). Reading it would mean breaking that
  encryption. VIP does not do that.
- ComicBase's own Export is the supported way out. No export had been run yet.

## Decision (operator, 2026-10-04)

1. **Hand-off = watched folder.** The operator exports in-stock items from
   ComicBase into `D:\VIP\imports\comicbase\`. A job picks up each new file,
   stores its bytes as an immutable `vault_evidence.raw_snapshots` row
   (`source = 'comicbase_export'`), and imports it. A byte-identical file is a
   no-op (rule 3).
2. **Match and keep history.** Each ComicBase in-stock item is matched to an
   existing holding (publisher + series + issue + variant). One exact match →
   the ComicBase item id is added to that holding's `provider_ids`, keeping its
   id, scans, comps, sell-queue links and any confirmed identity. Several or
   partial matches → review list (`needs_review`, never auto-cleared). No match
   → a new holding. CLZ-only holdings are flagged "not in ComicBase" and are
   never deleted.
3. **Retire CLZ.** On acceptance, ComicBase is the only comics inventory
   source: the CLZ drop zone and `import_clz.py` are removed, CLZ snapshots stay
   as history, and the CI acceptance gate moves from the CLZ export to a
   committed ComicBase export fixture.
4. Python stays the ingest language (ADR 0006's reasoning holds: scoring and
   the Postgres load are in Python).

## Amendment — 2026-10-06: the first real export

The first export is a ComicBase **Collection Report** (HTML): per series, the
title, publisher and run years, then the issues in stock, then a total quantity
and value. 211 series, 820 copies — ComicBase is still being filled in (VIP holds
2,700 from CLZ). It carries no ComicBase item id, grade or cost.

- **Issue tokens.** `[prefix ]number[/letter][-printing][(quantity)]`: `5/A` is
  variant A, `200-2` the 2nd printing, `1(2)` two copies, `Anl 1` Annual 1.
  Quantities per series add up exactly, so a report that does not add up is
  refused.
- **Item key.** No ComicBase id exists in this format, so the key is series +
  start year + publisher + issue + letter + printing. That key goes into
  `holding.provider_ids.comicbase` (new column, additive).
- **Variant letters are not CLZ cover labels.** ComicBase's plain `5` is the
  regular cover and `5/A` its first variant; CLZ calls the regular `A` (or a
  "Regular … Cover") and the variant `B` or a named cover. So: one copy on each
  side matches; a lone regular matches the one regular-looking CLZ label; regular
  + one variant on each side pair up when quantities agree. Anything else —
  more variants, a quantity difference, annuals and specials — goes to review.
- **Series names** meet after the same normalisation on both sides (volume or
  "(2nd Series)" marker, publisher tag, markup, a dropped "Star Wars:" style
  prefix). A matching start year decides; otherwise volumes must agree. CLZ's
  `year_began` is the year of the earliest copy owned, not the series start.
- **While ComicBase is partial** (operator, 2026-10-06): holdings missing from
  ComicBase are not flagged, and unmatched ComicBase items are listed for review
  instead of becoming new holdings (auto-creating them now would duplicate books
  whose names simply did not meet). Decision 2's "no match → a new holding" and
  "CLZ-only holdings flagged" apply once the operator says ComicBase is complete.
- First run on the live data: 416 of 820 copies matched, 176 items to review,
  95 unmatched (59 issues VIP does not hold, 36 series VIP does not hold).
- ComicBase's value column is not imported (open: it would be a vendor-guide
  observation, never a holding's market price — rule 4).

## Amendment — 2026-10-18: ComicBase is the inventory

Operator: "rebuild the comics collection with the inventory from ComicBase 2026
instead of CLZ uploads. Cross reference CLZ to collect missing metadata … The CLZ
inventory is out of date." This replaces the 2026-10-06 "while ComicBase is
partial" rule.

- **The collection is the latest ComicBase report.** `vault_collection.v_comics_inventory`
  (migration `20261018_01`) lists one holding per ComicBase item in the latest
  imported report, with ComicBase's quantity. Both comics APIs (VIP `:8787` and the
  Python Comics API `:5200`) and the eBay comps walk read it. Before any ComicBase
  import (a fresh or CI database) they fall back to the CLZ holdings.
- **Matched item → the CLZ holding.** It keeps its id, scans, comps, sell-queue
  links and CLZ metadata. ComicBase's count stands; a different CLZ count no longer
  sends the item to review (rule `comicbase-report-match@0.2.0`).
- **Unmatched or in-review item → a holding of its own** (`source = 'comicbase_export'`).
  It borrows CLZ fields from a copy of the same issue (issue-level fields: dates, key
  info, story arc; the cover image only when both sides are the regular cover) or
  else from the same series (genres, format, language, series group). Copy-specific
  fields (price, grade, location, barcode, purchase) are never borrowed. Its
  provenance says which CLZ holding the fields came from, inferred · unverified, and
  `needs_verification` is set. No grade is assumed and no price is set.
- **The review list stays.** `needs_review` is still cleared only by an operator
  confirm. A confirm repoints the item at the confirmed CLZ holding; the holding VIP
  created is kept, not deleted, and leaves the collection.
- **CLZ-only holdings leave the collection view.** They are not deleted and
  `dropped_at` is not set, so a book that comes back in a later ComicBase report
  (or is confirmed to one) reappears with its history.
- **Series matching tightened.** A start year one apart no longer joins two
  numbered volumes ("The Flash (3rd Series)" 2010 is not CLZ "Flash, Vol. 4" 2011).
  Same year, or volumes agreeing, still decide.
- First rebuild, on a copy of the live data with the 2026-10-06 report: 687
  holdings, 820 copies (480 CLZ holdings, 207 made from ComicBase). 2,220 CLZ holdings
  are not listed by that report. A newer ComicBase report replaces it in the
  collection on the next hourly import.

## Open

- A detailed ComicBase export (File → Export with item id, grade, cost) would let
  the key become ComicBase's own item id and add grade; the report importer stays
  as the fallback.

## Consequences

- AGENTS.md's Cursor instructions and the how-to docs change from
  `import_clz.py --xml …` to the ComicBase folder import.
- A confirmed identity is never overwritten by an import: a ComicBase item that
  disagrees with a confirmed holding goes to review.
