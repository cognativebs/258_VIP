# VIP Backlog

**Feature freeze:** ON. Only **Now** may be built. Everything else waits for a gate.

**Re-sequenced 2026-07-23 (ADR 0002 + 0003):** Finish **Orchestr8** first, then build
the rest of VIP *through* it. **Orchestr8 authors build specs; Cursor builds them**
(ADR 0003, autonomy 0 — Orchestr8 never writes or executes). After Cursor implements,
paste the diff back for an optional Challenge-Council review against the spec.

---

## Now — Phase O1 (Build-spec generator)

- [ ] Build-spec (work order) schema: goal, constraints, contracts/schemas-first, file plan, acceptance tests, risks, provenance, ready-to-paste Cursor prompt
- [ ] `build_spec` council task: architect → domain_expert → tester (test-designer) → critic (veto)
- [ ] Emit spec as a persisted run bundle **and** a `docs/specs/*.md` file
- [ ] Read-only repo context wired for the committee (`read_file` / `list_dir` / `grep` / `git_diff`)
- [ ] O1 gate: committee produces a critic-passed build spec for a real backlog item; spec persisted + written to `docs/specs/`

## Next — Phase O2 (Diff review loop)

- [ ] Paste implemented diff back → Challenge Council scores it vs the spec's acceptance criteria
- [ ] O2 gate: council catches a deliberately spec-violating diff

---

## Later — VIP resumes (specced by Orchestr8, built in Cursor, after O2)

### Terminal UI + Orchestr8 controls *(was in progress; deferred)*
- Bloomberg-style terminal restyle of `apps/iqvault-web`
- Analysis/insights panel
- Orchestr8 team modal: solo / duo / committee; consumes O1 model/tool layer
- (Consumer of O1 — do not build standalone before O2)

### Trial (after build-out)
- Dogfood IQVault for 7 days vs spreadsheets
- Hunt completion % vs shelf; sell-queue trust (top 20)

### Phase 5 — Mobile Show Mode
- Scan + asking price → decision engine
- ≤4 taps; offline capture + sync; <8s field trial

### Phase 6 — VaultOS pilot + grading capture
- Store constraints on same engine
- Capture session model (crossover ML stays Parked)
- One cooperative store pilot metric

---

## Shipped

### Phase O0 — Orchestr8 contracts & persistence *(gates met 2026-07-23)*
- [x] Contract schema + validated `contract.yaml` for all 22 agents (`validate_contracts.py`, 22/22)
- [x] Immutable run/artifact persistence wired into `run_job` (`runstore.py`; `demo_persist_run.py`, 8/8)
- [x] Opus review of contract defaults → tools trimmed to read-only, escalation/failure fixed, contracts bumped to v2 (ADR 0003)

### Phase 4 — Automated intelligence runs *(2026-07-21)*
- [x] `packages/signals` — append-only pipeline stages
- [x] Source registry (authority, accuracy, latency, coverage, access, terms)
- [x] Dedup + novelty scoring; quarantine noise (don't delete)
- [x] Prediction ledger + Brier/calibration helpers
- [x] `services/jobs` — zero-touch Pokémon drops run + "what changed" delta

### Phase 3 — IQVault working app *(shipped; trial deferred)*
- [x] API + Next.js collector face
- [x] Dogfood / trial week — deferred until after build-out

### Phase 2 — Decision engine v0.1 *(shipped)*
- [x] `packages/decision-engine` + backtest gate

### Phase 1 — Canonical data foundation *(shipped)*
- [x] core-model, evidence, ingest, raw_snapshots, round-trip gate
- [ ] Schema review (Opus) before merge

---

## Parked

Do not build until a milestone gate explicitly unlocks:

- **In-Orchestr8 build harness** (tool sandbox, write/execute tools, verification gate) — superseded by Cursor as builder (ADR 0003)
- **Orchestr8 semi-autonomous / fully autonomous build modes** (Orchestr8 writes/tests/commits) — stays parked; Cursor builds
- AI glasses / wearable interface
- PSA → CGC/TAG crossover ML
- Full POS & event management
- Marketplace listing automation
- Custom / unsupervised model training
- Every collectible category at once
- Final legal names, domains, trademarks
- Premium data-feed marketplace
- Expanding `bridge/` as a product (absorb under VIP API instead)
- Parallel "second brain" offer engines in face apps
- Interactive WebGL "AI core" hero — marketing/visual experiment; sandbox at `sandbox/ai-core/`

---

## Open ideas (unsorted → sort on intake)

_Add new ideas here, then move to Now/Next/Later/Parked. Do not start work from this list._

- **Binder Vault** (`apps/binder-vault`) — local-first digital card-binder builder
  (drag-and-drop, live pokemontcg.io + TCGdex card search, high-res art, SQLite via
  Drizzle/better-sqlite3, provenance on every placement). **Built 2026-07-23 as an
  explicit owner-approved exception to the feature freeze** (off-milestone; not part of
  the Orchestr8 O0 track). Standalone Next.js app on port 3010; does not touch the
  frozen VIP core packages/services. Sort into a milestone (or fold into the collector
  face) on next backlog review.
