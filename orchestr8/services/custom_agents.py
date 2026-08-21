"""Operator-authored agent roles created from the Console team panel.

Built-in agents ship in ``agents/`` and are reviewed through the Build Spec
council (ADR 0003). Roles created from the UI are operator input rather than
shipped code, so they live beside them in ``custom_agents/`` — gitignored, the
same way ``.runs/`` holds run bundles — and the registry overlays the two.

Three things are derived rather than asked for, because a role that skips them
cannot legally run:

* a contract, since AGENTS.md rule 6 requires one per agent and
  ``validate_contracts.py`` gates on it. The generated contract grants no tools
  and degrades on failure — the most conservative shape the schema allows.
* a default model, chosen from the first configured provider's fallback chain,
  so a new role is runnable without a second trip to the model picker.
* provenance (rule 2), recording that the role was operator-authored from the
  console and is unverified. Custom roles are never presented as reviewed.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CUSTOM_AGENTS_DIR = ROOT / "custom_agents"
SCHEMA_PATH = ROOT / "config" / "custom_agent.schema.json"

CONTRACT_VERSION = 2
DEFAULT_TEMPERATURE = 0.3
DEFAULT_MAX_TOKENS = 2048
# Non-core: built-in agents use tiers 1-2.
DEFAULT_TIER = 3

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


class CustomAgentError(ValueError):
    """Rejected create request — carries an operator-readable reason."""


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def slugify(name: str) -> str:
    """'Reprint Scout' -> 'reprint_scout'."""
    slug = _SLUG_STRIP.sub("_", (name or "").strip().lower()).strip("_")
    return slug


def custom_agent_dir(agent_id: str) -> Path:
    return CUSTOM_AGENTS_DIR / agent_id


def list_custom_agent_ids() -> list[str]:
    if not CUSTOM_AGENTS_DIR.exists():
        return []
    return sorted(p.parent.name for p in CUSTOM_AGENTS_DIR.glob("*/agent.yaml"))


def default_model_for_new_agent() -> tuple[str, str]:
    """(model_id, provider) — head of the first configured provider's fallbacks."""
    from services.provider_env import configured_providers
    from services.registry import load_models

    cfg = load_models()
    models = cfg.get("models") or {}
    fallbacks = cfg.get("fallbacks") or {}
    configured = configured_providers()

    for provider, chain in fallbacks.items():
        if not configured.get(provider):
            continue
        for model_id in chain or []:
            if model_id in models:
                return model_id, provider

    # No key set yet: still create the role so it is ready when a key lands.
    for provider, chain in fallbacks.items():
        for model_id in chain or []:
            if model_id in models:
                return model_id, provider
    raise CustomAgentError("Model catalog has no usable fallback model")


def validate_request(payload: dict) -> dict:
    """Schema-check the create request and return the cleaned fields."""
    from services.contracts import validate_instance

    if not isinstance(payload, dict):
        raise CustomAgentError("Request body must be a JSON object")

    cleaned = {
        key: value.strip() if isinstance(value, str) else value
        for key, value in payload.items()
        if key in {"name", "description", "skill", "defaultModel"}
    }

    errs = validate_instance(cleaned, load_schema())
    if errs:
        raise CustomAgentError("; ".join(errs))
    return cleaned


def _reserved_ids() -> set[str]:
    from services.registry import load_agents, load_registry_index

    index = load_registry_index()
    return set(load_agents()) | set(index.get("legacy_aliases") or {})


