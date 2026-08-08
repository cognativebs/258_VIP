# Build Spec — Signals v1 — News Adapter + Sources API + Evidence Bridge

**ID:** `signals-v1-news-adapter-sources-api-evidence-bridge`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260802T222954_54326a31`  
**Generated:** 2026-08-02 22:29 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

Replace stub observations in fetchPokemonDropObservations with a real RSS adapter behind registry id 'pokemon-news-rss'; wire GET /api/sources to @vip/signals SourceRegistry with mutable active toggle + persistence; feed signals into @vip/decision-engine as evidence refs (not prose-only). Every derived field carries provenance. Decisions emit ranges + supporting + opposing evidence, never a lone point price.

## Constraints

- TypeScript + zod schemas first; apps consume packages, never reach DB ad hoc
- Raw fetch bytes/text stored as immutable snapshots; processed signals regenerable from snapshot alone
- Adapter swappable: feed URL in env/config only — no hardcoded host in core pipeline logic
- Named constant SIGNALS_MIN_CONFIDENCE (e.g. 0.3) in packages/signals/src/adapter.ts; never a magic number
- snapshotPath must be relative (e.g. raw_snapshots/signals/<date>-<id>.xml) — never an absolute fs path
- sources-state.json lives in services/jobs/data/ (gitignored via services/jobs/.gitignore or root .gitignore pattern data/*.json); document the gitignore rule in file_plan notes
- On missing state file: treat all DEFAULT_SOURCES as active (safe default); log warn, do not throw
- On HTTP 429 / 5xx from feed: log warn, skip adapter run, do not quarantine existing signals, do not throw
- On corrupt/unparseable snapshot during replay: log error, skip item, do not crash pipeline
- Every derived field: source, method, model/rule version (signals@<semver>), confidence, verification_status; inferred != verified
- No fake precision: valuations are ranges + evidence count + recency + confidence
- Every recommendation path emits both supporting AND opposing evidence (existing engine rule — do not remove)
- No sentiment/social scrapers; no community data sources
- No drive-by refactors outside stated file plan
- High-dollar Sell paths remain critic-eligible; this spec is infrastructure + evidence, not auto-trading
- Preserve terms: asset, holding, priced_unit, sale, market_value, collection_hunt, external_id, assumed_grade

## Contracts / schemas first (DoD)

- `packages/signals/src/schemas.ts` — Add/extend zod schemas: RawSnapshot (id, fetchedAt, sourceId, snapshotPath [relative string], contentType, byteLength), AdapterResult (rawSnapshot: RawSnapshot, items: RawFeedItem[]), RawFeedItem (guid, title, link, pubDate, rawXml). Export SIGNALS_MIN_CONFIDENCE = 0.3 as named const. Extend NormalizedSignal provenance field to include ruleVersion: string.
- `packages/signals/src/adapter.ts` — Define INewsAdapter interface: { id: string; fetch(): Promise<AdapterResult> }. Export createRssAdapter(config: { id: string; feedUrl: string; rateLimit?: number }): INewsAdapter. feedUrl sourced from env NEWS_FEED_URL_POKEMON or config only — never hardcoded host in core logic.
- `packages/signals/src/registry.ts` — Extend SourceRegistry / SourceEntry to include active: boolean (default true). Add loadState(statePath: string): Promise<void> that reads sources-state.json; on ENOENT logs warn and treats all sources active. Add persistState(statePath: string): Promise<void>. Export getActiveSources(): SourceEntry[].
- `packages/signals/src/pipeline.ts` — Extend pipeline to accept AdapterResult; skip sources where active===false. Attach provenance (sourceId, method:'rss-parse', ruleVersion:'signals@<pkg.version>', confidence, verification_status:'unverified') to every NormalizedSignal. Quarantine malformed items (missing guid/title/pubDate) with quarantineStatus='rejected'; never silently mark as verified.
- `packages/decision-engine/src/evidence-bridge.ts` — New file. Export signalsToEvidenceRefs(signals: NormalizedSignal[]): EvidenceRef[] mapping each active (non-quarantined) signal to an EvidenceRef with id, sourceId, signalDate, confidence, verificationStatus. Import from @vip/evidence markObserved/markInferred as appropriate.
- `packages/decision-engine/src/recommend.ts` — Modify recommend() to accept optional evidenceRefs: EvidenceRef[]. Inject signal-derived refs into the evidence pool. Assert both supporting and opposing evidence present before emitting recommendation; if opposing is absent, add a low-confidence 'no opposing signal found' placeholder rather than omitting the field. Output remains ranges + evidenceCount + recency + confidence — never a lone point price.
- `services/api/src/routes/sources.ts` — New file. GET /api/sources: call getActiveSources() + stats (signalCount, quarantineRate, evidenceCount) from @vip/signals; return typed SourcesResponse. PATCH /api/sources/:id/toggle: flip active, call persistState(). No hardcoded label arrays.

## File plan

| Path | Action | Notes |
|---|---|---|
| `packages/signals/src/schemas.ts` | modify | Add RawSnapshot, AdapterResult, RawFeedItem zod schemas. Export SIGNALS_MIN_CONFIDENCE = 0.3 named const. Extend NormalizedSignal provenance with ruleVersion. |
| `packages/signals/src/adapter.ts` | create | INewsAdapter interface + createRssAdapter factory. feedUrl from env NEWS_FEED_URL_POKEMON. Rate-limit: min 60s between fetches (configurable). On 429/5xx: log warn, return empty AdapterResult (do not throw). Write raw XML bytes to raw_snapshots/signals/<YYYY-MM-DD>-<sourceId>.xml (relative path only; caller resolves absolute). |
| `packages/signals/src/registry.ts` | modify | Add active field to SourceEntry. loadState / persistState using sources-state.json path passed by caller. On missing file: warn + default all active. getActiveSources() filters by active===true. |
| `packages/signals/src/pipeline.ts` | modify | Accept AdapterResult. Skip inactive sources. Attach full provenance. Quarantine malformed items. On corrupt snapshot during replay: log error, skip item, continue. |
| `packages/signals/src/index.ts` | modify | Re-export adapter, registry state helpers, SIGNALS_MIN_CONFIDENCE, new schemas. |
| `packages/decision-engine/src/evidence-bridge.ts` | create | signalsToEvidenceRefs(). Uses markObserved from @vip/evidence for verified signals, markInferred for unverified. Returns EvidenceRef[]. |
| `packages/decision-engine/src/recommend.ts` | modify | Accept evidenceRefs param. Merge signal refs into evidence pool. Enforce supporting+opposing evidence rule. Output ranges only. |
| `packages/decision-engine/src/index.ts` | modify | Re-export evidence-bridge. |
| `services/jobs/src/pokemon-drops.ts` | modify | Replace fabricated observations in fetchPokemonDropObservations with createRssAdapter call. Load registry state from services/jobs/data/sources-state.json (relative to job cwd). Skip if source inactive. Write snapshot. Normalize via pipeline. Keep existing signals-feed.json write path intact. |
| `services/jobs/data/sources-state.json` | create | Initial state file: [{"id":"pokemon-news-rss","active":true}]. Add 'services/jobs/data/*.json' to services/jobs/.gitignore (or root .gitignore) — document this in PR. File is mutable runtime state, not source truth; DEFAULT_SOURCES in registry.ts remains the schema truth. |
| `services/jobs/.gitignore` | modify | Add 'data/*.json' to gitignore sources-state.json and any future state files. If root .gitignore already covers this pattern, leave this file and note assumption. |
| `services/api/src/routes/sources.ts` | create | GET /api/sources returns SourcesResponse from @vip/signals registry (not hardcoded labels). PATCH /api/sources/:id/toggle persists via persistState(). Stats: signalCount from signals-feed.json count where sourceId matches; quarantineRate = quarantined/total; evidenceCount from evidence-bridge if cheap, else 0 with note. |
| `services/api/src/lib/signalsFeed.ts` | leave | Existing GET /api/signals wire unchanged. Confirm it still prefers job feed over seeds. |
| `services/api/src/app.ts` | modify | Mount sources router at /api/sources. |
| `apps/iqvault-web/src/app/signals/page.tsx` | modify | Extend only to show quarantine badge and feed-vs-seed label per signal. No new data fetching beyond existing /api/signals response fields. Do not add Sources editor UI in this spec. |
| `packages/signals/src/__tests__/adapter.test.ts` | create | Unit tests AT-01, AT-02, AT-03, AT-08 using fixture RSS XML (no live network). Test 429 handling, corrupt snapshot replay, missing state file. |
| `packages/signals/src/__tests__/registry.test.ts` | create | Unit tests AT-03, AT-05 — inactive source skip, state persistence across simulated restart. |
| `packages/decision-engine/src/__tests__/evidence-bridge.test.ts` | create | Unit tests AT-07 — fixture signals produce evidence refs; recommend() includes signal ref + opposing evidence; never lone point price. |
| `services/api/src/__tests__/sources.test.ts` | create | Integration tests AT-04, AT-05, AT-06 — GET /api/sources from registry, PATCH toggle persists, GET /api/signals still prefers feed. |

## Acceptance tests

1. AT-01: Given a fixture RSS XML file (no live network), createRssAdapter processes it and returns >=1 NormalizedSignal; each signal has provenance fields (sourceId, method='rss-parse', ruleVersion matching 'signals@x.y.z' pattern, confidence>=SIGNALS_MIN_CONFIDENCE, verification_status='unverified'); raw snapshot file exists at the relative snapshotPath recorded in RawSnapshot.
2. AT-02: Re-running the pipeline from the saved snapshot file alone (adapter.replayFromSnapshot or equivalent) regenerates equivalent NormalizedSignals without any live network call; signal ids and provenance match the original run.
3. AT-03: When a source has active=false in registry state, the pipeline/job skips it entirely; no signals are emitted for that sourceId and no snapshot is written.
4. AT-04: GET /api/sources returns an array of source entries sourced from @vip/signals DEFAULT_SOURCES + registry state — not a hardcoded label array in the API layer; each entry includes id, label, active, signalCount, quarantineRate fields.
5. AT-05: PATCH /api/sources/pokemon-news-rss/toggle (or equivalent mutation endpoint) flips active to false; a subsequent GET /api/sources reflects active=false; simulating process restart (reload sources-state.json from disk) still shows active=false — persistence survives restart.
6. AT-06: GET /api/signals returns signals where feed items cite sourceId='pokemon-news-rss' (not fabricated stub values); the response source field reflects the job feed, not seeds-only fallback.
7. AT-07: Given a fixture holding and a set of fixture NormalizedSignals (>=1 non-quarantined), recommend() from @vip/decision-engine returns a recommendation that (a) includes at least one evidenceId derived from a signal, (b) includes both supporting and opposing evidence entries (opposing may be a low-confidence placeholder if no real opposing signal exists but must not be absent), (c) expresses confidence as a numeric range or bounded value — never a single point price presented as fact, and (d) includes a reasons array with >=1 entry citing signal provenance.
8. AT-08: A malformed RSS item (missing guid, or pubDate unparseable) is assigned quarantineStatus='rejected' and is NOT emitted as a verified NormalizedSignal; the pipeline continues processing remaining valid items without throwing.
9. AT-09: On HTTP 429 from the feed URL (simulated via mock), the adapter logs a warning and returns an empty AdapterResult; no exception propagates to the job runner; existing signals-feed.json is not corrupted.
10. AT-10: On missing sources-state.json at startup, the registry logs a warning and treats all DEFAULT_SOURCES as active (safe default); no exception is thrown and the pipeline runs normally.
11. AT-11: On a corrupt/unparseable snapshot file during replay, the pipeline logs an error, skips the corrupt item, and continues processing remaining items without crashing.
12. AT-12: No new package dependency introduces a hardcoded feed host in core pipeline logic (grep packages/signals/src for literal pokemon.com or similar hostnames outside config/env references); if a new dep is added, an ADR note is included in the PR.

## Risks

- RSS feed ToS / rate-limit: mitigated by 60s minimum interval, env-configurable URL, and 429 graceful skip
- sources-state.json gitignore gap: if not gitignored, secrets-free but noisy diffs; mitigated by explicit .gitignore entry in file_plan
- Opposing evidence placeholder may feel artificial: acceptable for v1 infrastructure; real opposing signals come from future adapters
- snapshotPath absolute vs relative: enforced by zod schema (z.string().regex(/^[^/]/)) — absolute paths fail validation
- Decision-engine recommend() signature change is additive (optional param) — should not break existing callers; verify no callers pass positional args
- services/jobs/data/ directory may not exist: adapter must mkdir -p before writing snapshot
- Assumption: packages/signals/src/registry.ts and pipeline.ts exist with SourceRegistry and DEFAULT_SOURCES exports (confirmed via backlog.md section D and git_diff context); exact internal shape may differ — Cursor must read files before modifying

## Out of scope

- Community sentiment / Discord / Reddit / Twitter scrapers
- Multi-feed fan-out beyond one news adapter (retail stub left as stub)
- Full prediction ledger / Brier UI on Signals page
- Sources editor UI beyond thin quarantine/feed-vs-seed label on existing Signals page
- Binder writes, Bloomberg unified grid, mobile/VaultOS
- New Orchestr8 councils or agent roles
- Changing ADR 0003 autonomy model

## Cursor prompt (paste as-is)

```
## Signals v1 — News Adapter + Sources API + Evidence Bridge

