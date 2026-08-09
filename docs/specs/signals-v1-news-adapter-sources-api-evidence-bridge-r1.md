# Build Spec — Signals v1 — News Adapter + Sources API + Evidence Bridge (Revision 1)

**ID:** `signals-v1-news-adapter-sources-api-evidence-bridge-r1`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260803T003332_87e89c69`  
**Generated:** 2026-08-03 00:33 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

Replace stub observations in fetchPokemonDropObservations with a real RSS adapter behind registry id 'pokemon-news-rss'. Wire GET /api/sources to @vip/signals SourceRegistry with mutable active toggle + persistence. Feed signals into @vip/decision-engine as evidence refs. Every derived field carries provenance. Ends in Buy/Hold/Grade/Sell/Lot/Pass decisions with confidence + reasons + evidence ids.

## Constraints

- TypeScript + zod contracts first; apps consume packages, never reach DB directly
- Preserve terms: asset, holding, priced_unit, sale, market_value, collection_hunt, external_id, assumed_grade (inferred · unverified)
- No fake precision — valuations are ranges + evidence count + recency + confidence
- Raw fetch bytes/text are immutable snapshots; processed signals regenerable from snapshot
- Adapter is swappable: no core pipeline logic hardcodes one RSS host beyond config/env
- No community-sentiment / social scrapers (Discord, Reddit, Twitter) in this slice
- Inferred != verified; quarantineStatus must be set on malformed/unverified items
- ASSUMPTION: services/api route structure unknown — Cursor MUST read services/api/src/lib/signalsFeed.ts and grep for existing route files before creating any new route files
- ASSUMPTION: XML parser choice unknown — Cursor MUST check services/api/package.json and packages/signals/package.json for existing XML/RSS libs before adding a new dependency
- High-dollar Sell paths remain critic-eligible; this spec is infrastructure + evidence, not auto-trading
- Autonomy 0 (ADR 0003): Cursor builds; Orchestr8 authors only

## Contracts / schemas first (DoD)

- `packages/signals/src/schemas/rss-adapter.ts` — New zod schemas: RawRssSnapshot (url, fetchedAt, rawXml, snapshotPath, byteLength), RssAdapterConfig (feedUrl, sourceId, rateLimit), NormalizedSignalFromRss extending existing NormalizedSignal with provenance fields (source, method, modelVersion 'signals@rss-v1', confidence, verificationStatus: 'inferred'|'verified'|'quarantined'). Export all.
- `packages/signals/src/schemas/source-registry.ts` — Extend or create SourceRegistryEntry zod schema to include: active (boolean), stats stub (signalCount, quarantineRate, evidenceCount — all optional numbers), persistedAt (optional ISO string). Export SourceRegistryEntrySchema and SourceRegistryPersisted.
- `packages/signals/src/adapters/rss-adapter.ts` — New file. RssAdapter class implementing AdapterInterface (if exists) or a typed interface: fetchAndSnapshot(config) -> Promise<RawRssSnapshot>; parseSnapshot(snapshot) -> NormalizedSignal[]. Quarantines malformed items. Rate-limit via config. No hardcoded host.
- `packages/signals/src/registry/source-persistence.ts` — New file. Read/write SourceRegistry active state to a JSON file (default: services/api/data/sources-state.json or packages/signals/data/sources-state.json — Cursor picks path consistent with existing VIP patterns). Functions: loadPersistedState(), savePersistedState(state). Survives process restart.
- `packages/decision-engine/src/evidence-bridge.ts` — New or extend existing file. Function signalsToEvidenceRefs(signals: NormalizedSignal[]): EvidenceRef[] — maps signal ids to evidence refs with provenance. Decision engine consumes these refs, not raw prose. Must include both supporting and opposing refs when available.

## File plan

| Path | Action | Notes |
|---|---|---|
| `packages/signals/src/schemas/rss-adapter.ts` | create | Zod schemas for RawRssSnapshot, RssAdapterConfig, NormalizedSignalFromRss. Contracts first. |
| `packages/signals/src/schemas/source-registry.ts` | create | Extend SourceRegistryEntry with active, stats, persistedAt. Check if schema already exists in packages/signals/src before creating. |
| `packages/signals/src/adapters/rss-adapter.ts` | create | RssAdapter: fetchAndSnapshot + parseSnapshot. Quarantine malformed. Rate-limit. Swappable (feedUrl from config/env, not hardcoded). |
| `packages/signals/src/registry/source-persistence.ts` | create | JSON file persistence for active toggle. Cursor must check existing VIP data-file patterns (e.g. signals-feed.json location) to pick consistent path. |
| `packages/signals/src/index.ts` | modify | Export RssAdapter, RssAdapterConfig, RawRssSnapshot, NormalizedSignalFromRss, SourceRegistryEntry, loadPersistedState, savePersistedState. |
| `packages/decision-engine/src/evidence-bridge.ts` | create | signalsToEvidenceRefs(). Check packages/decision-engine/src for existing evidence wiring before creating; extend if pattern exists. |
| `packages/decision-engine/src/index.ts` | modify | Export signalsToEvidenceRefs. Ensure recommend() paths accept evidenceIds from signals. |
| `services/jobs/src/pokemon-drops.ts` | modify | Replace fabricated observations in fetchPokemonDropObservations with RssAdapter.fetchAndSnapshot + parseSnapshot. Keep job -> signals-feed.json -> GET /api/signals wire intact. Skip inactive sources. Store raw snapshot to disk before processing. |
| `services/api/src/lib/signalsFeed.ts` | leave | READ THIS FILE FIRST before touching any route. Understand existing GET /api/signals wire. Do not break job_feed preference over seeds. |
| `services/api/src/lib/sourcesRegistry.ts` | create | Server-side lib: loadSources() from @vip/signals SourceRegistry + merge persisted active state. updateSourceActive(id, active). Returns SourceRegistryEntry[]. ASSUMPTION: this lib does not yet exist — grep services/api/src/lib/ first. |
| `services/api/src/app/api/sources/route.ts` | create | CONDITIONAL: Before creating, Cursor MUST read services/api/src/lib/signalsFeed.ts and grep services/api/src for existing route patterns (pages/api vs app/api). Create GET /api/sources returning SourceRegistryEntry[] from sourcesRegistry lib. Create PATCH /api/sources/[id]/route.ts for active toggle. If route structure is pages/api, create pages/api/sources.ts instead. Document chosen pattern in a comment. |
| `services/api/src/app/api/sources/[id]/route.ts` | create | CONDITIONAL on App Router confirmation. PATCH handler: body {active: boolean}, persists via savePersistedState, returns updated entry. If pages/api pattern, fold into pages/api/sources/[id].ts. |
| `apps/iqvault-web/src/app/signals/page.tsx` | modify | Extend only as needed: show quarantine label (feed vs seed, quarantineStatus). No new UI components beyond what already exists. Prefer API+adapter+bridge over polished editor. |
| `packages/signals/src/adapters/__tests__/rss-adapter.test.ts` | create | Unit tests: fixture RSS XML -> NormalizedSignal with provenance; snapshot retained; malformed item quarantined; empty RSS returns []; duplicate guids deduplicated. |
| `packages/signals/src/registry/__tests__/source-persistence.test.ts` | create | Unit tests: toggle active persists; survives reload; inactive source skipped by pipeline. |
| `packages/decision-engine/src/__tests__/evidence-bridge.test.ts` | create | Unit tests: signals -> evidenceRefs; zero signals -> empty refs (decision still emits, no crash); supporting + opposing refs present. |
| `services/api/package.json` | leave | READ BEFORE adding XML parser. Check for existing xml2js, fast-xml-parser, or similar. Add only if absent; document choice in rss-adapter.ts comment. |
| `packages/signals/package.json` | leave | READ BEFORE adding XML parser. Prefer reusing existing dep over adding new one. |

## Acceptance tests

1. AT-01 [Adapter fetch]: Given a fixture RSS/XML file (or recorded snapshot), RssAdapter.parseSnapshot() produces >= 1 NormalizedSignal; each signal has provenance fields (source='pokemon-news-rss', method='rss-parse', modelVersion='signals@rss-v1', verificationStatus='inferred'); raw snapshot file is written to disk and retained.
2. AT-02 [Snapshot replay]: Re-running parseSnapshot() from the saved raw snapshot file (no live network) produces equivalent NormalizedSignals — same ids, same provenance. Test must not make HTTP calls.
3. AT-03 [Inactive source skipped]: When SourceRegistry marks 'pokemon-news-rss' active=false, the job pipeline skips the adapter fetch entirely; signals-feed.json is not updated with new items from that source.
4. AT-04 [GET /api/sources]: Response contains registry entries sourced from @vip/signals SourceRegistry (not hardcoded label strings); each entry includes id, label, active, and at least one stats field (signalCount or quarantineRate).
5. AT-05 [Toggle persistence]: PATCH /api/sources/{id} with {active: false} persists the state to the JSON file; after simulated process restart (reload from file), GET /api/sources returns active=false for that id.
6. AT-06 [GET /api/signals wire]: GET /api/signals still returns job_feed signals when signals-feed.json is present; feed items include sourceId='pokemon-news-rss'; source preference (job_feed > seeds) is unchanged.
7. AT-07 [Evidence bridge]: Decision-engine recommendation for a fixture holding with >= 1 signal present includes at least one signal-derived evidenceId in the output; output also includes at least one opposing evidence ref; output is a range (low/high or confidence interval), never a single point price.
8. AT-08 [Quarantine path]: A malformed RSS item (missing required fields or invalid XML) is assigned quarantineStatus='quarantined' or 'rejected'; it does NOT appear as a verified signal; it does NOT silently pass through as a clean fact.
9. AT-09 [Adapter swappable]: No file in packages/signals/src/pipeline or services/jobs hardcodes a specific RSS hostname beyond config/env; changing RSS_FEED_URL env var routes to a different feed without code changes.
10. AT-10 [Empty RSS]: When the RSS feed returns 0 items (valid but empty feed), parseSnapshot() returns [] without throwing; the job completes without error; signals-feed.json is not corrupted.
11. AT-11 [Duplicate signals]: When the same RSS item guid appears twice in one snapshot (or across two rapid fetches), the pipeline deduplicates and emits only one NormalizedSignal per guid.
12. AT-12 [Zero-signal decision]: When no active signals exist (all sources inactive or feed empty), the decision-engine still returns a valid recommendation object (action + confidence + reasons); it does not crash or return null; it notes 'insufficient signal evidence' in reasons.
13. AT-13 [No new dep without note]: If a new XML parser package is added to package.json, a comment in rss-adapter.ts documents why the existing packages did not suffice (or confirms none existed). No new dep violates adapter-swappable design.

## Risks

- RISK-01 [Route structure unknown]: services/api may use pages/api or app/api — Cursor must grep before creating route files. Mitigation: conditional file_plan note; Cursor documents chosen pattern in a comment.
- RISK-02 [XML parser dep]: No XML parser may exist in services/api or packages/signals. Mitigation: Cursor reads both package.json files first; adds minimal dep only if absent; documents choice.
- RISK-03 [SourceRegistry shape unknown]: packages/signals SourceRegistry and DEFAULT_SOURCES internal shape not confirmed from tools. Mitigation: Cursor reads packages/signals/src/index.ts and registry files before writing sourcesRegistry.ts lib.
- RISK-04 [Decision-engine evidence interface]: packages/decision-engine evidenceIds input shape not confirmed. Mitigation: Cursor reads packages/decision-engine/src before writing evidence-bridge.ts; extends existing pattern rather than inventing new one.
- RISK-05 [Snapshot storage path]: Consistent path for raw snapshots and sources-state.json not confirmed. Mitigation: Cursor reads signals-feed.json location in services/jobs to pick consistent sibling path.
- RISK-06 [RSS ToS / rate-limit]: Live RSS fetch in tests would be flaky and may violate ToS. Mitigation: AT-01 and AT-02 use fixture/recorded XML; live fetch only in job runtime behind env var.
- RISK-07 [Scope creep]: Sources editor UI is optional; if cheap include thin toggle, else defer. Mitigation: file_plan marks signals page as modify-only; no new UI components beyond existing patterns.

## Out of scope

- Community sentiment / Discord / Reddit / Twitter scrapers
- Multi-feed fan-out beyond one news adapter (retail stub left as stub)
- Full prediction ledger / Brier UI on Signals page (may stub types only)
- Binder writes, Bloomberg unified grid, mobile/VaultOS
- New Orchestr8 councils or agent roles
- Changing ADR 0003 autonomy
- Full Sources editor UI (defer if not cheap after API + toggle + stats are done)

## Cursor prompt (paste as-is)

```
## Signals v1 — News Adapter + Sources API + Evidence Bridge

