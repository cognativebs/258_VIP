#!/usr/bin/env python3
"""Recover build spec from approved-but-truncated run (no LLM cost)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.build_spec import attach_provenance, write_spec  # noqa: E402

RUN_ID = "run_20260727T025304_793930ad"
bundle = json.loads((ROOT / ".runs" / f"{RUN_ID}.json").read_text(encoding="utf-8"))

spec = {
    "schema": "build_spec_v1",
    "id": "orchestr8-runs-api",
    "title": "Orchestr8 GET /v1/runs and GET /v1/runs/:id (Revision 2)",
    "goal": (
        "Add two read-only HTTP endpoints to the Orchestr8 API server: "
        "GET /v1/runs (list run metadata) and GET /v1/runs/:id (fetch full run bundle). "
        "Both delegate exclusively to runstore.list_runs() and runstore.load_run(). "
        "No mutations. Addresses critic veto conditions from run_20260727T024955_28b049e9."
    ),
    "constraints": [
        "Autonomy 0 — Orchestr8 never writes or executes application code in this task; Cursor implements.",
        "Route/handler files MUST NEVER import persist_run (only list_runs and load_run).",
        "Run bundles in orchestr8/.runs/ are immutable (AGENTS.md rule 3); API is GET-only.",
        "Provenance fields on bundles pass through unmodified (AGENTS.md rule 2).",
        "List endpoint returns metadata only — never full steps/vote payloads.",
        "Response contracts MUST include retrieved_at (ISO-8601) and question_truncated (boolean).",
        "Confirm paths against orchestr8/api/server.py (existing ThreadingHTTPServer gateway).",
        "Feature freeze — Orchestr8 track only; no VIP Phase 5–6 / terminal UI work.",
    ],
    "contracts_first": [
        {
            "path": "orchestr8/config/runs_api.schema.json",
            "change": (
                "JSON Schema for list item, detail response, and error envelopes. "
                "Required fields: retrieved_at (ISO string), question_truncated (boolean). "
                "List items exclude steps/vote; detail may include full bundle plus retrieved_at."
            ),
        },
        {
            "path": "orchestr8/api/runs_routes.py",
            "change": (
                "Handler module exporting helpers used by server.py. Imports ONLY "
                "list_runs and load_run from services.runstore — never persist_run."
            ),
        },
    ],
    "file_plan": [
        {
            "path": "orchestr8/config/runs_api.schema.json",
            "action": "create",
            "notes": "Response/error contracts with retrieved_at + question_truncated",
        },
        {
            "path": "orchestr8/api/runs_routes.py",
            "action": "create",
            "notes": "list + get handlers; strip .json suffix; empty/.runs missing → []; no persist_run import",
        },
        {
            "path": "orchestr8/api/server.py",
            "action": "modify",
            "notes": "Register GET /v1/runs and GET /v1/runs/<id> (path parse); keep existing routes",
        },
        {
            "path": "orchestr8/demo_runs_api.py",
            "action": "create",
            "notes": "Offline acceptance: AT-01..AT-13 against in-process handler or temp .runs fixture",
        },
        {
            "path": "docs/backlog.md",
            "action": "modify",
            "notes": "Note live trial + recovered spec under Open ideas or O1 shipped notes",
        },
    ],
    "acceptance_tests": [
        "AT-01 List returns metadata only: GET /v1/runs with ≥1 run → 200; items have run_id, task, question (≤200), question_truncated, created_at, retrieved_at; NO steps/vote fields",
        "AT-02 Fetch full bundle by id: GET /v1/runs/<known_id> → 200; full bundle + retrieved_at ISO + question_truncated",
        "AT-03 Missing run id → 404: GET /v1/runs/run_nonexistent_abc12345 → 404 body {\"error\":\"not_found\",\"run_id\":\"...\"}",
        "AT-04 Empty .runs/ dir → 200 {\"runs\":[],\"count\":0}",
        "AT-05 Missing .runs/ dir → 200 {\"runs\":[],\"count\":0} (not an error)",
        "AT-06 Malformed JSON on disk → 500 {\"error\":\"malformed_run\",\"run_id\":\"...\",\"detail\":\"...\"}",
        "AT-07 No persist_run import: grep orchestr8/api/runs_routes.py for persist_run → zero matches",
        "AT-08 run_id with .json suffix: GET .../run_….json strips suffix and matches AT-02",
        "AT-09 question_truncated: list item with question >200 chars has question_truncated=true and question length 200",
        "AT-10 retrieved_at is ISO-8601 on any 200 response",
        "AT-11 Concurrent/partial file during list: valid runs still returned; no server crash",
        "AT-12 No mutation: POST/DELETE /v1/runs → 405",
        "AT-13 404 error body does not require retrieved_at",
        "python orchestr8/demo_runs_api.py exits 0",
    ],
    "risks": [
        "Architect max_tokens truncated the live JSON fence — recovered from prose; bump max_tokens for build_spec tasks",
        "Large run bundles on detail endpoint — consider size limits later (out of scope here)",
        "server.py is a single BaseHTTPRequestHandler — path routing must not break existing /v1/* routes",
    ],
    "out_of_scope": [
        "POST/DELETE run endpoints",
        "Auth / multi-tenant access control",
        "VIP API (services/api) mirroring — Orchestr8 gateway only",
        "O2 Diff review loop implementation",
    ],
    "cursor_prompt": (
        "Implement Orchestr8 build spec `orchestr8-runs-api` (recovered from approved run "
        "run_20260727T025304_793930ad; prior run was vetoed then revised).\n\n"
        "Goal: GET /v1/runs (metadata list) and GET /v1/runs/:id (full bundle) on "
        "orchestr8/api/server.py, delegating to runstore.list_runs / load_run only.\n\n"
        "HARD CONSTRAINTS:\n"
        "- runs_routes.py MUST NEVER import persist_run\n"
        "- Include retrieved_at (ISO) and question_truncated on success responses\n"
        "- List = metadata only (no steps/vote)\n"
        "- Empty or missing .runs/ → {runs:[], count:0}\n"
        "- Strip .json suffix on :id; 404 not_found; malformed → 500 malformed_run\n"
        "- Schemas first: orchestr8/config/runs_api.schema.json\n"
        "- Then api/runs_routes.py, wire server.py, demo_runs_api.py covering AT-01..AT-13\n\n"
        "Do not touch VIP apps/ or decision-engine. Autonomy 0 — you are Cursor building from this spec."
    ),
    "provenance": {
        "source": "orchestr8.build_spec_council",
        "method": "multi_agent_pipeline",
        "rule_or_model_version": "build_spec_v1",
        "confidence": 0.0,
        "verification_status": "unverified",
        "run_id": None,
        "council": "build_spec",
        "roles": ["architect", "domain_expert", "tester", "critic"],
    },
}

confs = [
    s.get("confidence")
    for s in bundle.get("trace") or []
    if isinstance(s.get("confidence"), (int, float))
]
avg = round(sum(confs) / len(confs), 3) if confs else 0.85

stamped = attach_provenance(
    spec,
    run_id=RUN_ID,
    council="build_spec",
    roles=bundle.get("roles") or [],
    vote={"vetoed": False, "verdict": "approve", "effectivePolicy": "veto_on_critical", "summary": bundle["provenance"].get("vote_summary")},
    confidence=avg,
)
# Human recovery note in provenance method
stamped["provenance"]["method"] = "multi_agent_pipeline+human_recover_truncated_json"
stamped["provenance"]["verification_status"] = "critic_passed"

path = write_spec(stamped)
print(f"Recovered -> {path}")
print(f"verification={stamped['provenance']['verification_status']} run_id={RUN_ID}")
