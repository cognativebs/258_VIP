# Multi-Game Trading Card Schema — Plan v2 (corrected)

**Status:** FOR REVIEW. Nothing executed. No migration written. No schema or data touched.
**Supersedes:** [`2026-08-17_multigame_tcg_schema_proposal.md`](2026-08-17_multigame_tcg_schema_proposal.md) and the build prompts in [`2026-08-17_vault_tcg_cursor_build_prompts.md`](2026-08-17_vault_tcg_cursor_build_prompts.md).
**Date:** 2026-08-19

v1's design reasoning is sound and mostly survives intact. What did not survive is its
picture of *this* repository: v1 was written against the `258_Labs\IQVault` clone, which
forked from `main` on 2026-08-08 and never saw ADR 0007, the intelligence migrations, or
the current migration runner. Every correction below is a fact about the live codebase,
verified against the running Postgres 16 instance, not a matter of taste.

Five decisions need your answer before any SQL is written. They are collected in §2.

---

## 0. Verified environment facts

Everything in §1 rests on these. Each was checked directly, not assumed.

| Fact | Evidence |
|---|---|
| `vault_tcg` already exists and is **live** | ADR 0007. Holds `binder` (1 row), `binder_page` (1), `binder_slot` (4 filled pockets), `price_snapshot` (0). Binder Vault `:3010` and the VIP API read/write it. |
| `vault_pokemon` is **empty** | `card` 0 rows, `set` 0 rows. |
| `vault_mtg` is **empty scaffolding** | 0 rows, 0 heap pages, 0 inserts ever, no inbound FKs, views, functions or triggers. Answers v1 §16's open action. |
| `vault_market.priced_unit` already exists | Created 2026-07-04, alongside `sale` and `market_value_history`. |
| `vault_core.market_price_observation` already exists | Created by `20260815_16_field_modes_interfaces.sql`. Referenced by **no application code**. |
| Migration 17 is **not applied and does not exist** | All 11 objects from v1 §2–4 are absent. No `17_*.sql` in any commit on any ref. |
| The migration runner has **no applied-ledger** | `scripts/migrate_db.py` globs `*.sql` and applies in **filename order**, treating duplicate-object errors as already-applied. |
| The application connects as **`postgres`** | `DEFAULT_DSN = postgresql://postgres:vault@…` in both `services/api` and `apps/binder-vault`. `postgres` is the only superuser. |
| CI already runs migrations + pytest against real Postgres | `.github/workflows/ci.yml` applies `migrate_db.py` then `pytest -q` with `IQVAULT_TEST_DSN`. |
| Stack is TypeScript + zod | AGENTS.md, changeable only via ADR. No `pydantic` dependency; no Python API layer. |
| Docker image is correct as specified | `docker-compose.yml` uses `pgvector/pgvector:pg16`. |

---

## 1. Corrections

### C1 — `vault_tcg` is not a new schema *(blocking)*

v1's header: "**Target schema:** `vault_tcg` (new)". It is not new. ADR 0007 put Binder
Vault's live layout there, and v1 §9 would create `binder`, `binder_page` and
`binder_slot` — three collisions with existing tables of the same names and different
shapes, one of them holding the four pockets the Pokémon terminal renders.

**Correction:** the catalog/pricing/inventory spine goes in its own schema. See decision
**D1**. Nothing in v1 §5–8 collides by name, so only the target schema label changes for
migrations 17–18; §9 (binder/hunts) needs a genuine reconciliation, not a rename.

### C2 — `priced_unit` already exists in `vault_market` *(blocking)*

v1 §B8 says `priced_unit` "matches your existing *priced unit* terminology," which is
true, but there is already a physical `vault_market.priced_unit` table at a different
grain (`asset_id`-based, serving comics comps). AGENTS.md protects the term. Two tables
called `priced_unit` in one database, meaning different things, is exactly the ambiguity
that produced `vault_core.binder_page` vs `vault_tcg.binder_page`.

**Correction:** see **D2**. Whichever way it goes, `vault_market` is not modified in this
pass, and the new table carries a `COMMENT ON TABLE` stating its relationship to the old
one.