### Goal
Replace stub observations in `services/jobs/src/pokemon-drops.ts` `fetchPokemonDropObservations` with a real RSS adapter behind registry id `pokemon-news-rss`. Wire `GET /api/sources` to `@vip/signals` SourceRegistry with mutable active toggle + JSON-file persistence. Feed signals into `@vip/decision-engine` as evidence refs (not prose-only). Every derived field carries provenance. Decisions end in Buy/Hold/Grade/Sell/Lot/Pass with confidence + reasons + evidence ids.

### CRITICAL: Read before creating any files
1. Read `services/api/src/lib/signalsFeed.ts` to understand existing GET /api/signals wire and route structure.
2. Grep `services/api/src` for existing route files (pages/api vs app/api pattern). Create sources route only after confirming the pattern.
3. Read `services/api/package.json` AND `packages/signals/package.json` for existing XML/RSS parser deps before adding any new package.
4. Read `packages/signals/src/index.ts` and registry files to understand SourceRegistry and DEFAULT_SOURCES shape.
5. Read `packages/decision-engine/src` to understand existing evidenceIds interface before writing evidence-bridge.ts.
6. Read `services/jobs/src/pokemon-drops.ts` to understand the signals-feed.json write path.

### Contracts first (zod schemas before implementation)

~~~
packages/signals/src/schemas/rss-adapter.ts
  - RawRssSnapshot: { url, fetchedAt, rawXml, snapshotPath, byteLength }
  - RssAdapterConfig: { feedUrl, sourceId, rateLimitMs }
  - NormalizedSignalFromRss: extends NormalizedSignal + provenance
    { source, method, modelVersion: 'signals@rss-v1', confidence, verificationStatus }

