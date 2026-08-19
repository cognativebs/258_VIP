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

## Intelligence core (`20260815_11`–`20260815_16`)

Backs `@vip/intelligence`. All tables live in `vault_core`:

| File | Tables |
|------|--------|
| `11_prediction_ledger` | `prediction` + views `prediction_needs_scoring`, `prediction_calibration` |
| `12_evidence_engine` | `recommendation`, `evidence_card` |
| `13_market_cycle_schema` | `market_cycle_state`, `buy_opportunity_scan` |
| `14_transaction_intelligence` | `acquisition_underwriting`, `grading_evaluation`, `portfolio_consolidation_review` |
| `15_collection_intelligence` | `collection_goal`, `binder_page`, `binder_slot`, `collection_synergy_score` |
| `16_field_modes_interfaces` | `field_session`, `field_captured_item`, `card_scan`, `card_identification`, `card_identification_candidate`, `market_price_observation`, `identification_golden_case` |

Two naming traps to know before editing these:

- **`vault_core.binder_page` / `binder_slot` are not `vault_tcg.binder_page` / `binder_slot`.**
  `vault_tcg` is the physical Binder Vault layout an operator drags cards around in
  (ADR 0007). `vault_core` is the *curation target* — museum pages, slot tiers,
  goal completion. Same words, different jobs; do not join them casually.
- **`vault_core.prediction.resolves_at` is trigger-set, not generated.**
  `timestamptz + interval` is only STABLE (TimeZone-dependent), so Postgres refuses
  it in `GENERATED ALWAYS`. `trg_prediction_set_resolves_at` fills it on INSERT and
  `prediction_protect_forecast` then treats it as frozen.

## Rules

- `vault_evidence.raw_snapshots` is **INSERT-only** (triggers block UPDATE/DELETE).
- `vault_core.prediction` is append-only until resolution; resolved rows are immutable
  and never deleted (enforced by trigger, not convention).
- Processed catalog/holding rows must be regenerable from a snapshot payload.
- Do not put inferred grades into verified columns — use provenance method=`inferred`.
- Binder TCG layout is Postgres `vault_tcg` (ADR 0007). SQLite is import-only.
