"""Cost-aware planner — recommend council, team size, and per-agent models.

Given a task + question and a budget/quality target, return a runnable plan
(roles, mode, council, model_overrides) with an estimated USD cost and rationale.
This is a heuristic v1 (deterministic, no LLM call) so planning itself is free.
The caller can submit the returned plan to /v1/jobs unchanged.

Optimization goal: the *minimum* configuration that clears the quality bar,
then spend up only if the budget allows and the task is high-stakes.
"""
from __future__ import annotations

from services.registry import (
    get_council,
    load_agents,
    load_councils,
    load_models,
    usd_cost,
)

# Task-intent keyword → council routing.
_INTENT = {
    "discovery": ("find", "discover", "signal", "acquire", "acquisition", "lead", "opportunity", "hunt"),
    "analysis": ("price", "value", "roi", "return", "liquidity", "forecast", "invest", "worth", "appraise"),
    "challenge": ("verify", "risk", "challenge", "double-check", "stress", "wrong", "safe"),
    "curation": ("pillar", "thesis", "grade", "curate", "collection identity", "sell timing"),
    "build_spec": ("build spec", "work order", "implement", "cursor prompt", "file plan", "acceptance test"),
}
# Words that signal a high-stakes decision (justifies board / stronger models).
_HIGH_STAKES = ("sell", "liquidate", "buy", "acquire", "insure", "large", "expensive", "museum", "grail")

_QUALITY_LEVELS = ("min", "balanced", "max")

# Rough token model for estimation (chars/4 ≈ tokens).
_SYS_TOKENS = 700          # skill.md + contract per agent
_OUT_TOKENS = 700          # typical agent output
_SYNTH_OUT = 900


def _ctx_tokens(context_json: str) -> int:
    return max(50, len(context_json or "{}") // 4)


def _intent(question: str) -> str:
    q = (question or "").lower()
    for council_id, words in _INTENT.items():
        if any(w in q for w in words):
            return council_id
    return "analysis"


def _high_stakes(question: str) -> bool:
    q = (question or "").lower()
    return any(w in q for w in _HIGH_STAKES)


def _price(model_id: str, models: dict) -> float:
    m = models.get(model_id, {})
    return float(m.get("price_in", 0.0)) + float(m.get("price_out", 0.0))


def _pick_model(agent_meta: dict, quality: str, models: dict) -> str:
    allowed = agent_meta.get("allowed_models") or [agent_meta["default_model"]]
    allowed = [m for m in allowed if m in models] or [agent_meta["default_model"]]
    if quality == "min":
        return min(allowed, key=lambda m: _price(m, models))
    if quality == "max":
        return max(allowed, key=lambda m: _price(m, models))
    return agent_meta["default_model"]


def _estimate(roles: list[str], mode: str, overrides: dict, ctx_tokens: int) -> dict:
    """Estimate tokens + USD cost for a candidate plan."""
    agents = load_agents()
    total_cost = 0.0
    total_tokens = 0
    prior_out = 0  # accumulates in pipeline (later agents read earlier output)
    for rid in roles:
        meta = agents.get(rid)
        if not meta:
            continue
        model_id = overrides.get(rid) or meta["default_model"]
        inp = ctx_tokens + _SYS_TOKENS + (prior_out if mode == "pipeline" else 0)
        out = _OUT_TOKENS
        total_cost += usd_cost(model_id, inp, out)
        total_tokens += inp + out
        if mode == "pipeline":
            prior_out += out
    # synthesis pass for multi-agent runs
    if len(roles) > 1:
        synth = roles[-1]
        meta = agents.get(synth)
        if meta:
            model_id = overrides.get(synth) or meta["default_model"]
            inp = ctx_tokens + _SYS_TOKENS + prior_out + _OUT_TOKENS * len(roles)
            total_cost += usd_cost(model_id, inp, _SYNTH_OUT)
            total_tokens += inp + _SYNTH_OUT
    return {"costUsd": round(total_cost, 6), "tokens": total_tokens}


def plan_job(
    *,
    task: str,
    question: str,
    context_json: str = "{}",
    budget_usd: float | None = None,
    quality: str = "balanced",
    max_agents: int | None = None,
    prefer_council: str | None = None,
) -> dict:
    quality = quality if quality in _QUALITY_LEVELS else "balanced"
    models = load_models().get("models") or {}
    agents = load_agents()
    ctx_tokens = _ctx_tokens(context_json)

    # 1. Route to a council.
    if task == "build_spec":
        council_id = prefer_council or "build_spec"
    else:
        council_id = prefer_council or _intent(question)
    stakes = _high_stakes(question)
    if stakes and quality == "max":
        council_id = "board"
    council = get_council(council_id) or {}
    roles = [r for r in (council.get("agents") or []) if r in agents]
    if not roles:
        council_id = "analysis"
        council = get_council("analysis") or {}
        roles = [r for r in (council.get("agents") or []) if r in agents]
    mode = council.get("mode", "parallel")

    rationale = [
        f"Intent → {council_id} council ({council.get('purpose', '')}).",
        f"Quality target: {quality}." + (" High-stakes decision detected." if stakes else ""),
    ]

    # 2. Initial model selection by quality.
    overrides = {r: _pick_model(agents[r], quality, models) for r in roles}

    # 3. Respect max_agents (keep the highest-value members = earliest in council list).
    if max_agents and len(roles) > max_agents:
        roles = roles[:max_agents]
        overrides = {r: overrides[r] for r in roles}
        rationale.append(f"Trimmed to {max_agents} agents by request.")

    est = _estimate(roles, mode, overrides, ctx_tokens)

    # 4. Cost gate: downgrade models, then drop agents, until within budget.
    downgraded = False
    if budget_usd is not None:
        # 4a. Downgrade every agent to its cheapest allowed model.
        guard = 0
        while est["costUsd"] > budget_usd and not downgraded:
            for r in roles:
                overrides[r] = _pick_model(agents[r], "min", models)
            downgraded = True
            est = _estimate(roles, mode, overrides, ctx_tokens)
            guard += 1
            if guard > 2:
                break
        if downgraded:
            rationale.append("Downgraded models to economy tier to fit budget.")
        # 4b. Still over? Drop lowest-priority agents (from the tail).
        while est["costUsd"] > budget_usd and len(roles) > 1:
            dropped = roles.pop()
            overrides.pop(dropped, None)
            est = _estimate(roles, mode, overrides, ctx_tokens)
            rationale.append(f"Dropped {dropped} to fit budget.")
        if len(roles) == 1:
            mode = "single"
        within = est["costUsd"] <= budget_usd
        rationale.append(
            f"Estimated ${est['costUsd']:.4f} vs budget ${budget_usd:.4f} — "
            + ("within budget." if within else "cannot meet budget even minimized.")
        )

    return {
        "task": task,
        "council": council_id if len(roles) > 1 else None,
        "roles": roles,
        "mode": mode if len(roles) > 1 else "single",
        "modelOverrides": overrides,
        "quality": quality,
        "highStakes": stakes,
        "estimate": est,
        "budgetUsd": budget_usd,
        "withinBudget": (budget_usd is None) or (est["costUsd"] <= budget_usd),
        "rationale": rationale,
    }
