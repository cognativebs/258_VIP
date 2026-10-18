# Build Spec — Orchestr8 Console — Analysis Tab Inventory Load + SSE Run Persistence (Backlog A Gate)

**ID:** `orchestr8-analysis-tab-gate-a`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260824T230055_507461a3`  
**Generated:** 2026-08-24 23:00 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

Close backlog gate A: (1) Analysis tab reliably loads inventory from Comics API :5200 with VIP :8787 fallback; (2) one complete SSE council run persists to the Runs panel and is operator-readable. No new verticals, no Viture/XR/Luma.

## Constraints

- Scope: apps/orchestr8-console and orchestr8/services only. No IQVault, no bridge, no new DB migrations.
- Types + zod schemas defined before any implementation file.
- SSE run persistence uses existing orchestr8/services/runstore.py — no new persistence layer.
- Provenance required on any derived/inferred field (source, method, confidence, verification_status).
- No fake precision: inventory counts are ranges+evidence, not silent point values.
- No TCGplayer public API. No Viture/XR/Luma Ultra references.
- Gateway proxy routes already exist at /api/comics/* and /api/vip/* — reuse, do not duplicate.
- AGENTS.md rule 3: raw API responses snapshotted before parse (console memory only — no file write needed for UI layer).
- All TS: zod for schemas, strict mode, no any casts without comment.

## Contracts / schemas first (DoD)

- `apps/orchestr8-console/src/types/analysis.ts` — Export InventoryPayload, InventoryItem, InventorySummary zod schemas + inferred TS types. InventorySource enum: 'comics_api' | 'vip_fallback' | 'unavailable'. InventoryPayload: { source: InventorySource; fetchedAt: string; totalHoldings: number; sampleItems: InventoryItem[]; provenance: InventoryProvenance }. InventoryProvenance: { method: string; confidence: number; verificationStatus: 'unverified' | 'partial' | 'verified' }.
- `apps/orchestr8-console/src/types/runs.ts` — Export RunRecord zod schema + type: { id: string; task: string; question: string; startedAt: string; completedAt: string | null; status: 'running' | 'complete' | 'failed'; summary: string; roles: RunRole[]; vetoed: boolean }. RunRole: { role: string; text: string; confidence: number }. Export RunListResponse: { runs: RunRecord[] }.

## File plan

| Path | Action | Notes |
|---|---|---|
| `apps/orchestr8-console/src/types/analysis.ts` | create | Zod schemas first. InventoryPayload, InventoryItem, InventorySummary, InventoryProvenance, InventorySource enum. |
| `apps/orchestr8-console/src/types/runs.ts` | create | Zod schemas first. RunRecord, RunRole, RunListResponse. Mirror shape from orchestr8/.runs/*.json. |
| `apps/orchestr8-console/src/lib/inventory-client.ts` | create | fetchInventory(): tries GET /api/comics/holdings (Comics :5200 proxy), on non-2xx or network error falls back to GET /api/vip/inventory. Returns InventoryPayload with source tag + provenance. Never throws — returns { source: 'unavailable' } on double failure. Validate response with zod before returning. |
| `apps/orchestr8-console/src/lib/runs-client.ts` | create | listRuns(): GET /v1/runs → RunListResponse (zod-validated). getRun(id): GET /v1/runs/:id → RunRecord. Both return typed results; throw typed errors on schema mismatch. |
| `apps/orchestr8-console/src/hooks/useInventory.ts` | create | React hook. Calls fetchInventory() on mount. Returns { data: InventoryPayload | null; loading: boolean; error: string | null; reload: () => void }. No polling — manual reload only. |
| `apps/orchestr8-console/src/hooks/useRuns.ts` | create | React hook. Calls listRuns() on mount + after SSE run completes (accepts optional refreshTrigger: number). Returns { runs: RunRecord[]; loading: boolean; error: string | null }. |
| `apps/orchestr8-console/src/components/AnalysisInventoryPanel.tsx` | create | Renders inventory summary: source badge (comics_api | vip_fallback | unavailable), totalHoldings, provenance.verificationStatus, fetchedAt. Shows reload button. Uses useInventory hook. No inline styles — use existing Tailwind classes from console. |
| `apps/orchestr8-console/src/app/analysis/page.tsx` | create | Analysis tab page. Mounts AnalysisInventoryPanel at top. Below: existing council/chat UI (do not remove). On SSE run complete event, call runsRefresh() so Runs panel updates without full page reload. If file already exists, add AnalysisInventoryPanel import + runsRefresh wiring only. |
| `apps/orchestr8-console/src/components/RunsPanel.tsx` | modify | Accept optional externalRefreshCount prop (number). When it increments, re-fetch runs list. Ensures SSE completion in Analysis tab triggers Runs panel update. If RunsPanel does not exist yet, create it: renders RunRecord list with id, task, summary, status badge, completedAt. |
| `orchestr8/services/runstore.py` | modify | Confirm persist_run, list_runs, load_run signatures. Do not modify. Cursor must verify the /v1/runs GET route in orchestr8/api/ calls list_runs and returns JSON matching RunListResponse schema. |
| `apps/orchestr8-console/src/app/analysis/__tests__/inventory.test.ts` | create | Unit tests for fetchInventory: (1) comics API 200 → source=comics_api; (2) comics API 503 → fallback → source=vip_fallback; (3) both fail → source=unavailable, no throw; (4) malformed response → zod error surfaced, source=unavailable. Use vitest + msw or fetch mock. |
| `apps/orchestr8-console/src/app/runs/__tests__/runs-client.test.ts` | create | Unit tests for listRuns: (1) valid response parses to RunListResponse; (2) extra fields stripped by zod; (3) network error returns typed error. For getRun: (4) known id returns RunRecord. |

## Acceptance tests

1. Analysis tab loads with inventory panel visible
2. Fallback to VIP when Comics API is down
3. Double-failure graceful degradation
4. SSE run persists to Runs panel
5. Runs panel refreshes without page reload after SSE completion
6. Provenance fields populated on inventory payload
7. Zod schema rejects malformed inventory response
8. TypeScript typecheck passes

## Risks

- Proxy routes /api/comics/* may not be wired in orchestr8-console Next.js config
- /v1/runs GET may not exist or may return a shape that differs from RunListResponse
- SSE done event name may differ across gateway versions (done vs complete vs [DONE])
- RunsPanel may not exist as a standalone component

## Cursor prompt (paste as-is)

```
TASK: Close Orchestr8 backlog gate A — Analysis tab inventory load + SSE run persistence.

