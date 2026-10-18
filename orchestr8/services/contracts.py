"""Agent contracts (ADR 0002 · O0).

Loads per-agent ``contract.yaml`` and validates it against the canonical
``config/contract.schema.json``. Contracts express AGENTS.md rule 6: mission,
allowed tools, IO schema, confidence rules, failure behavior, escalation.

The validator is a small draft-07 subset (type / required / properties / items /
enum / minLength / maxLength / pattern / minimum / maximum) so Orchestr8 keeps
zero extra dependencies.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = ROOT / "agents"
# Operator-authored roles (services/custom_agents.py) carry a contract too, so
# the O0 gate covers them exactly like a shipped agent.
CUSTOM_AGENTS_DIR = ROOT / "custom_agents"
SCHEMA_PATH = ROOT / "config" / "contract.schema.json"


@lru_cache(maxsize=1)
def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def contract_path(agent_id: str) -> Path:
    """Prefer a local overlay, then the shipped contract."""
    custom = CUSTOM_AGENTS_DIR / agent_id / "contract.yaml"
    if custom.exists():
        return custom
    return AGENTS_DIR / agent_id / "contract.yaml"


def load_contract(agent_id: str) -> dict | None:
    path = contract_path(agent_id)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def list_contracts() -> dict[str, dict]:
    """Return {agent_id: contract} for every shipped and custom contract.yaml."""
    out: dict[str, dict] = {}
    for base in (AGENTS_DIR, CUSTOM_AGENTS_DIR):
        if not base.exists():
            continue
        for path in sorted(base.glob("*/contract.yaml")):
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            out[data.get("id") or path.parent.name] = data
    return out


def validate_contract(data: dict) -> list[str]:
    """Return a list of human-readable errors ([] means valid)."""
    return validate_instance(data, load_schema())


# --- minimal JSON Schema (draft-07 subset) validator --------------------------

def validate_instance(instance: Any, schema: dict, path: str = "") -> list[str]:
    errs: list[str] = []
    where = path or "<root>"

    types = schema.get("type")
    if types is not None:
        if not _type_ok(instance, types):
            got = "null" if instance is None else type(instance).__name__
            errs.append(f"{where}: expected type {types}, got {got}")
            return errs

    if "enum" in schema and instance not in schema["enum"]:
        errs.append(f"{where}: {instance!r} not one of {schema['enum']}")

    if isinstance(instance, str):
        min_len = schema.get("minLength")
        if min_len is not None and len(instance) < min_len:
            errs.append(f"{where}: string shorter than minLength {min_len}")
        max_len = schema.get("maxLength")
        if max_len is not None and len(instance) > max_len:
            errs.append(f"{where}: string longer than maxLength {max_len}")
        pattern = schema.get("pattern")
        if pattern is not None and re.fullmatch(pattern, instance) is None:
            errs.append(f"{where}: {instance!r} does not match pattern {pattern}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errs.append(f"{where}: {instance} below minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errs.append(f"{where}: {instance} above maximum {schema['maximum']}")

    if isinstance(instance, dict):
        for req in schema.get("required", []):
            if req not in instance:
                errs.append(f"{where}: missing required '{req}'")
        for key, subschema in (schema.get("properties") or {}).items():
            if key in instance:
                child = f"{path}.{key}" if path else key
                errs += validate_instance(instance[key], subschema, child)

    if isinstance(instance, list):
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(instance):
                errs += validate_instance(item, item_schema, f"{where}[{i}]")

    return errs


def _type_ok(instance: Any, types: Any) -> bool:
    if isinstance(types, list):
        return any(_type_ok(instance, t) for t in types)
    if types == "object":
        return isinstance(instance, dict)
    if types == "array":
        return isinstance(instance, list)
    if types == "string":
        return isinstance(instance, str)
    if types == "integer":
        return isinstance(instance, int) and not isinstance(instance, bool)
    if types == "number":
        return isinstance(instance, (int, float)) and not isinstance(instance, bool)
    if types == "boolean":
        return isinstance(instance, bool)
    if types == "null":
        return instance is None
    return True
