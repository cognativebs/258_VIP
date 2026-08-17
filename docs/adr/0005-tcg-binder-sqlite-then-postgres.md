# ADR 0005 — TCG shared store: Binder SQLite now, Postgres later

**Status:** Superseded by [ADR 0007](0007-binder-vault-postgres.md)  
**Date:** 2026-08-03  
**Superseded:** 2026-08-09  
**Owner:** Gregory Williamson / 258 Services  
**Phase:** Binder ↔ IQVault integration (historical)

> Binder layout and VIP TCG inventory now live in Postgres `vault_tcg` / `vault_collection`. SQLite is import-only (`scripts/migrate_binder_sqlite_to_postgres.py`). Do not follow the “SQLite now” runtime path below.

## Context

Binder Vault holds the only durable TCG layout DB (libSQL/SQLite). VIP API inventory was seed JSON. Comics already live in Postgres. AGENTS.md defaults to Postgres for VIP, but inventing a third “IQVault SQLite” would fork truth. Collectors need LAN phone access and Portfolio visibility of Binder owned/need without merging Binder UI into IQVault.

## Decision

1. **Near term:** Binder SQLite is the **TCG layout + owned-flag truth**. VIP API reads it via a holdings adapter (`GET /api/inventory`, `GET /api/tcg/binders`). IQVault Portfolio consumes that API. Binder UI stays a separate tab/window.
2. **Later (this ADR’s target):** Migrate durable VIP holdings (TCG projections + comics bridge) into **Postgres**, aligning with AGENTS.md. Binder then either:
   - keeps SQLite as a layout cache synced from VIP, or
   - moves `binder` / `binder_page` / `binder_slot` tables into Postgres and drops the local file.

Off-network access (tunnel + auth) is deferred until after mobile LAN UX is solid.

## Consequences

- `BINDER_DB_PATH` is shared by Binder app and VIP API.
- Pokémon seed JSON is fallback/tests only (`VIP_INCLUDE_POKEMON_SEEDS=1` to force).
- Sync Owned matches **owned** VIP external ids only (not Binder “need” pockets).
- Postgres migration is a separate milestone with data backfill + dual-read cutover.

## Related

- ADR 0001 — product boundaries (VIP owns inventory façade; faces don’t fork brains)
- [docs/how-to/04-binder-lan-and-iqvault.md](../how-to/04-binder-lan-and-iqvault.md)
