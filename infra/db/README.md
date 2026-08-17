# Phase 1 — Database

All schema SQL lives in `migrations/`. There are **no** catalog files at the
repo root and no duplicate copies under `files -Fable5/`.
`python scripts/migrate_db.py` applies every `*.sql` file here in filename
order (spine `20260701`–`20260708`, then dated trust-layer files).

## Apply (local Docker Postgres)

```bash
# from repo root
docker start iqvault-postgres   # or: docker compose up -d
python scripts/migrate_db.py
```

## Rules

- `vault_evidence.raw_snapshots` is **INSERT-only** (triggers block UPDATE/DELETE).
- Processed catalog/holding rows must be regenerable from a snapshot payload.
- Do not put inferred grades into verified columns — use provenance method=`inferred`.
- Binder TCG layout is Postgres `vault_tcg` (ADR 0007). SQLite is import-only.
