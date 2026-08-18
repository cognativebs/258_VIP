# Phase 1 — Database

Migrations in `migrations/` are additive beside the legacy `01_*.sql`–`08_*.sql`
proofs at the repo root.

## Apply (local Docker Postgres)

```bash
# from repo root, with docker-compose up
psql "$DATABASE_URL" -f infra/db/migrations/20260720_01_raw_snapshots.sql
# Intelligence systems (2026-08-15) — run 11→16 in order after 01–08 + holdings
psql "$DATABASE_URL" -f infra/db/migrations/20260815_11_prediction_ledger.sql
psql "$DATABASE_URL" -f infra/db/migrations/20260815_12_evidence_engine.sql
psql "$DATABASE_URL" -f infra/db/migrations/20260815_13_market_cycle_schema.sql
psql "$DATABASE_URL" -f infra/db/migrations/20260815_14_transaction_intelligence.sql
psql "$DATABASE_URL" -f infra/db/migrations/20260815_15_collection_intelligence.sql
psql "$DATABASE_URL" -f infra/db/migrations/20260815_16_field_modes_interfaces.sql
```

Phase 1 logic (prediction ledger, evidence engine, underwriting, grading,
binder chase, museum synergy) lives in `@vip/intelligence`. Phase 2 tables
accept manual rows only — no classification jobs. Phase 3 is interface
contracts only.

## Rules

- `vault_evidence.raw_snapshots` is **INSERT-only** (triggers block UPDATE/DELETE).
- Processed catalog/holding rows must be regenerable from a snapshot payload.
- Do not put inferred grades into verified columns — use provenance method=`inferred`.
