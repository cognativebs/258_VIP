"""Load legacy roles.yaml helpers + provider keys. Agent metadata lives in agents/*/agent.yaml."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

_CONFIG: dict | None = None


def load_config() -> dict:
    """Legacy roles.yaml — kept for task_systems and backward-compatible /v1/roles."""
    global _CONFIG
    if _CONFIG is None:
        with open(ROOT / "config" / "roles.yaml", encoding="utf-8") as f:
            _CONFIG = yaml.safe_load(f)
    return _CONFIG


def get_role(role_id: str) -> dict:
    """Prefer agent registry; fall back to legacy roles.yaml."""
    try:
        from services.registry import get_agent, resolve_agent_id, resolve_model

        agent = get_agent(resolve_agent_id(role_id))
        routed = resolve_model(agent["id"])
        return {
            "provider": routed["provider"],
            "model": routed["model"],
            "label": agent["label"],
            "provider_label": routed["provider_label"],
            "description": agent.get("description", ""),
            "system": "",  # skill.md loaded by orchestrator
        }
    except Exception:
        roles = load_config()["roles"]
        if role_id not in roles:
            raise ValueError(f"Unknown role: {role_id}") from None
        return roles[role_id]


def pipeline_order() -> list[str]:
    try:
        from services.registry import pipeline_order as registry_pipeline

        order = registry_pipeline()
        if order:
            return order
    except Exception:
        pass
    return load_config()["pipeline_order"]


def task_system(task: str) -> str:
    return load_config().get("task_systems", {}).get(task, "")


def provider_keys() -> dict[str, str | None]:
    return {
        "openai": os.environ.get("OPENAI_API_KEY"),
        "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
        "grok": os.environ.get("XAI_API_KEY"),
    }


def configured_providers() -> dict[str, bool]:
    keys = provider_keys()
    return {k: bool(v) for k, v in keys.items()}


def sort_roles(role_ids: list[str]) -> list[str]:
    order = pipeline_order()
    rank = {r: i for i, r in enumerate(order)}
    return sorted(role_ids, key=lambda r: rank.get(r, 999))


def roles_for_provider(provider: str) -> list[str]:
    try:
        from services.registry import load_agents

        return [aid for aid, meta in load_agents().items() if meta.get("provider") == provider]
    except Exception:
        cfg = load_config()["roles"]
        return [rid for rid, meta in cfg.items() if meta["provider"] == provider]
