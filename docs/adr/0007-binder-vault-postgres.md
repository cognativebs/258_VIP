# ADR 0007 — Binder Vault moves to Postgres

**Status:** Accepted  
**Date:** 2026-08-09  
**Owner:** Gregory Williamson / 258 Services  
**Supersedes:** ADR 0005 (SQLite now, Postgres later)

## Context

ADR 0005 made Binder SQLite the TCG layout truth and had the VIP API read another
app's database file off disk (`BINDER_DB_PATH`). That coupling is what made
"single inventory truth" hard: comics in Postgres, TCG in a gitignored SQLite
file, VIP gluing them with seeds.

Owner decision (audit walkthrough, 2026-08-09): **move Binder to Postgres now**,
before building the Binder→VIP write path on top of the dual-store problem.

## Decision

1. **Durable Binder tables live in Postgres** under schema `vault_tcg`
   (`binder`, `binder_page`, `binder_slot`, `price_snapshot`).
2. **Binder Vault app and VIP API share the same DSN**
   (`BINDER_DATABASE_URL` → `IQVAULT_DATABASE_DSN` → `DATABASE_URL`).
3. **SQLite is a one-way import source**, not a runtime store. Existing local
   files migrate via `scripts/migrate_binder_sqlite_to_postgres.py`.
4. **Owned / wishlist flags write through to VIP holdings / watchlist** with
   provenance (Binder→VIP write path), instead of VIP only reading Binder's DB.

## Consequences

- `BINDER_DB_PATH` is deprecated for runtime; kept only as the SQLite import input.
- LAN phone Binder still works — the API host reaches Postgres; the phone hits
  the Binder Next server, which talks to Postgres.
- Comics and TCG inventory truth both sit in one Postgres. Unified Bloomberg
  grid becomes a face problem, not a data problem.
- Offline-only Binder without Postgres is out of scope; dogfood assumes the
  local stack (`docker compose` / local Postgres) is up.

## Related

- ADR 0001 — product boundaries
- ADR 0005 — superseded
- `infra/db/migrations/20260809_01_binder_postgres.sql`
