# VIP Backlog

**Feature freeze:** ON. Only **Now** may be built. Everything else waits for a gate.

---

## Now — Phase 4 (Automated intelligence runs)

- [x] `packages/signals` — pipeline stages (append-only, never overwrite)
- [x] Source registry (authority, accuracy, latency, coverage, access, terms)
- [x] Dedup + novelty scoring; quarantine noise (don’t delete)
- [x] Prediction ledger + Brier/calibration helpers
- [x] `services/jobs` — zero-touch Pokémon drops run + “what changed” delta
- [x] Phase 4 gate: scheduled/job run completes with no manual trigger + delta report (2026-07-21)

## Next

### Phase 3 — IQVault working app *(shipped; trial deferred)*
- [x] API + Next.js collector face
- [x] Dogfood / trial week — **deferred until after build-out** (Phases 4+)

### Phase 2 — Decision engine v0.1 *(shipped)*
- [x] `packages/decision-engine` + backtest gate (2026-07-21)

### Phase 1 — Canonical data foundation *(shipped)*
- [x] core-model, evidence, ingest, raw_snapshots, round-trip gate
- [ ] Schema review (Opus) before merge

---

## Later — Phases 5–6 + trial

### Trial (after build-out)
- Dogfood IQVault for 7 days vs spreadsheets
- Hunt completion % vs shelf; sell-queue trust (top 20)

### Phase 5 — Mobile Show Mode
- Scan + asking price → decision engine
- ≤4 taps; offline capture + sync; &lt;8s field trial

### Phase 6 — VaultOS pilot + grading capture
- Store constraints on same engine
- Capture session model (crossover ML stays Parked)
- One cooperative store pilot metric

---

## Parked

Do not build until a milestone gate explicitly unlocks:

- AI glasses / wearable interface
- PSA → CGC/TAG crossover ML
- Full POS & event management
- Marketplace listing automation
- Custom / unsupervised model training
- Every collectible category at once
- Final legal names, domains, trademarks
- Premium data-feed marketplace
- Expanding `bridge/` as a product (absorb under VIP API instead)
- Parallel “second brain” offer engines in face apps
- Interactive WebGL “AI core” hero (stacked neon discs, orbiting AI nodes, bloom/particles) — marketing/visual experiment, not VIP core · sandbox lives at `sandbox/ai-core/` (standalone, not wired into product)

---

## Open ideas (unsorted → sort on intake)

_Add new ideas here, then move to Now/Next/Later/Parked. Do not start work from this list._
