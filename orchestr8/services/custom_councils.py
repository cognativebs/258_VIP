"""Operator-saved councils created from Save team in the AI team panel.

Shipped councils live in ``config/councils.yaml``. Teams named from the UI are
operator input, so they live in ``custom_councils/`` — gitignored, the same way
``custom_agents/`` holds unverified roles. The registry overlays the two and
never lets a custom file shadow a shipped id.

Provenance (AGENTS.md rule 2) records that the council is operator-authored
and unverified. Inferred voting rules are never stored as if a council reviewed
them: default is ``none``.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml

from services.custom_agents import slugify

ROOT = Path(__file__).resolve().parent.parent
CUSTOM_COUNCILS_DIR = ROOT / "custom_councils"
SCHEMA_PATH = ROOT / "config" / "custom_council.schema.json"
SHIPPED_COUNCILS_PATH = ROOT / "config" / "councils.yaml"

DEFAULT_VOTING = "none"
DEFAULT_PURPOSE = "Operator-saved team from the AI team panel."


class CustomCouncilError(ValueError):
    """Rejected create/update/delete — operator-readable reason."""


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def custom_council_dir(council_id: str) -> Path:
    return CUSTOM_COUNCILS_DIR / council_id


def list_custom_council_ids() -> list[str]:
    if not CUSTOM_COUNCILS_DIR.exists():
        return []
    return sorted(p.parent.name for p in CUSTOM_COUNCILS_DIR.glob("*/council.yaml"))


def _shipped_ids() -> set[str]:
    if not SHIPPED_COUNCILS_PATH.exists():
        return set()
    with open(SHIPPED_COUNCILS_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    return set((cfg.get("councils") or {}).keys())


def _known_agent_ids() -> set[str]:
    from services.registry import load_agents

    return set(load_agents())


def _normalize_mode(mode: str | None, agent_count: int) -> str:
    if agent_count <= 1:
        return "parallel"
    if mode == "single":
        return "parallel"
    if mode in ("pipeline", "parallel"):
        return mode
    return "parallel"


def validate_request(payload: dict, *, partial: bool = False) -> dict:
    from services.contracts import validate_instance

    if not isinstance(payload, dict):
        raise CustomCouncilError("Request body must be a JSON object")

    allowed = {"name", "purpose", "agents", "mode", "voting"}
    cleaned: dict = {}
    for key, value in payload.items():
        if key not in allowed:
            continue
        if isinstance(value, str):
            cleaned[key] = value.strip()
        elif key == "agents" and isinstance(value, list):
            cleaned[key] = [str(item).strip() for item in value if str(item).strip()]
        else:
            cleaned[key] = value

    schema = load_schema()
    if partial:
        required = []
        if "name" in cleaned:
            required.append("name")
        if "agents" in cleaned:
            required.append("agents")
        schema = {**schema, "required": required}

    errs = validate_instance(cleaned, schema)
    if errs:
        raise CustomCouncilError("; ".join(errs))
    if not partial and not cleaned.get("name"):
        raise CustomCouncilError("Council name is required")
    if not partial and not cleaned.get("agents"):
        raise CustomCouncilError("Select at least one role")
    return cleaned


def _validate_agents(agent_ids: list[str]) -> list[str]:
    known = _known_agent_ids()
    missing = [aid for aid in agent_ids if aid not in known]
    if missing:
        raise CustomCouncilError(
            "Unknown role id(s): " + ", ".join(sorted(missing))
        )
    return agent_ids


def _write_yaml(path: Path, data: dict, *, header: str) -> None:
    body = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    path.write_text(header + body, encoding="utf-8")


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _public_card(meta: dict) -> dict:
    return {
        "id": meta["id"],
        "label": meta.get("label", meta["id"]),
        "purpose": meta.get("purpose", ""),
        "mode": meta.get("mode", "parallel"),
        "agents": list(meta.get("agents") or []),
        "voting": meta.get("voting", DEFAULT_VOTING),
        "outputOwner": meta.get("output_owner"),
        "custom": True,
        "verificationStatus": (meta.get("provenance") or {}).get(
            "verification_status"
        ),
    }


def create_custom_council(payload: dict) -> dict:
    from services.registry import clear_agent_cache

    cleaned = validate_request(payload)
    name = cleaned["name"]
    council_id = slugify(name)
    if not council_id:
        raise CustomCouncilError(f"{name!r} has no letters or digits to build an id from")
    if council_id in _shipped_ids():
        raise CustomCouncilError(
            f"Council id {council_id!r} is a shipped council. Pick a different name."
        )
    if custom_council_dir(council_id).joinpath("council.yaml").exists():
        raise CustomCouncilError(
            f"Council id {council_id!r} already exists. Pick a different name."
        )

    agents = _validate_agents(cleaned["agents"])
    mode = _normalize_mode(cleaned.get("mode"), len(agents))
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    purpose = cleaned.get("purpose") or DEFAULT_PURPOSE
    voting = cleaned.get("voting") or DEFAULT_VOTING

    council = {
        "id": council_id,
        "label": name,
        "purpose": purpose,
        "mode": mode,
        "agents": agents,
        "voting": voting,
        "output_owner": agents[0],
        "custom": True,
        "provenance": {
            "source": "console_ui",
            "method": "operator_authored",
            "created_at": created_at,
            "verification_status": "unverified",
        },
    }

    target = custom_council_dir(council_id)
    target.mkdir(parents=True, exist_ok=True)
    _write_yaml(
        target / "council.yaml",
        council,
        header=f"# Orchestr8 custom council — {name}\n"
        f"# Operator-saved from the AI team panel on {created_at}.\n"
        f"# Unverified: not a shipped playbook.\n",
    )
    clear_agent_cache()
    return {"id": council_id, "path": _display_path(target), "council": _public_card(council)}


def update_custom_council(council_id: str, payload: dict) -> dict:
    from services.registry import clear_agent_cache

    if council_id in _shipped_ids():
        raise CustomCouncilError("Shipped councils cannot be edited from the team panel")
    path = custom_council_dir(council_id) / "council.yaml"
    if not path.exists():
        raise CustomCouncilError(f"Unknown custom council: {council_id}")

    cleaned = validate_request(payload, partial=True)
    if not cleaned:
        raise CustomCouncilError("Nothing to update")

    with open(path, encoding="utf-8") as f:
        council = yaml.safe_load(f) or {}

    if "name" in cleaned:
        council["label"] = cleaned["name"]
    if "purpose" in cleaned:
        council["purpose"] = cleaned["purpose"] or DEFAULT_PURPOSE
    if "agents" in cleaned:
        agents = _validate_agents(cleaned["agents"])
        council["agents"] = agents
        council["output_owner"] = agents[0]
        council["mode"] = _normalize_mode(cleaned.get("mode") or council.get("mode"), len(agents))
    elif "mode" in cleaned:
        council["mode"] = _normalize_mode(
            cleaned["mode"], len(council.get("agents") or [])
        )
    if "voting" in cleaned:
        council["voting"] = cleaned["voting"]

    council["id"] = council_id
    council["custom"] = True
    provenance = dict(council.get("provenance") or {})
    provenance["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    provenance.setdefault("source", "console_ui")
    provenance.setdefault("method", "operator_authored")
    provenance.setdefault("verification_status", "unverified")
    council["provenance"] = provenance

    label = council.get("label") or council_id
    _write_yaml(
        path,
        council,
        header=f"# Orchestr8 custom council — {label}\n"
        f"# Operator-saved from the AI team panel.\n"
        f"# Unverified: not a shipped playbook.\n",
    )
    clear_agent_cache()
    return {"id": council_id, "path": _display_path(path.parent), "council": _public_card(council)}


def delete_custom_council(council_id: str) -> dict:
    from services.registry import clear_agent_cache

    if council_id in _shipped_ids():
        raise CustomCouncilError("Shipped councils cannot be deleted from the team panel")
    target = custom_council_dir(council_id)
    if not (target / "council.yaml").exists():
        raise CustomCouncilError(f"Unknown custom council: {council_id}")
    shutil.rmtree(target)
    clear_agent_cache()
    return {"id": council_id, "deleted": True}


def load_custom_councils() -> dict[str, dict]:
    """Return {council_id: council_meta} for every custom_councils/*/council.yaml."""
    councils: dict[str, dict] = {}
    if not CUSTOM_COUNCILS_DIR.exists():
        return councils
    shipped = _shipped_ids()
    for path in sorted(CUSTOM_COUNCILS_DIR.glob("*/council.yaml")):
        with open(path, encoding="utf-8") as f:
            meta = yaml.safe_load(f) or {}
        cid = meta.get("id") or path.parent.name
        if cid in shipped:
            continue
        meta["id"] = cid
        meta["custom"] = True
        councils[cid] = meta
    return councils
