# Build Spec — Add 'Open Specs' button to BuildSpecPanel after approved build spec emits

**ID:** `console-open-specs-button`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260802T214907_437b1e37`  
**Generated:** 2026-08-02 21:49 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

When a Build Spec council run completes successfully and session.result.buildSpecPath is present, render an 'Open Specs' button/link next to the existing spec path line in BuildSpecPanel. On click, call setTab('specs') from useCouncilSession() to switch the console to the Specs tab. If buildSpecPath is absent (veto, emit_failed, or missing result), render nothing new.

## Constraints

- Modify only apps/orchestr8-console/src/components/BuildSpecPanel.tsx
- No new packages, APIs, schemas, or backend changes
- Do not change HealthBar or any other component
- No router navigation — use setTab('specs') only
- No new props on BuildSpecPanel; consume useCouncilSession() inside the component
- Button/link must be visually adjacent to the existing buildSpecPath line, not a new section

## Contracts / schemas first (DoD)

- `apps/orchestr8-console/src/lib/orchestr8Api.ts` — READ-ONLY reference: JobResult already types buildSpecPath as string | undefined. No changes needed.
- `apps/orchestr8-console/src/lib/councilSession.tsx` — READ-ONLY reference: useCouncilSession() already exports setTab; ConsoleTab already includes 'specs'. No changes needed.
- `apps/orchestr8-console/src/components/BuildSpecPanel.tsx` — MODIFY: Import useCouncilSession. Destructure setTab. In the JSX block that renders session.result.buildSpecPath, add an inline 'Open Specs' button/link that calls setTab('specs'). Render nothing new when buildSpecPath is falsy.

## File plan

| Path | Action | Notes |
|---|---|---|
| `apps/orchestr8-console/src/components/BuildSpecPanel.tsx` | modify | 1. Add import: import { useCouncilSession } from '../lib/councilSession'; (adjust relative path to match existing imports in the file). 2. Inside the component body, destructure: const { setTab } = useCouncilSession(); 3. Locate the JSX block that conditionally renders session.result.buildSpecPath (already present under the outcome banner). 4. Immediately after or inline with the path display, add: {session.result?.buildSpecPath && (<button onClick={() => setTab('specs')} style or className matching existing button styles>Open Specs</button>)}. 5. No other changes. |

## Acceptance tests

1. AT-01 HAPPY PATH: Given a completed build_spec run where session.result.buildSpecPath is a non-empty string, the BuildSpecPanel renders an 'Open Specs' button/link adjacent to the path line.
2. AT-02 TAB SWITCH: When the 'Open Specs' button is clicked, setTab('specs') is called exactly once and the console tab switches to 'specs'. No router navigation occurs.
3. AT-03 NO PATH — VETO: Given a completed run where the council vetoed and session.result.buildSpecPath is undefined or absent, the 'Open Specs' button/link does NOT render. The existing path line area is unchanged.
4. AT-04 NO PATH — EMIT FAILED: Given a run that ended with emit_failed status (buildSpecPath absent), the 'Open Specs' button/link does NOT render.
5. AT-05 REGRESSION: The existing buildSpecPath text display, outcome banner, and all other BuildSpecPanel content are unaffected. HealthBar is unaffected.
6. AT-06 TYPE SAFETY: The component compiles without TypeScript errors. useCouncilSession import resolves correctly from its existing path in councilSession.tsx.

## Risks

- LOW: Relative import path for councilSession.tsx must match the directory depth of BuildSpecPanel.tsx — Cursor must verify before writing.
- LOW: If useCouncilSession() is a context hook that throws outside its provider, ensure BuildSpecPanel is always rendered inside the provider tree (assumption: it already is, given existing Console architecture).
- NONE: No backend, schema, or API risk — UI-only change to one file.

## Out of scope

- HealthBar changes
- New packages or dependencies
- Backend/API/schema changes
- Router navigation
- Any component other than BuildSpecPanel.tsx
- Styling overhaul — match existing button/link styles only

## Cursor prompt (paste as-is)

```
## Build Spec: Add 'Open Specs' button to BuildSpecPanel

### Goal
Add an 'Open Specs' button/link to BuildSpecPanel.tsx that appears next to the existing buildSpecPath line when a build spec run succeeds. On click, call setTab('specs') to switch the console to the Specs tab. If buildSpecPath is absent, render nothing new.

### Constraints
- Modify ONLY: apps/orchestr8-console/src/components/BuildSpecPanel.tsx
- No new packages, APIs, schemas, or backend changes
- Do not change HealthBar or any other component
- No router navigation — setTab('specs') only
- No new props on BuildSpecPanel

### Verified facts (treat as ground truth)
- Result field: session.result.buildSpecPath (string | undefined) — already rendered in BuildSpecPanel under outcome banner
- Hook: useCouncilSession() from apps/orchestr8-console/src/lib/councilSession.tsx — exports setTab
- Tab id: 'specs' — included in ConsoleTab type
- Call: setTab('specs') — no router navigation

### File plan
1. apps/orchestr8-console/src/components/BuildSpecPanel.tsx (MODIFY)
   a. Add import for useCouncilSession from '../lib/councilSession' (verify relative path matches existing imports)
   b. Destructure setTab from useCouncilSession() inside the component
   c. In the JSX block that renders session.result.buildSpecPath, add inline:
      {session.result?.buildSpecPath && (
        <button onClick={() => setTab('specs')}>
          Open Specs
        </button>
      )}
   d. Style the button to match existing button/link styles in the file
   e. No other changes

### Acceptance tests
- AT-01: When buildSpecPath is a non-empty string, 'Open Specs' button renders adjacent to path line
- AT-02: Clicking 'Open Specs' calls setTab('specs') once; console switches to Specs tab; no router navigation
- AT-03: When buildSpecPath is undefined/absent (veto case), 'Open Specs' button does NOT render
- AT-04: When buildSpecPath is absent (emit_failed case), 'Open Specs' button does NOT render
- AT-05: Existing outcome banner, path display, and all other BuildSpecPanel content are unaffected; HealthBar unaffected
- AT-06: Component compiles without TypeScript errors; useCouncilSession import resolves

### Done when
All six acceptance tests pass. Only BuildSpecPanel.tsx is modified. TypeScript compiles clean.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.96
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
