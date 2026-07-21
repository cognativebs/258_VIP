# Phase 1 — Database

Migrations in `migrations/` are additive beside the legacy `01_*.sql`–`08_*.sql`
proofs at the repo root.

## Apply (local Docker Postgres)

```bash
# from repo root, with docker-compose up
psql "$DATABASE_URL" -f infra/db/migrations/20260720_01_raw_snapshots.sql
```

## Rules

- `vault_evidence.raw_snapshots` is **INSERT-only** (triggers block UPDATE/DELETE).
- Processed catalog/holding rows must be regenerable from a snapshot payload.
- Do not put inferred grades into verified columns — use provenance method=`inferred`.
