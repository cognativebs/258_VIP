# VIP Backlog

**Feature freeze:** ON. Only **Now** may be built. Everything else waits for a gate.

**Re-sequenced 2026-07-23 (ADR 0002):** Complete **Orchestr8 as a build engine** first,
then build the rest of VIP *through* Orchestr8. Autonomy target = **(A) Advisory →
human applies** (Orchestr8 proposes specs/diffs; a human reviews and applies).

---

## Now — Phase O0 (Orchestr8 contracts & persistence) *(gates met 2026-07-23)*

- [x] Agent contract schema: mission, `allowed_tools`, input/output schema, confidence rules, failure behavior, escalation (AGENTS.md rule 6) — `orchestr8/config/contract.schema.json`
- [x] Backfill/validate a contract for all 22 agents against the schema — `orchestr8/agents/*/contract.yaml`, `validate_contracts.py`
- [x] Run + artifact persistence schema (immutable per rule 3): job id, roles, models, trace, cost, verdict — `orchestr8/config/run.schema.json`, `services/runstore.py`
- [x] Persist a job end-to-end with full trace + cost — `run_job` wraps `_execute_job` and persists; offline gate `demo_persist_run.py`
- [x] O0 gate: every agent has a validated contract (22/22); run persisted, re-readable, and immutable (8/8 checks)
- [ ] Opus review of contract defaults (allowed_tools / high_impact / escalation) before O1

## Next — Orchestr8 track (O1–O4)

### Phase O1 — Tool layer (read + propose)
- [ ] Allow-listed tools: `read_file`, `list_dir`, `git_diff`, `grep`
- [ ] Propose-only `write_file` / `patch` — emit artifacts, never mutate the repo (autonomy A)
- [ ] Per-agent `allowed_tools` enforcement from contracts
- [ ] O1 gate: Architect reads real files + emits a proposed patch artifact with provenance

### Phase O2 — Verification gate
- [ ] Apply proposed diffs to a throwaway scratch worktree
- [ ] Run `tsc` + tests; capture real pass/fail
- [ ] Critic receives real results (not vibes); gate blocks on fail
- [ ] O2 gate: a deliberately broken proposed change is caught and rejected

### Phase O3 — Build workflow
- [ ] "Build spec" contract → plan → implement → verify → critic → diff bundle
- [ ] Run persistence + artifact store; cost/critic gate on high-impact specs
- [ ] O3 gate: Orchestr8 produces one merge-ready diff bundle for a trivial VIP task, end to end

### Phase O4 — Self-hosting (advisory)
- [ ] Orchestr8 authors a real backlog item as a diff bundle; human applies
- [ ] O4 gate: a VIP change ships that Orchestr8 authored and a human reviewed + applied

---

## Later — VIP resumes (built via Orchestr8 after O4)

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

- **Orchestr8 semi-autonomous mode** (scratch worktree + PR) — unlock after autonomy A proven
- **Orchestr8 fully autonomous mode** (write/test/commit on a branch) — unlock after O2 trusted
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
