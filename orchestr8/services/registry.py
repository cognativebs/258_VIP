"""Agent registry — load agent.yaml, models.yaml, councils.yaml."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = ROOT / "agents"
CONFIG_DIR = ROOT / "config"
MODELS_SCHEMA_PATH = CONFIG_DIR / "models.schema.json"


def _read_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@lru_cache(maxsize=1)
def load_models() -> dict:
    return _read_yaml(CONFIG_DIR / "models.yaml")


@lru_cache(maxsize=1)
def load_councils() -> dict:
    """Shipped YAML plus operator-saved councils. Custom ids never shadow shipped."""
    shipped = _read_yaml(CONFIG_DIR / "councils.yaml")
    councils = dict(shipped.get("councils") or {})
    from services.custom_councils import load_custom_councils

    for cid, meta in load_custom_councils().items():
        if cid in councils:
            continue
        councils[cid] = meta
    return {"councils": councils}


@lru_cache(maxsize=1)
def load_registry_index() -> dict:
    path = AGENTS_DIR / "registry.yaml"
    if path.exists():
        return _read_yaml(path)
    return {"pipeline_order": [], "legacy_aliases": {}}


@lru_cache(maxsize=1)
def load_agents() -> dict[str, dict]:
    """Return {agent_id: agent_meta} from agents/*/agent.yaml plus custom roles.

    Operator-authored roles from custom_agents/ overlay last and win on id
    collision, so a Console edit of a shipped role takes effect without
    rewriting git-tracked files. Creating a *new* role with a reserved id is
    still refused in create_custom_agent().
    """
    from services.custom_agents import load_custom_agents

    agents: dict[str, dict] = {}
    if AGENTS_DIR.exists():
        for path in sorted(AGENTS_DIR.glob("*/agent.yaml")):
            meta = _read_yaml(path)
            aid = meta.get("id") or path.parent.name
            meta["id"] = aid
            meta["_path"] = str(path.relative_to(ROOT))
            agents[aid] = meta

    for aid, meta in load_custom_agents().items():
        agents[aid] = meta
    return agents


def clear_agent_cache() -> None:
    load_models.cache_clear()
    load_models_schema.cache_clear()
    load_councils.cache_clear()
    load_registry_index.cache_clear()
    load_agents.cache_clear()


def resolve_agent_id(agent_id: str) -> str:
    """Map legacy role ids (code_writer, qc_qa, …) to registry agents."""
    aliases = load_registry_index().get("legacy_aliases") or {}
    return aliases.get(agent_id, agent_id)


def get_agent(agent_id: str) -> dict:
    agents = load_agents()
    resolved = resolve_agent_id(agent_id)
    if resolved not in agents:
        raise ValueError(f"Unknown agent: {agent_id}")
    return agents[resolved]


def load_skill_text(agent_id: str, *, brief: bool = False) -> str:
    meta = get_agent(agent_id)
    key = "skill_brief" if brief else "skill"
    rel = meta.get(key) or meta.get("skill")
    if not rel:
        return ""
    candidates = []
    # A custom role keeps its skill beside its agent.yaml, which is not always
    # under orchestr8/ — prefer the directory the agent was loaded from.
    if meta.get("_dir"):
        candidates.append(Path(meta["_dir"]) / Path(rel).name)
    candidates.append(ROOT / rel)
    for path in candidates:
        if path.exists():
            return path.read_text(encoding="utf-8")
    return ""


