# `vault_tcg` — Cursor Build Prompts

Companion to `2026-08-17_multigame_tcg_schema_proposal.md`. Ten prompts, submitted one at a time. Do not run them in parallel — steps 1→4 are strictly ordered, and step 0 gates step 3.

**Setup once before Step 1:** drop the STANDING CONSTRAINTS block below into `AGENTS.md` at the repo root so Cursor carries it across sessions. Each prompt still repeats it in compressed form, because individually-submitted prompts cannot rely on prior context.

---

## STANDING CONSTRAINTS (paste into AGENTS.md)

```
IQVault / vault_tcg — standing rules for all work in this project.

DATABASE
- PostgreSQL 16 + pgvector via the pgvector/pgvector:pg16 image. Never plain postgres:16.
- Extensions install into the public schema. Never into vault_core or vault_tcg.
- Every migration: BEGIN; ... COMMIT; wrapping, explicit SET search_path, public.uuid_generate_v4()
  for UUID defaults, and a COMMENT ON TABLE for every table created.
- Migrations are numbered sequentially. Existing project migrations end at 16; new work starts at 17.
- Every migration must be idempotent and re-runnable (IF NOT EXISTS, ON CONFLICT DO NOTHING).

ARCHITECTURAL NON-NEGOTIABLES
- Market price is ALWAYS a time-series observation. Never a point-in-time scalar column.
- needs_review is a permanent workflow state. Never auto-clear it.
- Confirmed identities are never silently overwritten.
- Raw scans/captures are immutable once written.
- (priced_unit_id, condition_key) is a pair. It is never split. NULL never means "any" —
  the condition_key table has an explicit 'any' row.

PROVIDERS
- The TCGplayer public API is CLOSED to new developers. Do not write code that assumes access to it.
- Provider responses always pass through a normalization layer before touching vault_tcg.
- Provider IDs live in a provider_ids jsonb column. They are never a primary key or foreign key.

PROCESS
- STOP and report before any destructive operation (DROP, TRUNCATE, destructive ALTER, data delete).
- Do not modify data outside vault_tcg without explicit approval in the prompt.
- Do not add features, tables, or columns not named in the prompt. Report the gap instead.
- If the prompt conflicts with the design doc, STOP and report the conflict. Do not pick one.

OUT OF SCOPE ENTIRELY (do not build, do not scaffold, do not stub)
- Yu-Gi-Oh provider. SportsCardsPro provider. PSA/CGC pop-report ingestion.
- AI/smart-glasses interfaces. Automated cron jobs.
- MTG deck builder, One Piece deck builder, tournament legality engine, rules simulator.
- AI grading implementation, market prediction implementation, eBay connector rewrite.
```

---

## STEP 0 — `vault_mtg` audit (read-only, blocks Step 3)

Run this before anything else. It is read-only and changes nothing.

> **Prompt:**
>
> Read-only investigation task. Make no changes to any file or database object.
>
> Connect to the local IQVault PostgreSQL instance and report on the `vault_mtg` schema:
>
> 1. Every table in `vault_mtg` with approximate and exact row counts, and total relation size.
> 2. For any table with more than zero rows: its full DDL and five sample rows.
> 3. Any foreign keys pointing INTO `vault_mtg` from other schemas.
> 4. Any views, functions, or triggers in other schemas that reference `vault_mtg` objects.
>
> Use this as a starting point and extend it:
>
> ```sql
> SELECT c.relname AS table_name,
>        c.reltuples::bigint AS approx_rows,
>        pg_size_pretty(pg_total_relation_size(c.oid)) AS size
> FROM pg_class c
> JOIN pg_namespace n ON n.oid = c.relnamespace
> WHERE n.nspname = 'vault_mtg' AND c.relkind = 'r'
> ORDER BY c.reltuples DESC;
> ```
>
> Then state one conclusion in plain language: is `vault_mtg` empty scaffolding that can be dropped during the contract phase, or does it hold real data requiring its own backfill branch?
>
> Do not propose or write a migration. Report only.

---

