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
    """Legacy roles.yaml - kept for task_systems and backward-compatible /v1/roles."""
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


def _env_key(*names: str) -> str | None:
    """First non-empty env var among names (strip whitespace / surrounding quotes)."""
    for name in names:
        raw = os.environ.get(name)
        if raw is None:
            continue
        val = raw.strip().strip('"').strip("'")
        if val:
            return val
    return None


def provider_keys() -> dict[str, str | None]:
    # Grok chat keys are XAI_API_KEY; accept GROK_API_KEY as a common alias.
    return {
        "openai": _env_key("OPENAI_API_KEY"),
        "anthropic": _env_key("ANTHROPIC_API_KEY"),
        "grok": _env_key("XAI_API_KEY", "GROK_API_KEY"),
    }


def configured_providers() -> dict[str, bool]:
    keys = provider_keys()
    return {k: bool(v) for k, v in keys.items()}


def provider_key_warnings(keys: dict[str, str | None] | None = None) -> list[str]:
    """Detect swapped / mislabeled keys (the usual sk-ant- in OPENAI mix-up)."""
    keys = keys if keys is not None else provider_keys()
    warnings: list[str] = []
    openai = keys.get("openai") or ""
    anthropic = keys.get("anthropic") or ""
    grok = keys.get("grok") or ""

    if openai.startswith("sk-ant-"):
        warnings.append(
            "OPENAI_API_KEY looks like an Anthropic key (sk-ant-...). "
            "Move it to ANTHROPIC_API_KEY."
        )
    if openai.startswith("xai-"):
        warnings.append(
            "OPENAI_API_KEY looks like an xAI key (xai-...). Move it to XAI_API_KEY."
        )
    if anthropic and not anthropic.startswith("sk-ant-") and anthropic.startswith("sk-"):
        warnings.append(
            "ANTHROPIC_API_KEY looks like an OpenAI key (sk-... without sk-ant-). "
            "Move it to OPENAI_API_KEY."
        )
    if anthropic.startswith("xai-"):
        warnings.append(
            "ANTHROPIC_API_KEY looks like an xAI key (xai-...). Move it to XAI_API_KEY."
        )
    if grok.startswith("sk-ant-"):
        warnings.append(
            "XAI_API_KEY looks like an Anthropic key (sk-ant-...). "
            "Move it to ANTHROPIC_API_KEY."
        )
    if grok.startswith("sk-") and not grok.startswith("sk-ant-"):
        warnings.append(
            "XAI_API_KEY looks like an OpenAI key (sk-...). Move it to OPENAI_API_KEY."
        )
    return warnings


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