@lru_cache(maxsize=1)
def load_models_schema() -> dict:
    return json.loads(MODELS_SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_model_catalog() -> list[str]:
    """Return human-readable problems with models.yaml ([] means valid).

    Every catalog model is selectable by every agent, so a malformed entry is a
    gateway-wide fault rather than one role's problem — this is the gate that
    keeps a bad edit from surfacing as a provider 400 mid-run.
    """
    from services.contracts import validate_instance

    schema = load_models_schema()
    cfg = load_models()
    errs = validate_instance(cfg, schema)

    provider_schema = schema["definitions"]["provider"]
    for pid, meta in (cfg.get("providers") or {}).items():
        errs += validate_instance(meta, provider_schema, f"providers.{pid}")

    model_schema = schema["definitions"]["model"]
    known_providers = set(cfg.get("providers") or {})
    for mid, meta in (cfg.get("models") or {}).items():
        errs += validate_instance(meta, model_schema, f"models.{mid}")
        provider = (meta or {}).get("provider")
        if provider and provider not in known_providers:
            errs.append(f"models.{mid}: provider {provider!r} has no providers entry")

    catalog = set(cfg.get("models") or {})
    for pid, chain in (cfg.get("fallbacks") or {}).items():
        for mid in chain or []:
            if mid not in catalog:
                errs.append(f"fallbacks.{pid}: {mid!r} is not in the catalog")

    return errs


@lru_cache(maxsize=1)
def load_models_schema() -> dict:
    return json.loads(MODELS_SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_model_catalog() -> list[str]:
    """Return human-readable problems with models.yaml ([] means valid).

    Every catalog model is selectable by every agent, so a malformed entry is a
    gateway-wide fault rather than one role's problem — this is the gate that
    keeps a bad edit from surfacing as a provider 400 mid-run.
    """
    from services.contracts import validate_instance

    schema = load_models_schema()
    cfg = load_models()
    errs = validate_instance(cfg, schema)

    provider_schema = schema["definitions"]["provider"]
    for pid, meta in (cfg.get("providers") or {}).items():
        errs += validate_instance(meta, provider_schema, f"providers.{pid}")

    model_schema = schema["definitions"]["model"]
    known_providers = set(cfg.get("providers") or {})
    for mid, meta in (cfg.get("models") or {}).items():
        errs += validate_instance(meta, model_schema, f"models.{mid}")
        provider = (meta or {}).get("provider")
        if provider and provider not in known_providers:
            errs.append(f"models.{mid}: provider {provider!r} has no providers entry")

    catalog = set(cfg.get("models") or {})
    for pid, chain in (cfg.get("fallbacks") or {}).items():
        for mid in chain or []:
            if mid not in catalog:
                errs.append(f"fallbacks.{pid}: {mid!r} is not in the catalog")

    return errs


def model_pricing(model_id: str) -> dict[str, float]:
    """Return {'in': usd_per_1M, 'out': usd_per_1M} for a model (0 if unknown)."""
    m = (load_models().get("models") or {}).get(model_id, {})
    return {"in": float(m.get("price_in", 0.0)), "out": float(m.get("price_out", 0.0))}


def usd_cost(model_id: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate request cost in USD from token counts and catalog pricing."""
    p = model_pricing(model_id)
    return round((input_tokens / 1_000_000) * p["in"] + (output_tokens / 1_000_000) * p["out"], 6)


def recommended_models(agent_id: str) -> list[str]:
    """The agent's curated short list — surfaced first in pickers, not a gate."""
    meta = get_agent(agent_id)
    return list(meta.get("allowed_models") or [meta["default_model"]])


def resolve_model(agent_id: str, override: str | None = None) -> dict[str, Any]:
    """Pick the model for an agent.

    Any catalog model may be assigned to any agent, including one from a
    different provider than the agent's home provider — the provider is taken
    from the catalog entry, so the request is dispatched to whichever API owns
    the chosen model. The agent's ``allowed_models`` is a recommendation and is
    reported as ``recommended`` rather than enforced.
    """
    meta = get_agent(agent_id)
    models_cfg = load_models()
    models = models_cfg.get("models") or {}
    provider_meta = models_cfg.get("providers") or {}
    model_id = override or meta["default_model"]
    if model_id not in models:
        raise ValueError(
            f"Unknown model in catalog: {model_id}. "
            f"Add it to config/models.yaml, then POST /v1/reload."
        )
    recommended = recommended_models(agent_id)
    catalog = models[model_id]
    provider = catalog["provider"]
    return {
        "agent": meta["id"],
        "provider": provider,
        "provider_label": (provider_meta.get(provider) or {}).get("label")
        or meta.get("provider_label")
        or provider,
        "model": model_id,
        "model_label": catalog.get("label", model_id),
        "temperature": meta.get("temperature", 0.3),
        "max_tokens": meta.get("max_tokens", 2048),
        "default_model": meta["default_model"],
        "allowed_models": recommended,
        "recommended": model_id in recommended,
        "home_provider": meta["provider"],
        "price_in": float(catalog.get("price_in", 0.0)),
        "price_out": float(catalog.get("price_out", 0.0)),
    }


def agents_public_list() -> list[dict]:
    """API-safe agent list for IQVault team panel.

    ``allowedModels`` is the whole catalog: every model can be assigned to every
    agent. Each entry carries ``recommended`` (on the agent's curated short list)
    and ``configured`` (that model's provider has a key), so a picker can mark
    the house pick and grey out providers with no key.
    """
    from services.roles import configured_providers

    providers = configured_providers()
    models = load_models().get("models") or {}
    out = []
    for aid, meta in load_agents().items():
        if meta.get("enabled") is False:
            continue
        recommended = meta.get("allowed_models") or [meta["default_model"]]
        selectable = [
            {
                "id": mid,
                "label": m.get("label", mid),
                "provider": m.get("provider"),
                "tier": m.get("tier"),
                "cost": m.get("cost"),
                "context": m.get("context"),
                "recommended": mid in recommended,
                "configured": providers.get(m.get("provider"), False),
            }
            for mid, m in models.items()
        ]
        out.append(
            {
                "id": aid,
                "label": meta["label"],
                "tier": meta.get("tier"),
                "description": meta.get("description", ""),
                "provider": meta["provider"],
                "providerLabel": meta.get("provider_label", meta["provider"]),
                "defaultModel": meta["default_model"],
                "allowedModels": selectable,
                "recommendedModels": list(recommended),
                "councils": meta.get("councils") or [],
                "configured": providers.get(meta["provider"], False),
                "custom": bool(meta.get("custom")) and not _is_shipped(aid),
                "edited": bool(meta.get("custom")) and _is_shipped(aid),
                "verificationStatus": (meta.get("provenance") or {}).get(
                    "verification_status"
                ),
            }
        )
    return out


def _is_shipped(agent_id: str) -> bool:
    return (AGENTS_DIR / agent_id / "agent.yaml").exists()


def agent_public_detail(agent_id: str) -> dict:
    """List card plus the skill text the editor needs."""
    resolved = resolve_agent_id(agent_id)
    card = next((a for a in agents_public_list() if a["id"] == resolved), None)
    if card is None:
        raise ValueError(f"Unknown agent: {agent_id}")
    return {**card, "skill": load_skill_text(resolved)}


def get_council(council_id: str) -> dict | None:
    return (load_councils().get("councils") or {}).get(council_id)


def councils_public_list() -> list[dict]:
    cfg = load_councils().get("councils") or {}
    return [
        {
            "id": c.get("id", kid),
            "label": c.get("label", kid),
            "purpose": c.get("purpose", ""),
            "mode": c.get("mode", "parallel"),
            "agents": c.get("agents") or [],
            "voting": c.get("voting"),
            "outputOwner": c.get("output_owner"),
            "gate": c.get("gate"),
            "custom": bool(c.get("custom")),
            "verificationStatus": (c.get("provenance") or {}).get(
                "verification_status"
            ),
        }
        for kid, c in cfg.items()
    ]


def models_public_list() -> dict:
    cfg = load_models()
    models = []
    for mid, meta in (cfg.get("models") or {}).items():
        models.append(
            {
                "id": mid,
                "label": meta.get("label", mid),
                "provider": meta["provider"],
                "tier": meta.get("tier"),
                "cost": meta.get("cost"),
                "context": meta.get("context"),
                "priceIn": float(meta.get("price_in", 0.0)),
                "priceOut": float(meta.get("price_out", 0.0)),
                "strengths": meta.get("strengths") or [],
            }
        )
    return {
        "providers": cfg.get("providers") or {},
        "models": models,
        "fallbacks": cfg.get("fallbacks") or {},
        "currency": cfg.get("currency", "USD"),
        "pricingNote": cfg.get("pricing_note", ""),
    }


def pipeline_order() -> list[str]:
    idx = load_registry_index().get("pipeline_order")
    if idx:
        return list(idx)
    return list(load_agents().keys())