def create_custom_agent(payload: dict) -> dict:
    """Validate, write agent.yaml + contract.yaml + skill.md, return the agent id."""
    from services.registry import clear_agent_cache, load_models

    cleaned = validate_request(payload)
    name = cleaned["name"]
    agent_id = slugify(name)
    if not agent_id:
        raise CustomAgentError(f"{name!r} has no letters or digits to build an id from")

    if agent_id in _reserved_ids():
        raise CustomAgentError(
            f"Role id {agent_id!r} already exists. Pick a different name."
        )

    model_id = cleaned.get("defaultModel")
    if model_id:
        catalog = load_models().get("models") or {}
        if model_id not in catalog:
            raise CustomAgentError(f"Unknown model in catalog: {model_id}")
        provider = catalog[model_id]["provider"]
    else:
        model_id, provider = default_model_for_new_agent()

    provider_label = (
        ((load_models().get("providers") or {}).get(provider) or {}).get("label")
        or provider
    )
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    agent = {
        "id": agent_id,
        "label": name,
        "tier": DEFAULT_TIER,
        "description": cleaned["description"],
        "provider": provider,
        "provider_label": provider_label,
        "default_model": model_id,
        "allowed_models": [model_id],
        "councils": [],
        "temperature": DEFAULT_TEMPERATURE,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "skill": f"custom_agents/{agent_id}/skill.md",
        "output_schema": "standard_agent_v1",
        "enabled": True,
        "custom": True,
        "provenance": {
            "source": "console_ui",
            "method": "operator_authored",
            "contract": "auto_generated_conservative",
            "created_at": created_at,
            "verification_status": "unverified",
        },
    }

    contract = {
        "id": agent_id,
        "version": CONTRACT_VERSION,
        "mission": cleaned["description"],
        "inputs": {"task_types": ["*"], "requires_context": True},
        # Read-only tools are grantable (ADR 0003) but are not granted to a role
        # that has had no review. Widen deliberately in agent.yaml if needed.
        "allowed_tools": [],
        "outputs": {
            "schema": "standard_agent_v1",
            "required_fields": ["summary", "confidence"],
        },
        "confidence": {
            "required": True,
            "min": 0.0,
            "max": 1.0,
            "escalate_below": 0.5,
        },
        "failure_behavior": "degrade",
        "escalation": {"to": ["human"], "when": ["low_confidence"]},
        "high_impact": False,
        "enabled": True,
    }

    target = custom_agent_dir(agent_id)
    target.mkdir(parents=True, exist_ok=True)
    _write_yaml(
        target / "agent.yaml",
        agent,
        header=f"# Orchestr8 custom agent — {name}\n"
        f"# Operator-authored from the Console team panel on {created_at}.\n"
        f"# Unverified: not reviewed by a Build Spec council.\n",
    )
    _write_yaml(
        target / "contract.yaml",
        contract,
        header=f"# Orchestr8 contract — {name} (auto-generated, conservative)\n"
        f"# Schema: config/contract.schema.json\n",
    )
    (target / "skill.md").write_text(
        f"# {name}\n\n{cleaned['description']}\n\n{cleaned['skill']}\n",
        encoding="utf-8",
    )

    clear_agent_cache()
    return {"id": agent_id, "path": _display_path(target)}


def _write_yaml(path: Path, data: dict, *, header: str) -> None:
    body = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    path.write_text(header + body, encoding="utf-8")


def _display_path(path: Path) -> str:
    """Repo-relative when the file sits under orchestr8/, absolute otherwise."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_custom_agents() -> dict[str, dict]:
    """Return {agent_id: agent_meta} for every custom_agents/*/agent.yaml."""
    agents: dict[str, dict] = {}
    if not CUSTOM_AGENTS_DIR.exists():
        return agents
    for path in sorted(CUSTOM_AGENTS_DIR.glob("*/agent.yaml")):
        with open(path, encoding="utf-8") as f:
            meta = yaml.safe_load(f) or {}
        aid = meta.get("id") or path.parent.name
        meta["id"] = aid
        meta["custom"] = True
        meta["_path"] = _display_path(path)
        # Absolute, so the skill file resolves even when the custom dir is not
        # under orchestr8/ (tests, or a relocated install).
        meta["_dir"] = str(path.parent)
        agents[aid] = meta
    return agents
