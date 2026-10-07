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
  "any" — an explicit `'any'` value exists for that. ADR 0012: this pair rule
  applies to observations and a future UnitRef. Today's empty
  `vault_market.priced_unit` (asset+grade) is untouched pending TCG D1/D2.
  PriceCharting / comics market writes join on `asset_id`; condition lives on
  the observation.
- Provider IDs live in a `provider_ids` jsonb column. Never a primary or foreign key.
- The TCGplayer public API is closed to new developers. Do not write code assuming it.

## SIGNALS spine hard stops (ADR 0013)

These stop a thread. Report the finding and continue only with work that does not depend on it.

1. **HS-1.** No schema element may imply a `priced_unit` join or a UnitRef pair. ADR 0012 Path B: market writes join on `asset_id`; `condition_key` lives on the observation; `vault_market.priced_unit` stays empty.
2. **HS-2.** No write to `vault_market`, and no read that creates a dependency on `v_guide_price_baseline`.
3. **HS-3.** Do not merge, replace, or generalize `vault_core.signals_news_source` into a shared sources table. News sources and market data sources stay separate so `may_raise_valuation_ceiling` means something.
4. **HS-4.** Do not renumber a migration silently when a filename collides. Stop and report both names.
5. **HS-5.** Do not set `adapter_enabled=true` or `is_active=true` on a source row, and do not make an outbound network call, from the spine. Fixtures only until an operator enables a source.
6. **HS-6.** If a design decision is not covered by ADR 0013's gates, stop and report the options. Do not pick one and continue.

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

## Cursor Cloud specific instructions
The docs assume Windows (`Launch IQVault.bat`). On the Linux cloud VM, use the
manual commands from `docs/how-to/README.md` (§"Service map (local / manual)")
and root `package.json` scripts. The startup-time update script only runs
`npm ci` + `pip install -r requirements-dev.txt`; everything below is manual.

- `python` resolves to Python 3.12 (`python-is-python3`). Python deps install
  to the user site with `--break-system-packages` (Ubuntu externally-managed).
- Docker is installed for Docker-in-Docker (fuse-overlayfs storage driver,
  iptables-legacy). The daemon is NOT auto-started on boot — if `docker ps`
  fails, start it once with `sudo nohup dockerd >/tmp/dockerd.log 2>&1 &`.
  The `ubuntu` user is in the `docker` group; a fresh shell can run `docker`
  without sudo (already-open shells may still need `sudo docker`).

### Bring the stack up (in order — order matters)
1. `docker compose up -d` → Postgres 16 + pgvector on `:5432` (container
   `iqvault-postgres`, volume `iqvault_pgdata` persists data). Wait for healthy.
2. `python scripts/migrate_db.py` → applies `infra/db/migrations/*.sql`
   (idempotent; safe to re-run). Default DSN
   `dbname=iqvault user=postgres password=vault host=localhost`.
3. `npm run build:packages` → shared `@vip/*` packages resolve through their
   `dist/`, so this MUST run before `npm run api`/`typecheck`/`test`. The root
   `pretest`/`pretypecheck` hooks already do this automatically for those two.
4. Services (each long-running; run in its own tmux window):
   `npm run api` (VIP API `:8787`, `/health`),
   `npm run comics` (Python Comics API `:5200`, `/api/comics/health`),
   `npm run web` (IQVault Next.js `:3000` → `/collections/comics`).
   `npm run binder` (`:3010`) and `npm run orchestr8:console` (`:3001`) are optional.

### Data / tests
- The comics collection (2,700 holdings) is empty until you import the committed
  CLZ export: `python scripts/import_clz.py --xml comic_2026-07-04_19-11-11-export.xml`.
  Without it, `services/api` test `comicsHoldings.test.ts` and the Comics API
  return 0 holdings. Re-running the import rewrites `iqvault/public/comics/meta.json`
  (`generatedAt` + random `snapshotId`) — that churn is transient; do not commit it.
  The CI byte-identity gate only covers `iqvault_comics_parser_package` and
  `iqvault/public/comics/inventory.json`.
- Tests need Postgres up + migrated (some Python/TS tests hit live Postgres).
  TS: `npm run typecheck` and `npm test`. Python: `python -m pytest`.
- Orchestr8 Ask (`:5210`) and eBay/Pokémon-API features need provider keys and
  are off by default; the core collector stack runs fine without them.