packages/signals/src/schemas/source-registry.ts
  - SourceRegistryEntry: { id, label, active, stats?: { signalCount?, quarantineRate?, evidenceCount? }, persistedAt? }

packages/signals/src/adapters/rss-adapter.ts
  - RssAdapter class: fetchAndSnapshot(config) -> Promise<RawRssSnapshot>
  - parseSnapshot(snapshot) -> NormalizedSignal[]
  - Quarantine malformed items (quarantineStatus = 'quarantined')
  - Rate-limit via config.rateLimitMs
  - feedUrl from config/env only — no hardcoded hostname

packages/signals/src/registry/source-persistence.ts
  - loadPersistedState() -> Record<id, {active, persistedAt}>
  - savePersistedState(state) -> void
  - JSON file path: sibling to signals-feed.json (confirm by reading job output path)

packages/decision-engine/src/evidence-bridge.ts
  - signalsToEvidenceRefs(signals: NormalizedSignal[]): EvidenceRef[]
  - Extend existing evidenceIds pattern; do not invent new interface
~~~

### File plan
- CREATE packages/signals/src/schemas/rss-adapter.ts
- CREATE packages/signals/src/schemas/source-registry.ts
- CREATE packages/signals/src/adapters/rss-adapter.ts
- CREATE packages/signals/src/registry/source-persistence.ts
- MODIFY packages/signals/src/index.ts — export new schemas + adapter + persistence
- CREATE packages/decision-engine/src/evidence-bridge.ts
- MODIFY packages/decision-engine/src/index.ts — export signalsToEvidenceRefs
- MODIFY services/jobs/src/pokemon-drops.ts — replace fabricated observations with RssAdapter; skip inactive sources; write raw snapshot before processing
- LEAVE services/api/src/lib/signalsFeed.ts — read only; do not break job_feed preference
- CREATE services/api/src/lib/sourcesRegistry.ts — loadSources() + updateSourceActive()
- CREATE GET /api/sources route (path determined after reading existing route structure)
- CREATE PATCH /api/sources/[id] route (same pattern)
- MODIFY apps/iqvault-web/src/app/signals/page.tsx — extend only to show quarantine/feed vs seed label
- CREATE packages/signals/src/adapters/__tests__/rss-adapter.test.ts
- CREATE packages/signals/src/registry/__tests__/source-persistence.test.ts
- CREATE packages/decision-engine/src/__tests__/evidence-bridge.test.ts

