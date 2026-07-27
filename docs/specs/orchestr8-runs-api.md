# Build Spec — Orchestr8 GET /v1/runs and GET /v1/runs/:id (Revision 2)

**ID:** `orchestr8-runs-api`  
**Verification:** critic_passed  
**Council:** build_spec  
**Run:** `run_20260727T025304_793930ad`  
**Generated:** 2026-07-27 02:56 UTC

> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. After implementation, paste the diff back to the Challenge Council for review.

## Goal

Add two read-only HTTP endpoints to the Orchestr8 API server: GET /v1/runs (list run metadata) and GET /v1/runs/:id (fetch full run bundle). Both delegate exclusively to runstore.list_runs() and runstore.load_run(). No mutations. Addresses critic veto conditions from run_20260727T024955_28b049e9.

## Constraints

- Autonomy 0 — Orchestr8 never writes or executes application code in this task; Cursor implements.
- Route/handler files MUST NEVER import persist_run (only list_runs and load_run).
- Run bundles in orchestr8/.runs/ are immutable (AGENTS.md rule 3); API is GET-only.
- Provenance fields on bundles pass through unmodified (AGENTS.md rule 2).
- List endpoint returns metadata only — never full steps/vote payloads.
- Response contracts MUST include retrieved_at (ISO-8601) and question_truncated (boolean).
- Confirm paths against orchestr8/api/server.py (existing ThreadingHTTPServer gateway).
- Feature freeze — Orchestr8 track only; no VIP Phase 5–6 / terminal UI work.

## Contracts / schemas first (DoD)

- `orchestr8/config/runs_api.schema.json` — JSON Schema for list item, detail response, and error envelopes. Required fields: retrieved_at (ISO string), question_truncated (boolean). List items exclude steps/vote; detail may include full bundle plus retrieved_at.
- `orchestr8/api/runs_routes.py` — Handler module exporting helpers used by server.py. Imports ONLY list_runs and load_run from services.runstore — never persist_run.

## File plan

| Path | Action | Notes |
|---|---|---|
| `orchestr8/config/runs_api.schema.json` | create | Response/error contracts with retrieved_at + question_truncated |
| `orchestr8/api/runs_routes.py` | create | list + get handlers; strip .json suffix; empty/.runs missing → []; no persist_run import |
| `orchestr8/api/server.py` | modify | Register GET /v1/runs and GET /v1/runs/<id> (path parse); keep existing routes |
| `orchestr8/demo_runs_api.py` | create | Offline acceptance: AT-01..AT-13 against in-process handler or temp .runs fixture |
| `docs/backlog.md` | modify | Note live trial + recovered spec under Open ideas or O1 shipped notes |

## Acceptance tests

1. AT-01 List returns metadata only: GET /v1/runs with ≥1 run → 200; items have run_id, task, question (≤200), question_truncated, created_at, retrieved_at; NO steps/vote fields
2. AT-02 Fetch full bundle by id: GET /v1/runs/<known_id> → 200; full bundle + retrieved_at ISO + question_truncated
3. AT-03 Missing run id → 404: GET /v1/runs/run_nonexistent_abc12345 → 404 body {"error":"not_found","run_id":"..."}
4. AT-04 Empty .runs/ dir → 200 {"runs":[],"count":0}
5. AT-05 Missing .runs/ dir → 200 {"runs":[],"count":0} (not an error)
6. AT-06 Malformed JSON on disk → 500 {"error":"malformed_run","run_id":"...","detail":"..."}
7. AT-07 No persist_run import: grep orchestr8/api/runs_routes.py for persist_run → zero matches
8. AT-08 run_id with .json suffix: GET .../run_….json strips suffix and matches AT-02
9. AT-09 question_truncated: list item with question >200 chars has question_truncated=true and question length 200
10. AT-10 retrieved_at is ISO-8601 on any 200 response
11. AT-11 Concurrent/partial file during list: valid runs still returned; no server crash
12. AT-12 No mutation: POST/DELETE /v1/runs → 405
13. AT-13 404 error body does not require retrieved_at
14. python orchestr8/demo_runs_api.py exits 0

## Risks

- Architect max_tokens truncated the live JSON fence — recovered from prose; bump max_tokens for build_spec tasks
- Large run bundles on detail endpoint — consider size limits later (out of scope here)
- server.py is a single BaseHTTPRequestHandler — path routing must not break existing /v1/* routes

## Out of scope

- POST/DELETE run endpoints
- Auth / multi-tenant access control
- VIP API (services/api) mirroring — Orchestr8 gateway only
- O2 Diff review loop implementation

## Cursor prompt (paste as-is)

```
Implement Orchestr8 build spec `orchestr8-runs-api` (recovered from approved run run_20260727T025304_793930ad; prior run was vetoed then revised).

Goal: GET /v1/runs (metadata list) and GET /v1/runs/:id (full bundle) on orchestr8/api/server.py, delegating to runstore.list_runs / load_run only.

HARD CONSTRAINTS:
- runs_routes.py MUST NEVER import persist_run
- Include retrieved_at (ISO) and question_truncated on success responses
- List = metadata only (no steps/vote)
- Empty or missing .runs/ → {runs:[], count:0}
- Strip .json suffix on :id; 404 not_found; malformed → 500 malformed_run
- Schemas first: orchestr8/config/runs_api.schema.json
- Then api/runs_routes.py, wire server.py, demo_runs_api.py covering AT-01..AT-13

Do not touch VIP apps/ or decision-engine. Autonomy 0 — you are Cursor building from this spec.
```

## Provenance

- source: orchestr8.build_spec_council
- method: multi_agent_pipeline+human_recover_truncated_json
- rule/model version: build_spec_v1
- confidence: 0.9
- verification: critic_passed
- roles: architect, domain_expert, tester, critic
