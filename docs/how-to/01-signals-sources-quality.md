# How-To: Adjust signal sources and evaluate quality

**Start from:** IQVault collector face → **Sources** / **Signals**  
http://127.0.0.1:3000 (VIP web) — or Signals via VIP API if you prefer curl.

## What exists today (honest)

There is **no click-to-edit Sources UI** that turns adapters on/off or scores quality live. What you have:

1. **Sources page** (`/sources`) — registry *labels* from VIP API seed data (`GET /api/sources`). Read-only.
2. **Signals page** (`/signals`) — normalized events from the job feed (`GET /api/signals`, preferably `source: job_feed`).
3. **Real source registry** (code) — [`packages/signals/src/registry.ts`](../../packages/signals/src/registry.ts) (`DEFAULT_SOURCES`: `pokemon-news-rss`, `retail-drop-watch`, `clz-import`) with `historicalAccuracy`, `latencyHours`, `authority`, `active`.
4. **Quality machinery** (pipeline) — novelty score + quarantine in `@vip/signals` (duplicates/noise labeled, not deleted). Prediction ledger exists for later calibration.

## Path A — Evaluate quality from the IQVault UI (no code)

1. Open http://127.0.0.1:3000 → **Signals**.
2. Confirm the page shows a **Source:** line (`job_feed · pokemon-drops · …`). If it says seed-only, run:
   ```bash
   npm run job:pokemon-drops
   ```
   then refresh Signals.
3. For each signal, read:
   - **quarantineStatus** — `active` = passed novelty; `quarantined` = recycled/noise (still visible on purpose).
   - **signalType** — `retail` / `news` / etc. (mapped from source authority in the pipeline).
   - **body / date** — what the adapter claimed.
4. Open **Sources** and note which adapters VIP *claims* to use. Cross-check names against the Signals bodies (e.g. retail restock vs CLZ import). Thin Sources list ≠ full `DEFAULT_SOURCES` yet — treat Sources as documentation until the API reads the package registry.

**Rule of thumb:** High quarantine rate + low novelty = source is noisy or you’re re-running the same stub observations. Prefer sources with higher `historicalAccuracy` in the code registry when you add real adapters.

## Path B — Adjust which sources feed the pipeline (code / config)

Until a Sources editor ships, change sources here:

1. Edit [`packages/signals/src/registry.ts`](../../packages/signals/src/registry.ts):
   - set `active: false` to drop a source from the default registry
   - tune `historicalAccuracy` / `latencyHours` / `terms`
2. Edit observation stubs / adapters in [`services/jobs/src/pokemon-drops.ts`](../../services/jobs/src/pokemon-drops.ts) (`fetchPokemonDropObservations`) so only the sources you want emit `IngestEvent`s (`sourceId` must match registry ids).
3. Re-run:
   ```bash
   npm run job:pokemon-drops
   ```
4. VIP API reads `services/jobs/.state/signals-feed.json` on `GET /api/signals` — refresh IQVault **Signals**.

Optional: set `VIP_SIGNALS_FEED` to an absolute path if jobs and API disagree on the feed file location.

## Path C — Score contribution per source (operator checklist)

For each source id, track across runs:

| Check | Where |
|-------|--------|
| How many NormalizedSignals cite it? | Feed JSON / Signals list (`signalType` + body) |
| Quarantine rate | Count `quarantined` vs `active` after a job |
| Novelty | `noveltyScore` on feed rows (0–1) |
| Stated reliability | `historicalAccuracy` in `registry.ts` |
| Latency vs decision need | `latencyHours` vs “do I need this for a sell call today?” |

Do **not** treat catalog prices or restock rumors as verified comps. Quarantined ≠ deleted — keep for audit.

## Gaps (so you don’t hunt for missing buttons)

- No UI slider to weight sources.
- VIP `/api/sources` is not yet wired to `SourceRegistry` / `DEFAULT_SOURCES`.
- Prediction ledger / Brier scores are not shown on the Signals page yet.
- Adjusting sources for *comics* CLZ vs *Pokémon* retail is still adapter-by-adapter work.

When you want product work here: open Orchestr8 Console → Build Spec Council and ask for “Sources registry API + IQVault Sources editor with active toggle and contribution stats.”