### Acceptance tests (all must pass)
AT-01: Fixture RSS XML -> parseSnapshot() -> >=1 NormalizedSignal with provenance (source, method, modelVersion='signals@rss-v1', verificationStatus='inferred'); raw snapshot file retained on disk.
AT-02: Re-running parseSnapshot() from saved snapshot (no HTTP) produces equivalent signals.
AT-03: Source active=false -> pipeline skips adapter fetch; signals-feed.json not updated from that source.
AT-04: GET /api/sources returns entries from @vip/signals SourceRegistry (not hardcoded strings); includes id, label, active, stats.
AT-05: PATCH /api/sources/{id} {active:false} persists; after reload from file, GET returns active=false.
AT-06: GET /api/signals returns job_feed signals; items include sourceId='pokemon-news-rss'; job_feed > seeds preference unchanged.
AT-07: Decision-engine for fixture holding with signals -> output includes >=1 signal-derived evidenceId + >=1 opposing ref; output is range not single point.
AT-08: Malformed RSS item -> quarantineStatus='quarantined'; not emitted as verified signal.
AT-09: No hardcoded RSS hostname in pipeline/job files; feedUrl from env only.
AT-10: Empty RSS feed (0 items) -> parseSnapshot() returns []; job completes without error; signals-feed.json not corrupted.
AT-11: Duplicate RSS guid in one snapshot -> pipeline deduplicates; only one NormalizedSignal per guid emitted.
AT-12: Zero active signals -> decision-engine returns valid recommendation (action+confidence+reasons); does not crash; notes insufficient evidence.
AT-13: If new XML parser added, comment in rss-adapter.ts documents why existing packages insufficient.

### Engineering rules
- TypeScript + zod schemas first, then implementation, then tests
- Provenance on every derived field; inferred != verified
- No fake precision; ranges not single points
- Raw snapshots immutable; regenerable from snapshot alone
- Adapter swappable; feedUrl from config/env
- No social/sentiment scrapers
- Preserve terms: asset, holding, priced_unit, sale, market_value, collection_hunt, external_id, assumed_grade
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.907
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
