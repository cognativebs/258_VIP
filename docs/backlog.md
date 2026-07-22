# VIP Backlog

**Feature freeze:** ON. Only **Now** may be built. Everything else waits for a gate.

---

## Now — Phase 3 (IQVault working app)

- [x] `services/api` — inventory, hunts, sell queue, recommendations (no direct DB from app)
- [x] `apps/iqvault-web` — Next.js collector face
- [x] Portfolio + provenance badges
- [x] Recommendations with range + supporting/opposing evidence
- [x] Collection Hunts (Absolute Batman + Pokémon 30th) image-first gallery
- [x] Sell queue (MUS/INV/LIQ, priority, flags)
- [x] Signals / Watchlist / Theses / Sources views
- [ ] Dogfood week gate (use instead of spreadsheets for 7 days)

## Next

### Phase 2 — Decision engine v0.1 *(shipped)*
- [x] `packages/decision-engine` + backtest gate (2026-07-21)

### Phase 1 — Canonical data foundation *(shipped)*
- [x] `packages/core-model` — TS types + zod for entities v0.1; BaseRecord + provenance block
- [x] `packages/evidence` — provenance helpers (`assertVerified`, `markInferred`)
- [x] `infra/db` — Postgres migrations; immutable `raw_snapshots` (no UPDATE)
- [x] CLZ adapter + TCG CSV stub under shared Adapter interface
- [x] Round-trip gate: import → snapshot → delete derived → regenerate identical
- [x] Honest gap: grade 0.0 → null grade + NM inferred · unverified
- [x] Wire loaders to Postgres + apply migration on live DB
- [ ] Schema review (Opus) before merge
- [x] Applied `20260720_01_raw_snapshots.sql` on local `iqvault` Postgres (immutable triggers verified 2026-07-20)

---

## Later — Phases 4–6

### Phase 4 — Automated intelligence runs
- Signal pipeline stages (no overwrite)
- Source registry, dedup, novelty
- Prediction ledger + calibration
- Zero-touch Pokémon drops job + delta report

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
