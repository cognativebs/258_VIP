# VIP Engineering Rules (Cursor: read before every task)

## What we're building
Vault Intelligence Platform: one shared backend + intelligence core.
IQVault (collector) and VaultOS (LGS) are role-specific faces on the SAME
services. Never fork backend logic between them.

## Non-negotiable rules
1. Decisions over inventory. Every feature ends in an action:
   Buy / Hold / Grade / Sell / Lot / Pass — with confidence + reasons.
2. Provenance is mandatory. Every derived field carries: source, method,
   model/rule version, confidence, verification status. Inferred values are
   NEVER stored as if verified. "NM assumed · unverified" > silent fill-in.
3. Raw imports are immutable. Keep source snapshots forever. Processed data
   is always regenerable from the snapshot.
4. No fake precision. Valuations are ranges + evidence count + recency +
   confidence. Never a single point value presented as fact.
5. Data sources are swappable adapters. No core logic depends on one scraper.
6. Agents obey contracts: mission, allowed tools, input/output schema,
   confidence rules, failure behavior, escalation. High-dollar recs get a
   critic pass.
7. Feature freeze is OFF (lifted 2026-08-02). Prefer Build Spec → Cursor for
   non-trivial work (ADR 0003). Track remaining work in docs/backlog.md; do not
   refuse tasks solely for milestone/freeze reasons.

## Stack defaults (change only via an ADR)
- TypeScript everywhere. zod for schemas. Postgres. Drizzle/Prisma ORM.
- Next.js for web apps. Expo/React Native for mobile.
- Every package exports typed contracts; apps consume, never reach into DB directly.

## Existing proofs (do not rename casually)
Preserve these terms from the current SQL/parser proofs unless an ADR says otherwise:
`asset`, `holding`, `priced_unit`, `sale`, `market_value`, `collection_hunt`,
`external_id`, `assumed_grade` (as inferred · unverified, never as a fake grade).

## Migrations
- All schema SQL lives in `infra/db/migrations/`, named `YYYYMMDD_NN_description.sql`.
  New work uses today's date. There is no other migrations directory.
- `scripts/migrate_db.py` applies every `*.sql` in **filename order** and keeps no
  applied-ledger, so: date-prefix or the file runs before the core spine and fails,
  and every migration must be idempotent and re-runnable (`IF NOT EXISTS`,
  `ON CONFLICT DO NOTHING`, enum creation wrapped against `duplicate_object`).
- Every migration: `BEGIN;`/`COMMIT;`, explicit `SET search_path`,
  `public.uuid_generate_v4()` for UUID defaults, `COMMENT ON TABLE` per table.
- Postgres 16 + pgvector (`pgvector/pgvector:pg16`). Extensions install into `public`,
  never into a `vault_*` schema.
- Binder TCG layout is `vault_tcg` (ADR 0007) and is live. Treat it as occupied.

## Data guarantees (apply to every schema)
- Market price is ALWAYS a time-series observation, never a point-in-time scalar column.
- `needs_review` is a permanent workflow state. Never auto-clear it.
- Confirmed identities are never silently overwritten. Raw scans/captures are immutable.
- `(priced_unit_id, condition_key)` is a pair and is never split. NULL never means
  "any" — an explicit `'any'` value exists for that.
- Provider IDs live in a `provider_ids` jsonb column. Never a primary or foreign key.
- The TCGplayer public API is closed to new developers. Do not write code assuming it.

## Process
- STOP and report before any destructive operation (DROP, TRUNCATE, destructive ALTER,
  data delete). Never merge or force-push without being asked.
- Do not add tables, columns, or features not named in the request. Report the gap.
- If a prompt conflicts with a design doc or with this file, STOP and report the
  conflict rather than picking one side.
- Multi-game TCG work follows `docs/proposals/2026-08-19_vault_tcg_schema_plan_v2.md`,
  not the superseded 2026-08-17 proposal. Its §2 decisions are open; no migration
  for that plan is written until they are answered.

## Definition of done for any task
- Types + zod schema first, then implementation, then tests.
- Provenance fields populated on any derived data.
- A short note in the PR body: user, decision, input evidence, output action.