## STEP 1 — Reference tables, catalog spine, priced unit

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` sections 1 through 4 before writing anything. Implement exactly what those sections specify — no additions, no omissions.
>
> Create migration `17_vault_tcg_catalog_spine.sql` producing:
>
> - The `vault_tcg` schema.
> - Reference tables: `card_game`, `treatment`, `game_treatment`, `rarity`, `condition_key` (including the `'any'` wildcard row and the `is_wildcard` column).
> - Catalog spine: `card_identity`, `card_set`, `card_printing`, `card_variant`, `card_variant_treatment`.
> - `priced_unit` with the exactly-one CHECK constraint.
> - The `treatment_signature` maintenance trigger on `card_variant_treatment`: an AFTER INSERT OR DELETE OR UPDATE trigger that rewrites `card_variant.treatment_signature` as the sorted, `'|'`-joined treatment code list, or the literal `'standard'` when the variant has no treatments.
> - The `priced_unit` creation trigger: AFTER INSERT on `card_variant` and on `sealed_product_variant`, creating exactly one `priced_unit` row with a deterministic `canonical_key`.
>
> `sealed_product_variant` does not exist yet (Step 7). Guard the sealed side of that trigger so this migration succeeds standalone — either create the trigger function now and attach it to the sealed table in Step 7, or use a deferred attach. State which approach you chose and why.
>
> Seed data in the same migration:
> - `card_game`: pokemon, mtg, one_piece.
> - `treatment`: every treatment named in design doc §11 plus the Pokémon set, each assigned to exactly one axis from (finish, border, frame, art, rarity_treatment, serialization). List your axis assignments in the migration comments — this is a judgement call and I want to review it.
> - `game_treatment`: map each treatment to the games where it is legal.
> - `condition_key`: `any`, `raw:nm`, `raw:lp`, `raw:mp`, `raw:hp`, `raw:dmg`, `sealed:sealed`, plus PSA/CGC/BGS graded keys.
>
> Also produce:
> - A `down` migration (`17_down.sql`) that drops the `vault_tcg` schema cleanly. Do not run it.
> - A pytest module `tests/test_migration_17.py` asserting: the migration is re-runnable without error; `treatment_signature` is order-independent (insert `foil` then `borderless` and `borderless` then `foil`, assert identical signatures); the one-treatment-per-axis constraint rejects a second `finish` treatment; a `card_variant` insert produces exactly one `priced_unit`.
>
> Run the migration against local Docker, run the tests, and report results. Do not touch `vault_pokemon`, `vault_mtg`, `vault_comic`, or any other existing schema.
>
> Constraints: BEGIN/COMMIT wrapping, explicit `SET search_path`, `public.uuid_generate_v4()`, `COMMENT ON TABLE` for every table. Idempotent and re-runnable.

---

## STEP 2 — Pricing, inventory, scores, sealed access layer

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` sections 5, 5a, 6, 7, and 8. Migration 17 is already applied. Implement exactly those sections.
>
> Create migration `18_vault_tcg_pricing_inventory.sql` producing:
>
> - Enums: `price_type`, `price_channel`, `inventory_bucket`.
> - `market_price_observation` with `condition_key` NOT NULL, the composite index `(priced_unit_id, condition_key, observed_at DESC)`, and no UPDATE path.
> - `inventory_item` exactly as specified. It must NOT have `current_market_value`, `insurance_value`, `grade_prediction`, `museum_status`, `investment_status`, `sell_status`, `duplicate_status`, `binder_id`, `binder_page_id`, or `binder_slot`. If you think any of those belong, STOP and tell me rather than adding them.
> - `inventory_condition_event` plus the BEFORE UPDATE trigger on `inventory_item` that rejects a `condition_key` change unless a matching event row was written in the same transaction.
> - `grade_estimate_observation` with `needs_review` defaulting to true and no update path that clears it.
> - `score_observation` (the single polymorphic table — do not create one table per score).
> - `collectible_subject` and `identity_subject`.
> - `v_priced_unit_current`, grouped by `(priced_unit_id, condition_key)`.
>
> Then implement the §5a sealed access layer in the same migration:
> - Create roles `vault_app` and `vault_ingest` if absent.
> - `REVOKE ALL ON market_price_observation FROM vault_app`; grant INSERT to `vault_ingest` only.
> - The `price_series(p_priced_unit_id uuid, p_condition_key text, p_since timestamptz DEFAULT ...)` function, SECURITY DEFINER, with **no default on `p_condition_key`**. Grant EXECUTE to `vault_app`.
> - Do not create any view or function that aggregates price across condition keys. If one seems necessary, STOP and explain why.
>
> Also produce the `UnitRef` Pydantic model (frozen, fields `priced_unit_id: UUID` and `condition_key: str`, no Optional on either) in the API layer, matching the existing project's model conventions. Every pricing repository method must accept `UnitRef` — never a bare `priced_unit_id`.
>
> Tests in `tests/test_migration_18.py`:
> - Test K fixture: one variant, `raw:nm` observation at $10.00, `psa:10` observation at $500.00. Assert `price_series` returns each independently and that no shipped view or function returns a blended value.
> - Assert `price_series` cannot be called without a condition argument.
> - Assert `vault_app` cannot SELECT from `market_price_observation` directly.
> - Assert an `inventory_item.condition_key` UPDATE without an event row is rejected.
> - Assert `grade_estimate_observation.needs_review` cannot be set false by any shipped code path.
>
> Run migration and tests locally, report results. Do not touch existing schemas.

