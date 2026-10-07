# ADR 0014 — ComicBase is the comics inventory source

**Status:** Proposed (parser waits on a real ComicBase export)
**Date:** 2026-10-04
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

## Open until a real export exists

- Export format (tab-delimited, CSV or XML) and the field names ComicBase uses
  for item id, quantity in stock, grade, cost and value.
- How ComicBase marks variants, so the match key is exact.
- Whether ComicBase's own value columns are imported (they would be
  vendor-guide observations, never a holding's market price — rule 4).

## Consequences

- AGENTS.md's Cursor instructions and the how-to docs change from
  `import_clz.py --xml …` to the ComicBase folder import.
- A confirmed identity is never overwritten by an import: a ComicBase item that
  disagrees with a confirmed holding goes to review.