### C3 — `market_price_observation` already exists in `vault_core`

`20260815_16_field_modes_interfaces.sql` created it. It is used by no application code
today, so reconciling now costs nothing and later costs a migration plus a backfill.
`vault_market.card_price_history` and `vault_market.market_value_history` are also
price-history tables, both in use.

**Correction:** the new schema owns TCG price observations going forward. The v2 plan
adds an explicit reconciliation item to the sequence (§4, step 8) rather than leaving
three price-history tables to drift. Flagged as **D3**.

### C4 — Bare `17_`/`18_` filenames break the runner *(blocking, mechanical)*

The standing constraint "existing project migrations end at 16; new work starts at 17"
describes `vip_intelligence_systems/migrations/11..16_*.sql` — a directory that was
removed in PR #42 in favour of `infra/db/migrations/20260815_11..16_*.sql`, per the
one-place-for-SQL rule from PR #35.

Because `migrate_db.py` sorts by filename, `18_vault_tcg_pricing_inventory.sql` sorts
*before* `20260701_01_core_spine.sql` and would execute first — before `uuid-ossp` exists
and before any FK target — and fail.

**Correction:** date-prefixed names, sequence number retained for continuity with the
doc's language:

- `infra/db/migrations/20260819_17_tcg_catalog_spine.sql`
- `infra/db/migrations/20260819_18_tcg_pricing_inventory.sql`

The runner's lack of a ledger also means idempotency is not optional — it is what makes a
second `Launch IQVault` survivable. `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` throughout,
as the constraints already require.

### C5 — §5a's access layer is inert in production as designed *(substantive)*

This is the most important correction in the document, because the mechanism v1 relies on
most is the one that currently cannot work.

v1 revokes `market_price_observation` from `vault_app` and ships `price_series` as
`SECURITY DEFINER`. But both services connect as **`postgres`**, a superuser. Superusers
bypass every `GRANT`/`REVOKE` check. So after migration 18 as specified:

- the Step 2 test "`vault_app` cannot SELECT" **passes** (the test connects as `vault_app`), while
- production code keeps unrestricted `SELECT` on the table, and
- the blended-price bug §5a exists to prevent stays fully reachable.

The protection is real only once the services stop connecting as superuser.

**Correction:** migration 18 still creates the roles and grants, but the plan gains an
explicit application step: `services/api` and `apps/binder-vault` connect as `vault_app`,
ingest jobs as `vault_ingest`, with `postgres` reserved for migrations. That is an app +
deployment change (DSNs, `docker-compose`, launcher env), so it is its own step with its
own gate — see §4 step 2b. Until it lands, §5a is documentation, and the plan should say so
rather than implying enforcement.

Also, for the tests to mean anything, they must connect **as** `vault_app` — a superuser
connection asserting it cannot read a table will always be wrong. Noted in §9.

### C6 — Three guarantees are asserted but not implemented by the DDL *(substantive)*

The Step 2 prompt asks for tests proving properties that v1's DDL does not provide:

| Asserted | v1 provides | Needed |
|---|---|---|
| `market_price_observation` has "no UPDATE path" | append-only by intent only | `REVOKE UPDATE, DELETE` + a `BEFORE UPDATE OR DELETE` trigger that raises, mirroring `vault_evidence.raw_snapshots` |
| `grade_estimate_observation.needs_review` "cannot be set false" | `DEFAULT true` only | a `BEFORE UPDATE` trigger rejecting `true → false`; default alone stops nothing |
| a `condition_key` change requires an event row "in the same transaction" | prose | see C7 |

**Correction:** v2 specifies each mechanism explicitly. The repo already has the right
precedent for the first one in `raw_snapshots`, so this is consistency, not invention.

### C7 — "matching event row in the same transaction" needs a definition

Two rows can satisfy "matching" loosely and still hide a lost write. The workable test is:
an `inventory_condition_event` row exists for this item whose `to_condition_key` equals the
new value **and** which was inserted by the current transaction.

**Correction:** the trigger checks `xmin = pg_current_xact_id()::xid` on the event row
(Postgres 13+; `txid_current()` on older). This is precise, needs no session state, and
cannot be satisfied by a pre-existing event row from last week. `from_condition_key` is
also asserted to equal `OLD.condition_key`, so history stays a chain rather than a set of
disconnected claims.