### Goal
Replace stub observations in services/jobs/src/pokemon-drops.ts fetchPokemonDropObservations with a real RSS adapter. Wire GET /api/sources to @vip/signals SourceRegistry. Feed signals into @vip/decision-engine as evidence refs. Every derived field carries provenance. Decisions emit ranges + supporting + opposing evidence.

### Hard constraints (enforce throughout)
- TypeScript + zod schemas first; implement schemas before any logic
- Named constant SIGNALS_MIN_CONFIDENCE = 0.3 exported from packages/signals/src/schemas.ts
- snapshotPath is always relative (e.g. raw_snapshots/signals/2026-01-01-pokemon-news-rss.xml); zod validates no leading slash
- Feed URL in env NEWS_FEED_URL_POKEMON only — no hardcoded hostname in core pipeline
- sources-state.json lives in services/jobs/data/; add 'data/*.json' to services/jobs/.gitignore
- On missing state file: warn + default all sources active (no throw)
- On HTTP 429/5xx: warn + return empty AdapterResult (no throw, no corrupt feed file)
- On corrupt snapshot during replay: log error, skip item, continue
- Every recommendation: supporting AND opposing evidence required; ranges not point prices
- No sentiment/social sources; no drive-by refactors

### File plan (read each file before modifying)
1. packages/signals/src/schemas.ts — MODIFY: add RawSnapshot, AdapterResult, RawFeedItem zod schemas; export SIGNALS_MIN_CONFIDENCE=0.3; extend NormalizedSignal provenance with ruleVersion
2. packages/signals/src/adapter.ts — CREATE: INewsAdapter interface; createRssAdapter(config) factory; rate-limit 60s min; 429/5xx graceful skip; write snapshot to relative path
3. packages/signals/src/registry.ts — MODIFY: add active:boolean to SourceEntry; loadState/persistState(statePath); getActiveSources(); missing file = warn+default active
4. packages/signals/src/pipeline.ts — MODIFY: accept AdapterResult; skip inactive sources; attach full provenance; quarantine malformed items
5. packages/signals/src/index.ts — MODIFY: re-export new symbols
6. packages/decision-engine/src/evidence-bridge.ts — CREATE: signalsToEvidenceRefs(); markObserved/markInferred from @vip/evidence
7. packages/decision-engine/src/recommend.ts — MODIFY: accept optional evidenceRefs param; merge into pool; enforce supporting+opposing; ranges only
8. packages/decision-engine/src/index.ts — MODIFY: re-export evidence-bridge
9. services/jobs/src/pokemon-drops.ts — MODIFY: replace fabricated observations with createRssAdapter; load state from services/jobs/data/sources-state.json; skip inactive; keep signals-feed.json write path
10. services/jobs/data/sources-state.json — CREATE: [{"id":"pokemon-news-rss","active":true}]
11. services/jobs/.gitignore — MODIFY: add data/*.json
12. services/api/src/routes/sources.ts — CREATE: GET /api/sources from registry; PATCH /api/sources/:id/toggle with persistState
13. services/api/src/app.ts — MODIFY: mount /api/sources router
14. apps/iqvault-web/src/app/signals/page.tsx — MODIFY: show quarantine badge + feed-vs-seed label only; no new fetches

### Tests to write
AT-01: Fixture RSS XML -> >=1 NormalizedSignal with full provenance; snapshot file at relative path
AT-02: Replay from snapshot alone regenerates equivalent signals (no network)
AT-03: active=false source skipped; no signals emitted, no snapshot written
AT-04: GET /api/sources returns registry entries (not hardcoded labels); includes signalCount, quarantineRate
AT-05: PATCH toggle persists; survives simulated restart (reload from disk)
AT-06: GET /api/signals feed items cite sourceId=pokemon-news-rss
AT-07: recommend() with fixture signals returns: >=1 signal-derived evidenceId, supporting+opposing evidence, confidence as range, reasons citing provenance; never lone point price
AT-08: Malformed RSS item -> quarantineStatus=rejected; pipeline continues
AT-09: Mock 429 -> empty AdapterResult, no throw, signals-feed.json intact
AT-10: Missing sources-state.json -> warn + all sources active, no throw
AT-11: Corrupt snapshot during replay -> log error, skip item, continue
AT-12: No hardcoded feed hostname in packages/signals/src (grep check)

### Provenance rule
Every NormalizedSignal: { sourceId, method:'rss-parse', ruleVersion:'signals@<version>', confidence, verification_status:'unverified' }. Inferred != verified. No fake precision.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.91
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