REPO ROOT: monorepo root (see AGENTS.md). Target: apps/orchestr8-console + orchestr8/services only.

STEP 0 — READ FIRST (do not skip):
  - Read AGENTS.md rules 1-6.
  - Read apps/orchestr8-console/next.config.* for existing proxy rewrites.
  - Read orchestr8/api/ directory for /v1/runs route shape.
  - Read orchestr8/services/runstore.py for persist_run / list_runs signatures.
  - Read existing SSE consumer in orchestr8-console to find exact done-event name.
  - Read apps/orchestr8-console/src/components/ and src/app/runs/ to check RunsPanel existence.
  STOP and report any conflict with this spec before writing code.

STEP 1 — TYPES + ZOD (create these files first, nothing else):
  1a. apps/orchestr8-console/src/types/analysis.ts
      - InventorySource = z.enum(['comics_api','vip_fallback','unavailable'])
      - InventoryProvenance = z.object({ source: z.string(), method: z.string(), confidence: z.number().min(0).max(1), verificationStatus: z.enum(['unverified','partial','verified']) })
      - InventoryItem = z.object({ id: z.string(), title: z.string().optional(), grade: z.string().optional() })
      - InventoryPayload = z.object({ source: InventorySource, fetchedAt: z.string(), totalHoldings: z.number(), sampleItems: z.array(InventoryItem), provenance: InventoryProvenance })
  1b. apps/orchestr8-console/src/types/runs.ts
      - RunRole = z.object({ role: z.string(), text: z.string(), confidence: z.number() })
      - RunRecord = z.object({ id: z.string(), task: z.string(), question: z.string(), startedAt: z.string(), completedAt: z.string().nullable(), status: z.enum(['running','complete','failed']), summary: z.string(), roles: z.array(RunRole), vetoed: z.boolean() })
      - RunListResponse = z.object({ runs: z.array(RunRecord) })
      Adjust field names to match actual /v1/runs response shape if different — do not invent fields.

STEP 2 — CLIENTS:
  2a. apps/orchestr8-console/src/lib/inventory-client.ts
      fetchInventory(): try GET /api/comics/holdings; on non-2xx/network error try GET /api/vip/inventory; on second failure return { source:'unavailable', fetchedAt: new Date().toISOString(), totalHoldings:0, sampleItems:[], provenance:{ source:'double_failure', method:'fallback_chain', confidence:0, verificationStatus:'unverified' } }. Validate each response with InventoryPayload.safeParse before returning. Never throw.
  2b. apps/orchestr8-console/src/lib/runs-client.ts
      listRuns(): GET /v1/runs, parse with RunListResponse. getRun(id): GET /v1/runs/:id, parse with RunRecord. Throw typed error on parse failure.

STEP 3 — HOOKS:
  3a. apps/orchestr8-console/src/hooks/useInventory.ts — calls fetchInventory on mount, exposes { data, loading, error, reload }.
  3b. apps/orchestr8-console/src/hooks/useRuns.ts — calls listRuns on mount + when refreshTrigger prop increments.

STEP 4 — COMPONENTS:
  4a. apps/orchestr8-console/src/components/AnalysisInventoryPanel.tsx — renders source badge, totalHoldings, provenance.verificationStatus, fetchedAt, reload button. Uses useInventory.
  4b. apps/orchestr8-console/src/components/RunsPanel.tsx — create if missing; edit if present. Accept externalRefreshCount?: number; re-fetch when it increments. Render run list: id, task, summary, status badge, completedAt.

STEP 5 — PAGE WIRING:
  apps/orchestr8-console/src/app/analysis/page.tsx — add AnalysisInventoryPanel at top. Wire SSE done event to increment runsRefreshCount state, pass to RunsPanel as externalRefreshCount. Do not remove existing council/chat UI.

STEP 6 — PROXY (if missing):
  If next.config.* lacks rewrites for /api/comics/* → http://localhost:5200 and /api/vip/* → http://localhost:8787, add them.

STEP 7 — TESTS:
  apps/orchestr8-console/src/app/analysis/__tests__/inventory.test.ts — 4 cases: comics 200, comics 503+vip 200, both fail, malformed response.
  apps/orchestr8-console/src/app/runs/__tests__/runs-client.test.ts — 4 cases: valid parse, extra fields stripped, network error, getRun by id.

STEP 8 — TYPECHECK:
  npm run typecheck — must pass with zero errors in apps/orchestr8-console.

CONSTRAINTS:
  - Stay in apps/orchestr8-console + orchestr8/services. No IQVault edits.
  - No new DB migrations.
  - No TCGplayer API. No Viture/XR/Luma.
  - Provenance fields on every derived payload.
  - No fake precision — totalHoldings from real API response only.
  - If /v1/runs shape differs from RunRecord schema, match actual shape and note the delta in PR body.

DEFINITION OF DONE: AT-01 through AT-08 all pass. npm run typecheck clean. Runs panel shows persisted run after one SSE council run from Analysis tab.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.875
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