### C8 — Step 3's backfill source does not exist *(blocking for step 3, not for 17/18)*

v1 §13 backfills Pokémon from `vault_pokemon` and adds compatibility views there. But
`vault_pokemon.card` and `vault_pokemon.set` are both **empty**. The real Pokémon data is:

| Where Pokémon data actually is | Rows |
|---|---|
| `vault_tcg.binder_slot` (filled pockets, `card_name`/`set_name`/`number`/`external_id`) | 4 |
| `vault_collection.holding` where `source = 'binder_vault'` (pushed owned pockets) | varies |
| `services/api/src/seeds/pokemon-holdings-sample.json` (bridge seeds, not truth) | 5 |

**Correction:** the backfill reads `vault_tcg.binder_slot` + `vault_collection.holding`, and
the compatibility views belong in whatever the API reads today — which is
`vault_collection` and `vault_tcg`, not `vault_pokemon`. Compatibility views over
`vault_pokemon` would satisfy nothing, because nothing reads it. Step 3's Phase A mapping
document becomes more important, not less, and its inputs change completely.

### C9 — `capture_asset` does not exist; the table is `capture_image`

v1 §6: "Capture tables (`capture_session`, `capture_asset`) are reused unchanged." The repo
has `vault_media.capture_session` and `vault_media.capture_image`.

**Correction:** use the real name. Re-pointing captures at `inventory_item.id` is a Step 3
concern and must not silently drop existing rows.

### C10 — `inventory_item.owner_id` has no FK target

v1 comments it as "FK to vault_core tenant/user". No such table exists in `vault_core`. The
only candidate in the database is `vault_platform.tool_user`.

**Correction:** see **D5**. Either FK to `vault_platform.tool_user`, or keep it
unconstrained with a `COMMENT` saying so explicitly. An unenforced column documented as a
foreign key is worse than either.

### C11 — `UnitRef` as Pydantic conflicts with the stack *(blocking)*

No Python API layer exists, `pydantic` is not a dependency, and `packages/pricing` is
TypeScript. "Matching the existing project's model conventions" therefore points at a zod
schema, not `BaseModel`. AGENTS.md permits changing stack defaults "only via an ADR".

**Correction:** see **D4**. §8 below gives the zod form, which preserves every property
v1 wanted — frozen, both fields required, no `Optional`, one object at the boundary.

### C12 — `vault_mtg` audit: answered

v1 §16 leaves this open and gates step 3 on it. It is done: `vault_mtg` is empty
scaffolding. Per v1's own rule, it is dropped during contract (step 9) and **step 5 does
not need to move ahead of step 3**.

`vault_pokemon` and `vault_sports` are also empty — worth knowing before the plan assumes
either is a data source. Related: `collectionTabs.ts` advertises `schema: "vault_pokemon"`
for the live Pokémon tab, which is inaccurate today; it reads `vault_tcg` and
`vault_collection`.

### C13 — "Do not touch existing schemas" vs creating roles

Roles are cluster-level, not schema-level, so `CREATE ROLE` does not violate the
constraint. Noted only so the reviewer is not surprised by a role appearing outside
`vault_tcg`. Roles are created `NOLOGIN` initially; granting login is part of step 2b.

### C14 — Idempotency needs `CREATE TYPE` guards

`CREATE TYPE … AS ENUM` has no `IF NOT EXISTS`. On a second run it raises `duplicate_object`,
which `migrate_db.py` swallows as "already applied" — but because the whole file is one
transaction, the rest of the migration is then skipped. That is fine for a fully-applied
file and wrong for a partially-authored one.

**Correction:** wrap each enum in a `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; $$`
block so re-runs are genuinely idempotent statement-by-statement, matching the
`20260815_*` precedent.

### C15 — What v1 got right and v2 keeps unchanged

