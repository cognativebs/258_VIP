#!/usr/bin/env python3
"""Offline acceptance for Orchestr8 Runs API (build spec orchestr8-runs-api).

    python demo_runs_api.py

Covers AT-01..AT-13 against handlers + a temp .runs fixture (no live server).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import services.runstore as runstore  # noqa: E402
from api.runs_routes import (  # noqa: E402
    QUESTION_LIST_LIMIT,
    canonicalize_run_id,
    handle_get_run,
    handle_list_runs,
    is_iso8601_prefix,
)


def _sample_bundle(run_id: str, question: str) -> dict:
    return {
        "run_id": run_id,
        "created_at": "2026-07-23T23:20:17+00:00",
        "orchestr8_version": "0.1.0",
        "task": "build_spec",
        "mode": "pipeline",
        "roles": ["architect", "critic"],
        "question": question,
        "context_bytes": 12,
        "final_text": "ok",
        "trace": [{"role": "architect", "provider": "anthropic", "model": "claude-sonnet-4-6", "text": "draft"}],
        "usage": {"costUsd": 0.01},
        "provenance": {
            "contract_versions": {"architect": 2},
            "model_overrides": {},
            "council": "build_spec",
            "verification": {"status": "unverified", "gate": "none"},
            "vote_summary": "approved",
            "vetoed": False,
        },
    }


def main() -> int:
    checks: list[tuple[str, bool]] = []

    # AT-07 — never import persist_run
    routes_src = (Path(ROOT) / "api" / "runs_routes.py").read_text(encoding="utf-8")
    checks.append(("AT-07 no persist_run import", "persist_run" not in routes_src))

    with tempfile.TemporaryDirectory() as tmp:
        runs_dir = Path(tmp) / ".runs"
        runs_dir.mkdir()
        original = runstore.RUNS_DIR
        runstore.RUNS_DIR = runs_dir
        try:
            # --- fixtures ---
            short_id = "run_20260723T232017_cd38d86c"
            long_q = "Q" * (QUESTION_LIST_LIMIT + 40)
            long_id = "run_20260727T010101_longquest"
            (runs_dir / f"{short_id}.json").write_text(
                json.dumps(_sample_bundle(short_id, "short question")),
                encoding="utf-8",
            )
            (runs_dir / f"{long_id}.json").write_text(
                json.dumps(_sample_bundle(long_id, long_q)),
                encoding="utf-8",
            )
            # AT-11 partial file — should be skipped in list
            (runs_dir / "run_partial_writing.json").write_text("{", encoding="utf-8")

            # AT-01 list metadata only
            status, body = handle_list_runs()
            items = body.get("runs") or []
            by_id = {r["run_id"]: r for r in items}
            checks.append(("AT-01 status 200", status == 200))
            checks.append(("AT-01 count excludes partial", body.get("count") == 2))
            sample = by_id.get(short_id) or {}
            forbidden = {"trace", "vote", "final_text", "steps"}
            checks.append(("AT-01 no heavy fields", not forbidden.intersection(sample.keys())))
            checks.append(
                (
                    "AT-01 required fields",
                    all(
                        k in sample
                        for k in (
                            "run_id",
                            "task",
                            "question",
                            "question_truncated",
                            "created_at",
                            "retrieved_at",
                        )
                    ),
                )
            )

            # AT-10 ISO on list
            checks.append(("AT-10 list retrieved_at ISO", is_iso8601_prefix(body.get("retrieved_at", ""))))

            # AT-02 detail
            status, detail = handle_get_run(short_id)
            checks.append(("AT-02 status 200", status == 200))
            checks.append(("AT-02 has trace", isinstance(detail.get("trace"), list)))
            checks.append(("AT-02 retrieved_at ISO", is_iso8601_prefix(detail.get("retrieved_at", ""))))
            checks.append(("AT-02 question_truncated false", detail.get("question_truncated") is False))

            # AT-03 missing
            status, err = handle_get_run("run_nonexistent_abc12345")
            checks.append(("AT-03 status 404", status == 404))
            checks.append(
                (
                    "AT-03 not_found body",
                    err.get("error") == "not_found" and err.get("run_id") == "run_nonexistent_abc12345",
                )
            )
            # AT-13 no retrieved_at on 404
            checks.append(("AT-13 no retrieved_at on 404", "retrieved_at" not in err))

            # AT-08 .json suffix
            status, detail2 = handle_get_run(short_id + ".json")
            checks.append(("AT-08 .json suffix 200", status == 200 and detail2.get("run_id") == short_id))
            checks.append(
                ("AT-08 canonicalize", canonicalize_run_id(short_id + ".json") == short_id)
            )

            # AT-09 truncation
            long_item = by_id.get(long_id) or {}
            checks.append(("AT-09 truncated flag", long_item.get("question_truncated") is True))
            checks.append(
                ("AT-09 question length 200", len(long_item.get("question") or "") == QUESTION_LIST_LIMIT)
            )

            # AT-06 malformed on get
            status, bad = handle_get_run("run_partial_writing")
            checks.append(("AT-06 malformed 500", status == 500 and bad.get("error") == "malformed_run"))

            # AT-11 list still works with partial present
            status, body2 = handle_list_runs()
            checks.append(("AT-11 list survives partial", status == 200 and body2.get("count") == 2))

            # AT-04 empty dir
            for p in list(runs_dir.glob("*")):
                p.unlink()
            status, empty = handle_list_runs()
            checks.append(
                ("AT-04 empty dir", status == 200 and empty.get("runs") == [] and empty.get("count") == 0)
            )

            # AT-05 missing dir
            runs_dir.rmdir()
            status, missing = handle_list_runs()
            checks.append(
                (
                    "AT-05 missing dir",
                    status == 200 and missing.get("runs") == [] and missing.get("count") == 0,
                )
            )
        finally:
            runstore.RUNS_DIR = original

    # AT-12 method not allowed — assert server wires 405 for runs mutations
    server_src = (Path(ROOT) / "api" / "server.py").read_text(encoding="utf-8")
    checks.append(
        (
            "AT-12 POST/DELETE 405 wired",
            'path == "/v1/runs"' in server_src
            and "method_not_allowed" in server_src
            and "def do_DELETE" in server_src,
        )
    )

    print()
    passed = 0
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        passed += 1 if ok else 0
    print()
    if passed == len(checks):
        print(f"PASS - {passed}/{len(checks)} Runs API acceptance checks.")
        return 0
    print(f"FAIL - {passed}/{len(checks)} Runs API acceptance checks.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
