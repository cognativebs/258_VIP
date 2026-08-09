"""Read-only HTTP handlers for GET /v1/runs and GET /v1/runs/:id.

Build spec: orchestr8-runs-api (ADR 0003). Imports ONLY list_runs and load_run
from runstore — the write/persist helper is intentionally not imported (AT-07).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from services.runstore import list_runs, load_run

QUESTION_LIST_LIMIT = 200
_ISO_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonicalize_run_id(raw: str) -> str:
    """Strip a trailing .json suffix if present (AT-08)."""
    rid = (raw or "").strip()
    if rid.lower().endswith(".json"):
        rid = rid[: -len(".json")]
    return rid


def _truncate_question(question: str) -> tuple[str, bool]:
    q = question or ""
    if len(q) > QUESTION_LIST_LIMIT:
        return q[:QUESTION_LIST_LIMIT], True
    return q, False


def handle_list_runs() -> tuple[int, dict[str, Any]]:
    """GET /v1/runs — metadata only. Empty/missing .runs → {runs:[], count:0}."""
    retrieved_at = _now_iso()
    try:
        rows = list_runs()
    except OSError as e:
        return 500, {"error": "internal", "detail": str(e)}

    items = []
    for row in rows:
        question, truncated = _truncate_question(str(row.get("question") or ""))
        items.append(
            {
                "run_id": row.get("run_id"),
                "task": row.get("task"),
                "mode": row.get("mode"),
                "roles": row.get("roles") or [],
                "question": question,
                "question_truncated": truncated,
                "created_at": row.get("created_at"),
                "retrieved_at": retrieved_at,
                "costUsd": row.get("costUsd", 0.0),
                "vetoed": bool(row.get("vetoed")),
                "verification": row.get("verification"),
            }
        )
    return 200, {
        "runs": items,
        "count": len(items),
        "retrieved_at": retrieved_at,
        "source": ".runs/",
    }


def handle_get_run(run_id_raw: str) -> tuple[int, dict[str, Any]]:
    """GET /v1/runs/:id — full bundle + retrieved_at + question_truncated."""
    run_id = canonicalize_run_id(run_id_raw)
    if not run_id:
        return 404, {"error": "not_found", "run_id": run_id_raw or ""}

    try:
        bundle = load_run(run_id)
    except json.JSONDecodeError as e:
        return 500, {
            "error": "malformed_run",
            "run_id": run_id,
            "detail": str(e),
        }
    except OSError as e:
        return 500, {"error": "internal", "detail": str(e)}

    if bundle is None:
        return 404, {"error": "not_found", "run_id": run_id}

    retrieved_at = _now_iso()
    question = str(bundle.get("question") or "")
    _, truncated = _truncate_question(question)
    # Detail returns the full question; flag still reports whether list view would truncate.
    out = dict(bundle)
    out["retrieved_at"] = retrieved_at
    out["question_truncated"] = truncated
    return 200, out


def is_iso8601_prefix(value: str) -> bool:
    return bool(_ISO_PREFIX.match(value or ""))