For the avoidance of doubt: the four catalog levels (B2), treatments as an axis-constrained
reference table with a generated signature (B3), splitting `price_type` / `channel` /
`condition_key` (B4), removing valuation and grade columns from `inventory_item` (B5),
scores as versioned observations rather than entity columns (B6/§7), `language` on the
printing (B7), `priced_unit` as the downstream join key (B8), the explicit `'any'` wildcard
row instead of NULL, and the Test K $10-vs-$500 fixture — all correct, all retained
verbatim. The `inventory_item` exclusion list in particular is right: nothing on it belongs
on the row.

---

## 2. Decisions needed before any SQL

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Target schema for the new spine | (a) new schema, e.g. `vault_catalog`, leaving ADR 0007's `vault_tcg` alone; (b) keep `vault_tcg` as target and rename the live binder tables first; (c) supersede ADR 0007 and fold binder into the new spine at step 4 | **(a)** for 17–18. It is the only option that lets migrations 17 and 18 land without touching a live, app-backed schema. Binder reconciliation then happens once, deliberately, at step 4 — where v1 already planned to migrate binder data. |
| **D2** | `priced_unit` naming | (a) new `<schema>.priced_unit`, schema-qualified, with a comment pointing at `vault_market.priced_unit`; (b) different name; (c) extend the existing `vault_market.priced_unit` | **(a)**. Keeps the protected term, avoids touching `vault_market`, and the schema qualifier removes ambiguity. Reconciliation is a later, separate decision. |
| **D3** | Three price-history tables | (a) new schema owns TCG observations, reconcile `vault_core.market_price_observation` later; (b) reuse the `vault_core` table; (c) drop the unused `vault_core` one now | **(a)** now, with (c) proposed at contract. The `vault_core` table has no readers, so nothing breaks either way, but dropping it is destructive and needs its own approval. |
| **D4** | `UnitRef` language | (a) zod + TS type in `services/api`; (b) Pydantic, which requires an ADR adding a Python API layer | **(a)**. Same guarantees, no stack change, and the pricing code it must guard is already TypeScript. |
| **D5** | `inventory_item.owner_id` | (a) FK to `vault_platform.tool_user`; (b) no FK, documented as externally managed | **(b)** for this pass, with a table comment. `tool_user` is a tool-linkage table, not an identity table, and inventing an owner model is outside these sections. |

---

## 3. Revised target layout

Assuming D1(a) and D2(a). `<schema>` is the name you choose in D1.

```
<schema>                       ← new: catalog + pricing + inventory spine
  card_game, treatment, game_treatment, rarity, condition_key      (mig 17, §2)
  card_identity, card_set, card_printing, card_variant,
  card_variant_treatment                                            (mig 17, §3)
  priced_unit                                                       (mig 17, §4)
  market_price_observation, v_priced_unit_current, price_series()    (mig 18, §5/5a)
  inventory_item, inventory_condition_event,
  grade_estimate_observation                                         (mig 18, §6)
  score_observation                                                  (mig 18, §7)
  collectible_subject, identity_subject                              (mig 18, §8)

vault_tcg        ← UNCHANGED. ADR 0007 binder layout, live.
vault_market     ← UNCHANGED. priced_unit / sale / market_value_history.
vault_core       ← UNCHANGED. asset + intelligence tables.
vault_pokemon    ← empty. Not a backfill source.
vault_mtg        ← empty. Drop at contract.
```

---

## 4. Revised sequence

| Step | Content | Filename | Gate |
|---|---|---|---|
| 0 | `vault_mtg` audit | — | **DONE** — empty scaffolding |
| 1 | Reference tables + catalog spine + priced unit (§2–4) | `20260819_17_tcg_catalog_spine.sql` | Nami fixture inserts; tests D/E; re-runnable |
| 2 | Pricing + inventory + scores + subjects + access layer (§5–8, 5a) | `20260819_18_tcg_pricing_inventory.sql` | Tests C/I/K; enforcement tests in C6 |
| **2b** | **New.** Services connect as `vault_app`; ingest as `vault_ingest`; `postgres` for migrations only | app + compose + launcher | `vault_app` provably cannot `SELECT` `market_price_observation` **from the running API**, not just from a test connection |
| 3 | Pokémon backfill (sources per C8) + compat views where the API actually reads | `20260819_19_*` | Phase A mapping approved first; verification gate; zero data loss |
| 4 | Binder + hunts, **including reconciliation with ADR 0007** | `20260819_20_*` | Tests F/G; Binder `:3010` and the Pokémon terminal still work |
| 5–9 | MTG/Scryfall, One Piece, sealed, API v2, contract | as v1 | as v1 |