---

## STEP 3 — Pokémon backfill with compatibility views

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` section 13. Migrations 17 and 18 are applied. Step 0's `vault_mtg` audit is complete.
>
> This step reads production Pokémon data. It must not modify it.
>
> **Phase A — investigate and report, then STOP.** Do not write the migration yet.
> Produce a written mapping document: every table and column in `vault_pokemon` and in `vault_collection` holding Pokémon inventory, mapped to its `vault_tcg` destination. Flag every column with no destination and every `vault_tcg` NOT NULL column with no source. Report row counts per table. Present this and wait for my approval.
>
> **Phase B — after I approve the mapping**, create migration `19_pokemon_backfill.sql`:
> - Backfill in order: sets → identities → printings → variants → priced units → `pokemon_card_extension`.
> - Backfill `inventory_item` **preserving existing UUIDs** via `INSERT ... SELECT id, ...`. This is non-negotiable; it protects binder assignments, captures, and Signals references. If any existing ID cannot be preserved, STOP and report rather than generating a new one.
> - Backfill pricing history into `market_price_observation`, mapping legacy condition/grade fields onto `condition_key`. Fail loudly on any unmapped value — never default to `raw:nm`.
> - Use deterministic keys so the entire backfill is idempotent and re-runnable.
> - Create compatibility views in `vault_pokemon` with the OLD table names and OLD column shapes, reading from `vault_tcg`, so the existing API and collection viewer keep working. The old physical tables are renamed with a `_legacy` suffix, not dropped.
>
> **Phase C — verification gate.** Write `scripts/verify_migration_19.py` asserting:
> - Row counts match per entity, source vs destination.
> - Sum of `cost_basis` and of `acquisition_price` match to the cent.
> - Every legacy inventory UUID exists in `vault_tcg.inventory_item`.
> - Zero rows where `needs_review` was true in source and false in destination.
> - Fifty randomly sampled records match field-by-field.
> - The Test K fixture from Step 2 still passes against backfilled data.
>
> Report verification output. Do not proceed past a failing assertion. Do not drop any legacy table — that is Step 9 and requires separate approval.

---

## STEP 4 — Binder and hunts

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` section 9. Migrations 17–19 are applied and verified.
>
> Create migration `20_vault_tcg_binder_hunts.sql`:
> - Enums `slot_status`, `hunt_status`.
> - `binder`, `binder_page`, `binder_slot`, `hunt_target` exactly as specified.
> - `binder_page.slot_count` defaults to 9 but is not hard-coded anywhere in the schema or the application layer. If you find a hard-coded 9 outside a default value, fix it and report where it was.
> - `binder_slot.target_condition_key` and `hunt_target.desired_condition_key` are NOT NULL DEFAULT `'any'`. Neither is ever nullable.
>
> Migrate existing binder data from its current location into these tables. Existing slot→card links become `inventory_item_id`; existing wanted/target entries become `target_priced_unit_id` with status `'wanted'`. Preserve binder and page IDs where they exist. Report anything that cannot be mapped rather than dropping it.
>
> Implement hunt matching as a database function or repository method taking a `UnitRef`: a hunt with `desired_condition_key = 'any'` matches any condition at or above `minimum_condition_key`; a specific `desired_condition_key` matches only that key.
>
> Tests in `tests/test_migration_20.py`:
> - Test F: a One Piece inventory item can occupy binder slot 1 identically to a Pokémon item. (Use a synthetic One Piece printing — the real import is Step 6.)
> - Test G: a slot with `target_priced_unit_id` set and `inventory_item_id` null persists with status `'wanted'`.
> - Filling a slot flips `wanted` → `owned` in one UPDATE.
> - A raw-NM field scan matches an `'any'` hunt whose owner framed it around a graded target.
> - A page with `slot_count = 12` works end to end.
>
> Report results. No destructive operations.

