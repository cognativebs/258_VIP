#!/usr/bin/env python3
"""O0 persistence gate — prove a run is captured immutably (offline, no API keys).

    python demo_persist_run.py

Builds a representative 2-agent pipeline result, persists it, reloads it, and
checks: (1) full trace + cost survive a round-trip, (2) provenance carries the
producing contract versions, (3) re-persisting the same run_id is refused
(immutability). Exit 0 on PASS, 1 on FAIL.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from services.runstore import build_bundle, list_runs, load_run, persist_run  # noqa: E402


def _fake_result() -> dict:
    """Shape mirrors services.orchestrator.run_job output (pipeline, 2 agents + synth)."""
    trace = [
        {
            "role": "investment_analyst",
            "role_label": "Investment Analyst",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "text": "Absolute Batman #1 run shows durable demand; hold the graded copy.",
            "confidence": 0.72,
            "usage": {"input": 1800, "output": 420, "total": 2220},
            "costUsd": 0.0117,
        },
        {
            "role": "critic",
            "role_label": "Critic (Final)",
            "provider": "grok",
            "model": "grok-3",
            "text": "Evidence base is thin (3 comps); label the range unverified.",
            "confidence": 0.61,
            "verdict": "conditional",
            "usage": {"input": 2100, "output": 380, "total": 2480},
            "costUsd": 0.0120,
        },
    ]
    return {
        "text": "[CONDITIONAL] Hold; range is evidence-light and marked unverified.",
        "trace": trace,
        "mode": "pipeline",
        "roles": ["investment_analyst", "critic"],
        "modelOverrides": {"critic": "grok-3"},
        "council": "challenge",
        "usage": {
            "input": 3900,
            "output": 800,
            "total": 4700,
            "steps": 2,
            "errors": 0,
            "costUsd": 0.0237,
        },
        "vote": {"summary": "Challenge Council: conditional approval.", "vetoed": False},
    }


def main() -> int:
    checks: list[tuple[str, bool]] = []

    result = _fake_result()
    bundle = build_bundle(
        result=result,
        task="comics_collection_analysis",
        question="Should I hold the Absolute Batman #1 graded copy?",
        context_json='{"filtered": 1}',
    )
    path = persist_run(bundle)
    checks.append(("run bundle written", path.exists()))

    reloaded = load_run(bundle["run_id"]) or {}
    checks.append(("reload round-trips", reloaded.get("run_id") == bundle["run_id"]))
    checks.append(("full trace survives", len(reloaded.get("trace", [])) == 2))
    checks.append((
        "cost survives",
        abs((reloaded.get("usage") or {}).get("costUsd", 0) - 0.0237) < 1e-9,
    ))
    cv = (reloaded.get("provenance") or {}).get("contract_versions") or {}
    checks.append(
        (
            "provenance has contract versions",
            isinstance(cv.get("investment_analyst"), int) and cv.get("investment_analyst") >= 1,
        )
    )
    checks.append((
        "verification starts unverified",
        (reloaded.get("provenance") or {}).get("verification", {}).get("status") == "unverified",
    ))

    immutable = False
    try:
        persist_run(bundle)
    except FileExistsError:
        immutable = True
    checks.append(("re-persist refused (immutable)", immutable))

    checks.append(("appears in index", any(r["run_id"] == bundle["run_id"] for r in list_runs())))

    print(f"Persisted: {path}")
    print()
    passed = 0
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        passed += 1 if ok else 0

    print()
    if passed == len(checks):
        print(f"PASS - {passed}/{len(checks)} persistence checks.")
        return 0
    print(f"FAIL - {passed}/{len(checks)} persistence checks.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