Step 2b is the difference between §5a being a mechanism and being a comment. Step 4 is
where the C1 collision is actually paid for; it is no longer a mechanical step.

---

## 5. Revised §5a

Unchanged in intent. Changes in v2:

1. `REVOKE ALL ON <schema>.market_price_observation FROM vault_app` plus explicit
   `REVOKE UPDATE, DELETE` from all roles, and an append-only trigger, so the "no UPDATE
   path" claim is enforced by two independent mechanisms.
2. `GRANT INSERT` to `vault_ingest` only.
3. `price_series(p_priced_unit_id uuid, p_condition_key text, p_since timestamptz DEFAULT now() - interval '180 days')`,
   `LANGUAGE sql STABLE SECURITY DEFINER`, **no default on `p_condition_key`**, owned by a
   role that can read the table, `SET search_path` pinned in the function definition
   (a `SECURITY DEFINER` function without a pinned search_path is a privilege-escalation
   footgun). `GRANT EXECUTE` to `vault_app`.
4. No cross-condition aggregate view or function. None is needed: `v_priced_unit_current`
   is `DISTINCT ON (priced_unit_id, condition_key)` and every consumer passes a condition.
   **I do not need one and am not asking for one.**
5. Roles created `NOLOGIN`; login and DSN switchover are step 2b.

---

## 6. `UnitRef` (D4 option a)

```ts
// services/api/src/lib/unitRef.ts
import { z } from "zod";

/**
 * (priced_unit_id, condition_key) is a pair and is never split. 'any' is an
 * explicit condition_key value; there is no null and no optional half.
 */
export const unitRefSchema = z
  .object({
    pricedUnitId: z.string().uuid(),
    conditionKey: z.string().min(1),
  })
  .strict()
  .readonly();

export type UnitRef = z.infer<typeof unitRefSchema>;

export function unitCacheKey(ref: UnitRef): string {
  return `${ref.pricedUnitId}:${ref.conditionKey}`;
}
```

`readonly()` gives the frozen property, `.strict()` rejects a stray `priced_unit_id`
spelling, and both fields are required so there is no `Optional` to forget. Every pricing
repository function in `packages/pricing` and `services/api` takes `UnitRef` — never a bare
id — which is the rule that actually prevents the bug day to day.

---

## 7. Tests

`tests/test_migration_17.py` and `tests/test_migration_18.py`, following
`tests/test_raw_snapshots.py`: skipped unless `IQVAULT_TEST_DSN` is set, so they run in CI
(which already applies migrations then runs `pytest -q`) and skip cleanly for anyone
without a database.

Migration 18 assertions, with C5/C6 folded in:

1. **Test K** — one variant; `raw:nm` at `$10.00`, `psa:10` at `$500.00`. `price_series`
   returns each independently; no shipped view or function returns a blended value. A blend
   is wrong by 50×, so it cannot pass unnoticed.
2. `price_series` cannot be called without a condition argument — function-resolution error.
3. `vault_app` cannot `SELECT market_price_observation` — **connecting as `vault_app`**, not
   as `postgres`. A superuser connection would make this assertion meaningless.
4. `UPDATE`/`DELETE` on `market_price_observation` is rejected even for the owner.
5. `inventory_item.condition_key` `UPDATE` without a same-transaction event row is rejected;
   with one, it succeeds and the history chain links `from` → `to`.
6. `grade_estimate_observation.needs_review` cannot be flipped `true → false`.
7. Both migrations are re-runnable with no error and no duplicate rows.

---

## 8. What happens after you decide

With D1–D5 answered I write migrations 17 and 18 together — 18 is untestable without 17 —
apply both to a scratch database on this machine, run both pytest modules, and report
actual output. Then step 2b, then the Step 3 Phase A mapping document for approval.

No migration is written until D1 and D2 are answered, because both change every
schema-qualified name in both files.