---

## STEP 5 — MTG extension and Scryfall provider

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` sections 11 and 12. Migrations 17–20 are applied.
>
> **Do not use or reference the TCGplayer API.** It is closed to new developers. Scryfall is the provider for this step.
>
> Create migration `21_mtg_extension.sql`:
> - `mtg_card_extension` keyed on `printing_id` as PRIMARY KEY and FK to `card_printing`.
> - `mtg_legality_snapshot` keyed on `card_identity`, not on printing. Legality is a property of the card, not the print run, and it changes over time.
>
> Implement the `CatalogProvider` protocol and `ScryfallProvider` as its first concrete implementation, with `NormalizedPrinting` / `NormalizedVariant` / `NormalizedTreatment` Pydantic models per §12. Respect Scryfall's rate limits and their requested request headers. Cache responses locally so re-running the import does not re-hit the API.
>
> **The importer's treatment-vs-printing rule (design decision 3):** follow the provider's collector number. A different collector number is a new `card_printing`. The same collector number with a different finish is a new `card_variant`. Borderless, showcase, extended-art, and comic-cover MTG cards generally carry their own collector numbers and therefore become printings, not variants. Foil vs nonfoil shares a collector number and therefore becomes a variant. Encode this in the importer, not the schema. Log every decision so I can audit the split.
>
> Import fixture: 25 Marvel-set MTG cards spanning standard, traditional foil, borderless, and comic-cover treatments. Prefer cards already present in IQVault if any exist.
>
> Tests:
> - Test E: traditional foil and nonfoil of the same card resolve to separate priced units with independent price series.
> - Test J: Scryfall IDs land in `provider_ids` jsonb and appear in no primary or foreign key.
> - Re-running the import is idempotent — no duplicate printings, variants, or priced units.
>
> Report the printing-vs-variant split for all 25 cards in a table so I can review it. Do not build a deck builder, legality engine, or format analytics.

---

## STEP 6 — One Piece extension and curated fixtures

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` sections 11 and 12, and decision 2 in §16. Migrations 17–21 are applied.
>
> Bandai publishes no first-party One Piece catalog API, and community datasets have unclear licensing. Per decision 2, this step uses **manually curated fixtures behind the same `CatalogProvider` interface** — implement `ManualCatalogProvider`, reading normalized JSON fixture files from disk. Do not scrape any site. Do not add a community API dependency.
>
> Create migration `22_one_piece_extension.sql`:
> - `one_piece_card_extension` keyed on `printing_id` as PRIMARY KEY.
> - Seed One Piece `rarity` rows and confirm the One Piece `treatment` and `game_treatment` rows from Step 1 cover: parallel, leader_parallel, sp, manga_rare, treasure_rare, alternate_art, winner, championship, anniversary, stamped, event_promo.
>
> Author fixture JSON for: Nami OP01-016 standard, Nami OP01-016 alternate art, Boa Hancock OP07-051, Nico Robin, Uta, Perona, Nefeltari Vivi, Jewelry Bonney, Yamato. The two Nami entries are the most important records in this step — they exercise identity, printing, variant, priced unit, and duplicate logic simultaneously.
>
> Populate `collectible_subject` and `identity_subject` for these characters. Subjects are franchise-scoped, not game-scoped — do not add a `game_id` to `collectible_subject`.
>
> Tests:
> - Test A: searching "Nami" returns every Nami printing and treatment.
> - Test B: Nami OP01-016 Alternate Art can be added to inventory.
> - Test C: adding the same card twice produces two inventory rows on one priced unit and is flagged as a physical duplicate.
> - Test D: standard and alternate-art Nami do not merge — distinct `treatment_signature`, distinct variants, distinct priced units.
>
> Report results plus any card where the correct printing-vs-variant split was ambiguous. Do not build a deck builder or rules engine.

