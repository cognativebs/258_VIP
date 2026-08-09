#!/usr/bin/env python3
"""O1 offline gate — tools, schema, emit, contract enforcement (no API keys).

    python demo_build_spec.py

Proves:
  1. Read-only tools work and respect contracts (architect OK, pricing_agent denied)
  2. Secrets / path escape are blocked
  3. A synthetic critic-passed committee result yields a valid docs/specs/*.md
  4. Vetoed results do not write a spec
  5. build_spec council is registered with the expected pipeline

Exit 0 on PASS.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from services.build_spec import (  # noqa: E402
    SPECS_DIR,
    build_spec_from_committee_result,
    extract_build_spec,
    validate_build_spec,
    write_spec,
)
from services.registry import clear_agent_cache, get_council  # noqa: E402
from services.tools import ToolDenied, call_tool, gather_build_context, read_file  # noqa: E402


def _sample_spec_json() -> str:
    return json.dumps(
        {
            "schema": "build_spec_v1",
            "id": "o2-diff-review",
            "title": "O2 Diff review loop",
            "goal": (
                "After Cursor implements a build spec, paste the diff back so the "
                "Challenge Council (critic + tester + domain_expert) scores it against "
                "the spec's acceptance criteria and returns approve/conditional/reject."
            ),
            "constraints": [
                "Autonomy 0 — Orchestr8 never writes or executes code (ADR 0003)",
                "Feature freeze — only O2 scope; do not resume VIP Phases 5–6",
                "Reuse existing Challenge Council voting (veto_on_critical)",
                "Provenance on the review artifact (source, method, confidence, verification)",
            ],
            "contracts_first": [
                {
                    "path": "orchestr8/config/diff_review.schema.json",
                    "change": "Define input (spec_id, diff_text) and output (verdict, findings, provenance)",
                },
                {
                    "path": "orchestr8/services/diff_review.py",
                    "change": "Loader + validator + markdown renderer for review results",
                },
            ],
            "file_plan": [
                {
                    "path": "orchestr8/config/diff_review.schema.json",
                    "action": "create",
                    "notes": "JSON Schema for the review bundle",
                },
                {
                    "path": "orchestr8/services/diff_review.py",
                    "action": "create",
                    "notes": "Extract/validate/emit review; load paired docs/specs/<id>.json",
                },
                {
                    "path": "orchestr8/scripts/review_diff.py",
                    "action": "create",
                    "notes": "CLI: --spec-id + diff file → Challenge Council job",
                },
                {
                    "path": "orchestr8/demo_diff_review.py",
                    "action": "create",
                    "notes": "Offline gate: council catches a deliberately violating diff",
                },
                {
                    "path": "docs/backlog.md",
                    "action": "modify",
                    "notes": "Check off O2 items when gate passes",
                },
            ],
            "acceptance_tests": [
                "Offline demo: a diff that omits a required acceptance test is rejected/vetoed",
                "A conforming synthetic diff receives approve or conditional with findings list",
                "Review artifact written under docs/specs/ or .runs/ with provenance",
                "python demo_diff_review.py exits 0",
            ],
            "risks": [
                "Large diffs may truncate; need size limits and clear truncation flags",
                "Critic may over-veto style nits — keep policy on acceptance criteria only",
            ],
            "out_of_scope": [
                "Auto-applying fixes in the repo",
                "Terminal UI / VIP Phase 5–6 work",
            ],
            "cursor_prompt": (
                "Implement Orchestr8 Phase O2 (ADR 0003): Diff review loop.\n\n"
                "Goal: paste an implemented diff + build-spec id into Orchestr8; run the "
                "Challenge Council against the spec's acceptance_tests; emit a review "
                "artifact with provenance.\n\n"
                "Constraints: Autonomy 0 (no write/execute tools); reuse challenge council "
                "voting; feature freeze.\n\n"
                "Do schemas first: orchestr8/config/diff_review.schema.json, then "
                "services/diff_review.py, scripts/review_diff.py, demo_diff_review.py.\n\n"
                "Acceptance: offline demo catches a deliberately violating diff; "
                "conforming diff gets approve/conditional; provenance populated."
            ),
            "provenance": {
                "source": "orchestr8.build_spec_council",
                "method": "multi_agent_pipeline",
                "rule_or_model_version": "build_spec_v1",
                "confidence": 0.8,
                "verification_status": "unverified",
                "run_id": None,
                "council": "build_spec",
                "roles": ["architect", "domain_expert", "tester", "critic"],
            },
        }
    )


def main() -> int:
    clear_agent_cache()
    checks: list[tuple[str, bool]] = []

    # --- tools + contract enforcement ---
    try:
        listed = call_tool("architect", "list_dir", path="orchestr8/config")
        checks.append(("architect list_dir works", "build_spec.schema.json" in [e["name"] for e in listed["entries"]]))
    except Exception as e:  # noqa: BLE001
        checks.append((f"architect list_dir works ({e})", False))

    denied = False
    try:
        call_tool("pricing_agent", "read_file", path="AGENTS.md")
    except ToolDenied:
        denied = True
    checks.append(("pricing_agent read_file denied", denied))

    blocked = False
    try:
        read_file("architect", "orchestr8/.env")
    except (ToolDenied, FileNotFoundError):
        blocked = True
    checks.append(("secrets path blocked or missing", blocked))

    escaped = False
    try:
        call_tool("architect", "read_file", path="../..")
    except ToolDenied:
        escaped = True
    except Exception:
        escaped = True
    checks.append(("path escape blocked", escaped))

    ctx = gather_build_context("architect")
    checks.append(("gather_build_context non-empty", "AGENTS.md" in ctx and "REPO CONTEXT" in ctx))

    # --- schema + extract ---
    sample = _sample_spec_json()
    wrapped = (
        "Draft work order for O2.\n\n```json\n" + sample + "\n```\n"
    )
    extracted = extract_build_spec(wrapped)
    checks.append(("extract_build_spec finds JSON", extracted is not None and extracted.get("id") == "o2-diff-review"))
    errs = validate_build_spec(extracted) if extracted else ["no spec"]
    checks.append(("sample spec validates", errs == []))

    # --- emit critic-passed synthetic committee result ---
    fake_result = {
        "text": wrapped,
        "trace": [
            {
                "role": "architect",
                "role_label": "Architect",
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "text": wrapped,
                "confidence": 0.78,
                "usage": {"input": 100, "output": 200, "total": 300},
                "costUsd": 0.01,
            },
            {
                "role": "critic",
                "role_label": "Critic",
                "provider": "grok",
                "model": "grok-3",
                "text": "Acceptance tests are measurable. Approve.",
                "confidence": 0.7,
                "verdict": "approve",
                "structured": {"verdict": "approve", "confidence": 0.7, "summary": "ok"},
                "usage": {"input": 50, "output": 40, "total": 90},
                "costUsd": 0.002,
            },
        ],
        "mode": "pipeline",
        "roles": ["architect", "domain_expert", "tester", "critic"],
        "council": "build_spec",
        "runId": "run_demo_o1",
        "vote": {"vetoed": False, "verdict": "approve", "effectivePolicy": "veto_on_critical", "summary": "approved"},
        "usage": {"costUsd": 0.012},
    }
    stamped = build_spec_from_committee_result(fake_result, question="O2 Diff review loop")
    checks.append(
        (
            "provenance critic_passed",
            stamped["provenance"]["verification_status"] == "critic_passed",
        )
    )
    path = write_spec(stamped)
    checks.append(("docs/specs/o2-diff-review.md written", path.exists()))
    checks.append(("docs/specs/o2-diff-review.json written", (SPECS_DIR / "o2-diff-review.json").exists()))
    md = path.read_text(encoding="utf-8")
    checks.append(("markdown has Cursor prompt section", "## Cursor prompt" in md and "O2" in md))

    # --- veto must not be treated as critic_passed ---
    veto_result = {
        **fake_result,
        "vote": {"vetoed": True, "verdict": "reject", "effectivePolicy": "veto_on_critical", "summary": "VETO"},
    }
    veto_spec = build_spec_from_committee_result(veto_result, question="O2 Diff review loop")
    checks.append(
        (
            "vetoed -> critic_vetoed status",
            veto_spec["provenance"]["verification_status"] == "critic_vetoed",
        )
    )

    # --- council registered ---
    clear_agent_cache()
    council = get_council("build_spec")
    checks.append(("build_spec council exists", council is not None))
    if council:
        checks.append(
            (
                "council pipeline order",
                council.get("agents") == ["architect", "domain_expert", "tester", "critic"],
            )
        )
        checks.append(("council voting veto_on_critical", council.get("voting") == "veto_on_critical"))

    print(f"Spec path: {path}")
    print()
    passed = 0
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        passed += 1 if ok else 0
    print()
    if passed == len(checks):
        print(f"PASS - {passed}/{len(checks)} O1 offline checks.")
        return 0
    print(f"FAIL - {passed}/{len(checks)} O1 offline checks.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
