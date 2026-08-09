"""Read-only handlers for GET /v1/specs and GET /v1/specs/:id.

Lists build-spec JSON under docs/specs/ (Autonomy 0 — no writes).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import re

# VIP repo root = parent of orchestr8/
SPECS_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "specs"
_SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$")


def _safe_id(raw: str) -> str | None:
    rid = (raw or "").strip()
    if rid.lower().endswith(".json"):
        rid = rid[: -len(".json")]
    if rid.lower().endswith(".md"):
        rid = rid[: -len(".md")]
    if not _SAFE_ID.match(rid):
        return None
    return rid


def handle_list_specs() -> tuple[int, dict[str, Any]]:
    if not SPECS_DIR.exists():
        return 200, {"specs": [], "count": 0, "source": "docs/specs/"}
    items: list[dict[str, Any]] = []
    for path in sorted(SPECS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        prov = data.get("provenance") or {}
        items.append(
            {
                "id": data.get("id") or path.stem,
                "title": data.get("title") or path.stem,
                "verification_status": prov.get("verification_status") or "unverified",
                "council": prov.get("council"),
                "run_id": prov.get("run_id"),
                "path": f"docs/specs/{path.name}",
                "md_path": f"docs/specs/{path.stem}.md",
            }
        )
    return 200, {"specs": items, "count": len(items), "source": "docs/specs/"}


def handle_get_spec(spec_id_raw: str) -> tuple[int, dict[str, Any]]:
    spec_id = _safe_id(spec_id_raw)
    if not spec_id:
        return 404, {"error": "not_found", "id": spec_id_raw or ""}

    json_path = SPECS_DIR / f"{spec_id}.json"
    if not json_path.exists():
        return 404, {"error": "not_found", "id": spec_id}

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return 500, {"error": "malformed_spec", "id": spec_id, "detail": str(e)}

    md_path = SPECS_DIR / f"{spec_id}.md"
    markdown = None
    if md_path.exists():
        try:
            markdown = md_path.read_text(encoding="utf-8")
        except OSError:
            markdown = None

    return 200, {
        "id": data.get("id") or spec_id,
        "path": f"docs/specs/{json_path.name}",
        "md_path": f"docs/specs/{spec_id}.md" if markdown is not None else None,
        "spec": data,
        "markdown": markdown,
    }