---

## STEP 7 — Sealed products and art variants

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` section 10. Migrations 17–22 are applied.
>
> Create migration `23_sealed_products.sql`:
> - `sealed_product` and `sealed_product_variant` as specified.
> - A `sealed_product_type` reference table (booster_pack, sleeved_booster, booster_box, elite_trainer_box, pokemon_center_etb, collection_box, starter_deck, structure_deck, display, case, bundle, premium_collection, gift_collection, special_product). A reference table, not an enum — new product types must not require a migration.
> - Complete the `priced_unit` trigger attachment deferred from Step 1, so a `sealed_product_variant` insert creates exactly one `priced_unit` with `kind = 'sealed'`.
>
> Sealed inventory uses the same `inventory_item` table with `condition_key = 'sealed:sealed'`. Do not create a parallel sealed inventory table. Do not create a parallel sealed pricing table — sealed prices are `market_price_observation` rows like everything else.
>
> Fixture: the Phantasmal Flames sleeved booster with four art variants. Own three, leave art 4 as a hunt target.
>
> Tests:
> - A sealed art variant gets a priced unit and can hold price observations.
> - Art 4 exists as a `hunt_target` with no inventory item.
> - Acquiring art 4 fills the hunt and, if bound to a binder slot, flips it to `owned`.
> - Sealed and single-card inventory both appear in one inventory query with no game or kind branching.
>
> Report results.

---

## STEP 8 — API v2 and sell-queue verification

> **Prompt:**
>
> Read `2026-08-17_multigame_tcg_schema_proposal.md` section 14. Migrations 17–23 are applied.
>
> Implement the v2 API surface. Version the three breaking routes as `/v2` rather than mutating v1 in place — the collection viewer frontend is live against v1 and must keep working.
>
> New: `GET /v2/games`, `/v2/sets`, `/v2/sets/{id}`, `/v2/cards/{id}/variants` (where `{id}` is a **card_identity** id, not a printing id), `/v2/sealed`, `POST /v2/sealed`, `POST /v2/providers/{provider}/sync`, `POST /v2/providers/{provider}/search`.
>
> Breaking, v2 only: `GET /v2/cards/search` returns identity → printings → variants, not flat cards. `GET /v2/cards/{id}/prices` takes a required `condition_key` query parameter and returns a time series plus current value — never a scalar. `GET/POST/PATCH /v2/inventory` takes a `UnitRef` shape; valuation is a nested object sourced from `v_priced_unit_current`, never a stored column.
>
> Every pricing and valuation code path goes through `price_series` as the `vault_app` role. If any handler needs direct SELECT on `market_price_observation`, STOP and report it — that is a design failure, not a permissions problem to work around.
>
> `POST /v2/providers/{provider}/sync` must be idempotent and must record provider identity and fetch time in the source reference fields.
>
> Then verify Test H end to end: Pokémon, MTG, and One Piece inventory all enter the existing Stage 3.1 sell queue (Inventory → Sell Review → Build Online Listing → eBay Draft → Human Approval → Publish) through the same code path with no game-specific branching. If any branch on game exists in that flow, report its location — do not paper over it.
>
> Report the full acceptance-test matrix (A through K) with pass/fail. Do not rewrite the eBay connector.

---

## STEP 9 — Contract (requires separate written approval)

> **Prompt:**
>
> **Do not execute this step. Produce the plan and stop.**
>
> Migrations 17–23 are applied, the acceptance matrix passes, and v2 has soaked in normal use.
>
> Draft migration `24_contract_legacy_tables.sql` dropping the `_legacy` tables from Step 3 and, if Step 0 found it empty, the `vault_mtg` schema. Also draft `24_rollback.sql`.
>
> Present, and stop:
> 1. The exact list of objects to be dropped, with current row counts.
> 2. A pre-drop backup command with a verified restore procedure — not just a `pg_dump` line, the restore path too.
> 3. Confirmation that no view, function, trigger, foreign key, or application code path still references any object on the drop list. Enumerate how you verified this.
> 4. The rollback procedure if something surfaces post-drop.
>
> This is the only destructive migration in the sequence. It does not run until I reply with explicit written approval naming this step.
