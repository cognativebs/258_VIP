# Build Spec — Orchestr8 Console — Local Time Status Note Under Health Bar

**ID:** `console-local-time-note-001`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260802T213309_f965cb9a`  
**Generated:** 2026-08-02 21:35 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

Add a one-line status note displaying the client's current local time immediately beneath the Orchestr8 Console Health Bar. Rendering is client-side only (reads the browser's clock after mount). No new API routes, no new packages, no schema changes.

## Constraints

- No new npm packages — use only Date, React hooks (useState, useEffect) already available via react@^19.1.0 in apps/orchestr8-console.
- No new API routes in orchestr8/api/ or apps/orchestr8-console.
- No schema changes to any .json schema file or zod contract.
- Must be a 'use client' component to read client local time and avoid SSR hydration mismatch.
- No provenance fields required — this is ephemeral display state, not a derived data field (AGENTS.md rule 2 does not apply).
- TypeScript only. No .js files.
- Do not alter the Health Bar's existing logic, styling, or data flow.
- The note text must include the formatted local time string (e.g. 'Local time: 10:34:22 AM').
- The component must read time after mount via useEffect to avoid Next.js 15 hydration errors.

## Contracts / schemas first (DoD)

- `n/a` — {"LocalTimestampNote_props": {"description": "Props for the new LocalTimestampNote component. No props required \u2014 reads clock internally.", "type": "object", "properties": {}, "required": []}, "rendered_output_contract": {"description"

## File plan

| Path | Action | Notes |
|---|---|---|
| `apps/orchestr8-console/src/components/LocalTimestampNote.tsx` | create | New 'use client' React component. Uses useState<string | null>(null) and useEffect to set the formatted local time string after mount via new Date().toLocaleTimeString(). Renders null until mounted (avoids SSR/hydration mismatch). When mounted, renders a <p data-testid='console-local-time'> with text 'Local time: {time}'. Re-renders every second via setInterval in the same useEffect (clearInterval on cleanup). No props. No imports beyond React. |
| `apps/orchestr8-console/src/components/HealthBar.tsx` | modify | LOCATE the Health Bar component (Cursor: search for 'HealthBar' or 'health' in apps/orchestr8-console/src — the file may be named HealthBar.tsx, StatusBar.tsx, or similar; check apps/orchestr8-console/src/components/ and apps/orchestr8-console/src/app/). Import LocalTimestampNote and render it immediately after the Health Bar's closing JSX element. If the Health Bar is defined inline in a page file, extract or wrap as needed — but prefer the minimal change of adding <LocalTimestampNote /> as a sibling after the health bar JSX block. |

## Acceptance tests

1. LocalTimestampNote renders when the Console loads

## Risks

- Health Bar file path unknown from repo context — apps/orchestr8-console/src/ structure not listed.
- SSR hydration mismatch if Date is read during server render.
- setInterval leak if component unmounts before cleanup.

## Cursor prompt (paste as-is)

```
## Build Spec: Orchestr8 Console — Local Time Status Note

### Goal
Add a one-line status note showing the client's current local time immediately beneath the Orchestr8 Console Health Bar. Client-side only. No new packages, no API routes, no schema changes.

### Constraints
- 'use client' directive required (reads browser clock after mount).
- No new npm packages. Use React useState + useEffect only.
- No schema or API changes.
- TypeScript only.
- Do not alter Health Bar logic or styling.
- Avoid SSR hydration mismatch: render null until mounted.

### Step 1 — Locate the Health Bar
Run a file search / grep for 'health' or 'HealthBar' inside apps/orchestr8-console/src/. Identify the component or page file that renders the health bar UI. Do NOT invent a path.

### Step 2 — Create apps/orchestr8-console/src/components/LocalTimestampNote.tsx
```tsx
'use client';
import { useEffect, useState } from 'react';

export function LocalTimestampNote() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  if (time === null) return null;

  return (
    <p data-testid="console-local-time" style={{ fontSize: '0.75rem', opacity: 0.7, margin: '4px 0 0' }}>
      Local time: {time}
    </p>
  );
}
```

### Step 3 — Wire into Health Bar / Console page
In the file identified in Step 1, import LocalTimestampNote and render it immediately after the health bar JSX block:
```tsx
import { LocalTimestampNote } from '@/components/LocalTimestampNote';
// ... inside JSX, after the health bar element:
<LocalTimestampNote />
```

### Step 4 — Acceptance test (AT-01)
Create apps/orchestr8-console/src/components/LocalTimestampNote.test.tsx (or add to existing test file):
- Mount <LocalTimestampNote /> with React Testing Library.
- Before act(): assert data-testid='console-local-time' is absent (null render).
- After act() / timer advance: assert element is present and textContent matches /^Local time: .+$/.
- Advance fake timer 1000ms: assert textContent changes.

### Acceptance criteria
1. apps/orchestr8-console/src/components/LocalTimestampNote.tsx exists, compiles with no TS errors.
2. The Console page at http://localhost:3001 shows 'Local time: HH:MM:SS AM/PM' beneath the Health Bar on load.
3. The time updates every second.
4. AT-01 test passes.
5. No new packages in package.json. No new API routes. No schema file changes.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline
- rule/model version: build_spec_v1
- confidence: 0.9
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
