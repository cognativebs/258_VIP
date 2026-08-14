# ADR 0006 — Python is the authoritative CLZ ingest path

**Status:** Accepted
**Date:** 2026-08-08
**Owner:** Gregory Williamson / 258 Services
**Amends:** ADR 0001 (which assigned the CLZ/TCG import adapter to `packages/ingest`)

## Context

Two independent CLZ implementations existed side by side:

| | `clz_comic_parser.py` | `packages/ingest` `clz-xml.ts` |
|---|---|---|
| Runs in production | Yes — the only path that has ever loaded the collection | No — imported by nothing outside its own test |
| Records handled | 2,700 (the real export) | A 1-record fixture |
| Scoring / pillars / sell queue | Yes | No |
| Snapshot store | None (bypassed `raw_snapshots` entirely) | In-memory, test-only |
| Provenance helpers | Inline (`NM assumed`) | `@vip/evidence` |

The TypeScript adapter carried the *contract* (provenance, snapshot immutability,
round-trip regeneration) while the Python parser carried the *reality* (every
record, every score, the actual Postgres load). Neither was complete, and each
was free to drift from the other because nothing compared them.

`AGENTS.md` stack defaults say "TypeScript everywhere", so choosing Python
requires an ADR. This is it.

## Decision

**Python owns CLZ ingest.** `clz_comic_parser.py` plus `scripts/import_clz.py`
are the authoritative path from a CLZ export to Postgres.

1. `scripts/import_clz.py` is the only supported entry point. It records the
   immutable snapshot, derives artifacts, and loads Postgres in one idempotent
   command.
2. `packages/ingest` is **removed**. Its CLZ adapter is superseded by the Python
   parser, its in-memory `ImmutableSnapshotStore` is superseded by the real
   `vault_evidence.raw_snapshots` table, and its `TcgCsvAdapter` stub is
   superseded by the Binder Vault catalog adapters (pokemontcg / TCGdex), which
   is where TCG data actually enters the platform.
3. Every guarantee that package asserted is now asserted in Python, against the
   real 2,700-record export and a real Postgres rather than a fixture and an
   in-memory map:

   | Guarantee | Now enforced by |
   |---|---|
   | grade 0.0 raw → `NM assumed`, inferred, unverified | `tests/test_clz_parser.py` |
   | original CLZ fields preserved per record | `tests/test_clz_parser.py` + `holding.clz_metadata` |
   | import → snapshot → drop derived → regenerate identical | `tests/test_raw_snapshots.py` |
   | snapshots reject UPDATE and DELETE | `tests/test_raw_snapshots.py` (DB triggers) |
   | derived artifacts byte-identical on regeneration | CI step on every PR |

## Consequences

- Rule 5 (swappable adapters) still holds, but the adapter seam is now the
  `import_clz` entry point and `raw_snapshots.source` tag, not a TypeScript
  interface. A future TCG or eBay importer registers a new `source` value.
- Rule 3 is enforced for the first time in the path that actually runs:
  `load_comics.py` now requires `--raw-snapshot-id`, so a holding cannot exist
  without an immutable import behind it.
- The TypeScript side keeps its typed contracts for everything *downstream* of
  ingest (`@vip/core-model`, `@vip/evidence`, `@vip/decision-engine`). Apps still
  consume through the API and never reach into the database.
- "TypeScript everywhere" now reads "TypeScript everywhere except the CLZ ingest
  path", which is a deliberate, single, documented exception.
- Cost: contributors need Python plus `psycopg2` to work on ingest. CI installs
  both, so this is not a local-only capability.

## Alternatives rejected

- **Port the Python parser to TypeScript.** The honest scope is a rewrite of
  scoring, pillar assignment, duplicate detection, and the catalog upsert, plus
  re-proving 2,700-record parity — all before any of the wrong-data problems in
  backlog section L get fixed. Deferred, not forbidden: this ADR can be
  superseded once the trust work lands.
- **Keep both, mark TypeScript deprecated.** Deprecated-but-present code drifts
  and gets copied. If it is not the path, it should not compile.
