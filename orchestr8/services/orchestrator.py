"""Multi-agent orchestration — driven by agents/*/agent.yaml + skill.md."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from providers.llm import chat_role
from services.registry import (
    get_agent,
    get_council,
    load_skill_text,
    pipeline_order,
    resolve_agent_id,
    resolve_model,
    usd_cost,
)
from services.roles import task_system
from services.structured import extract_structured, normalize_confidence
from services.voting import apply_gate, evaluate_votes


def sort_agent_ids(agent_ids: list[str]) -> list[str]:
    order = pipeline_order()
    rank = {r: i for i, r in enumerate(order)}
    return sorted(agent_ids, key=lambda r: rank.get(r, 999))


def _build_system(agent_id: str, task: str) -> str:
    skill = load_skill_text(agent_id, brief=False) or load_skill_text(agent_id, brief=True)
    meta = get_agent(agent_id)
    parts = []
    if skill.strip():
        parts.append(skill.strip())
    else:
        parts.append(
            f"You are the {meta['label']} on the Orchestr8 collectible intelligence team.\n"
            f"{meta.get('description', '')}\n"
            "Be concise, structured, and evidence-based. Report confidence."
        )
    task_ctx = task_system(task)
    if task_ctx:
        parts.append(task_ctx.strip())
    parts.append(
        "OUTPUT CONTRACT:\n"
        "1. Write concise, collector-facing findings in prose first.\n"
        "2. Then append a single fenced ```json code block that conforms to your "
        "agent's JSON Output Schema (shown above). If your schema is not shown, use "
        '{"agent": "<your role>", "summary": "<one line>", "confidence": 0.0}.\n'
        "3. Always include a top-level numeric \"confidence\" between 0.0 and 1.0. "
        "If you assess/reject a recommendation, include a \"verdict\" of "
        '"approve", "conditional", or "reject". The JSON is parsed by the system; '
        "keep it valid."
    )
    return "\n\n".join(parts)


def _build_user_prompt(
    *,
    agent_id: str,
    task: str,
    question: str,
    context_json: str,
    trace: list[dict],
    mode: str,
) -> str:
    meta = get_agent(agent_id)
    parts = [
        f"TASK TYPE: {task}",
        f"YOUR ROLE: {meta['label']} ({agent_id})",
        "",
        "--- USER QUESTION ---",
        question,
        "",
        "--- COLLECTION CONTEXT (JSON) ---",
        context_json or "{}",
    ]
    if trace:
        parts.append("\n--- PRIOR TEAM OUTPUT ---")
        for step in trace:
            model = step.get("model", "")
            parts.append(
                f"\n[{step['role_label']} / {step['provider']}"
                f"{(' / ' + model) if model else ''}]:\n{step['text']}"
            )
    if mode == "parallel" and agent_id not in ("project_manager", "orchestrator", "synthesizer"):
        parts.append("\nNote: You are working in parallel with other roles. Focus on your specialty.")
    # Cost-aware coordination: give the orchestrator/PM/synthesizer the running
    # spend so it can weigh marginal cost against decision value.
    if agent_id in ("project_manager", "orchestrator", "synthesizer") and trace:
        spent = sum(s.get("costUsd", 0.0) or 0.0 for s in trace)
        toks = sum((s.get("usage") or {}).get("total", 0) for s in trace)
        parts.append(
            "\n--- COST CONTEXT ---\n"
            f"Team spend so far this job: ${spent:.4f} across {toks:,} tokens. "
            "Weigh marginal cost against decision value; recommend the minimum "
            "viable escalation and flag if further agents/models aren't worth the spend."
        )
    return "\n".join(parts)


def _run_agent(
    agent_id: str,
    *,
    task: str,
    question: str,
    context_json: str,
    trace: list[dict],
    mode: str,
    model_override: str | None = None,
) -> dict:
    resolved = resolve_agent_id(agent_id)
    meta = get_agent(resolved)
    routed = resolve_model(resolved, model_override)
    system = _build_system(resolved, task)
    user = _build_user_prompt(
        agent_id=resolved,
        task=task,
        question=question,
        context_json=context_json,
        trace=trace,
        mode=mode,
    )
    step = {
        "role": resolved,
        "role_label": meta["label"],
        "provider": routed["provider"],
        "provider_label": routed["provider_label"],
        "model": routed["model"],
        "model_label": routed.get("model_label", routed["model"]),
        "temperature": routed.get("temperature"),
    }
    try:
        result = chat_role(
            provider=routed["provider"],
            model=routed["model"],
            system=system,
            user=user,
            temperature=routed.get("temperature", 0.3),
            max_tokens=routed.get("max_tokens", 2048),
        )
    except Exception as e:
        # Degrade gracefully: one agent failing must not sink the whole job.
        step["text"] = f"[{meta['label']} unavailable: {e}]"
        step["error"] = str(e)
        step["usage"] = {"input": 0, "output": 0, "total": 0}
        return step

    prose, structured = extract_structured(result["text"])
    step["text"] = prose
    usage = result.get("usage") or {"input": 0, "output": 0, "total": 0}
    step["usage"] = usage
    step["costUsd"] = usd_cost(routed["model"], usage.get("input", 0), usage.get("output", 0))
    if structured is not None:
        step["structured"] = structured
        conf = normalize_confidence(structured.get("confidence"))
        if conf is not None:
            step["confidence"] = conf
        verdict = structured.get("verdict")
        if isinstance(verdict, str) and verdict:
            step["verdict"] = verdict
    return step


def _finalize(
    *,
    text: str,
    trace: list[dict],
    mode: str,
    roles: list[str],
    overrides: dict,
    council: str | None,
) -> dict:
    council_meta = get_council(council) if council else None
    vote = evaluate_votes(trace, council_meta)
    gated = apply_gate(text, vote)
    return {
        "text": gated,
        "trace": trace,
        "mode": mode,
        "roles": roles,
        "modelOverrides": overrides,
        "usage": _aggregate_usage(trace),
        "council": council,
        "vote": vote,
    }


def _aggregate_usage(trace: list[dict]) -> dict:
    total = {"input": 0, "output": 0, "total": 0}
    cost = 0.0
    by_provider: dict[str, dict] = {}
    for step in trace:
        u = step.get("usage") or {}
        total["input"] += u.get("input", 0)
        total["output"] += u.get("output", 0)
        total["total"] += u.get("total", 0)
        c = step.get("costUsd", 0.0) or 0.0
        cost += c
        prov = step.get("provider", "unknown")
        bp = by_provider.setdefault(prov, {"tokens": 0, "costUsd": 0.0})
        bp["tokens"] += u.get("total", 0)
        bp["costUsd"] = round(bp["costUsd"] + c, 6)
    total["steps"] = len(trace)
    total["errors"] = sum(1 for s in trace if s.get("error"))
    total["costUsd"] = round(cost, 6)
    total["byProvider"] = by_provider
    return total


def _synthesizer_id(agent_ids: list[str]) -> str:
    for preferred in ("synthesizer", "project_manager", "orchestrator", "researcher"):
        if preferred in agent_ids:
            return preferred
    return sort_agent_ids(agent_ids)[-1]


def _coordinator_id(agent_ids: list[str]) -> str | None:
    for preferred in ("project_manager", "orchestrator", "synthesizer"):
        if preferred in agent_ids:
            return preferred
    return None


def run_job(
    *,
    task: str,
    roles: list[str],
    mode: str,
    question: str,
    context_json: str,
    model_overrides: dict[str, str] | None = None,
    council: str | None = None,
    on_step=None,
) -> dict:
    """Execute a job, then persist an immutable run bundle (ADR 0002 · O0)."""
    result = _execute_job(
        task=task,
        roles=roles,
        mode=mode,
        question=question,
        context_json=context_json,
        model_overrides=model_overrides,
        council=council,
        on_step=on_step,
    )
    _persist_run(result, task=task, question=question, context_json=context_json)
    return result


def _persist_run(result: dict, *, task: str, question: str, context_json: str) -> None:
    # Persistence must never break a job; a failed write is logged, not raised.
    try:
        from services.runstore import build_bundle, persist_run, persistence_enabled

        if not persistence_enabled():
            return
        bundle = build_bundle(
            result=result,
            task=task,
            question=question,
            context_json=context_json,
        )
        path = persist_run(bundle)
        result["runId"] = bundle["run_id"]
        result["runPath"] = str(path)
    except Exception as e:  # noqa: BLE001
        import sys

        sys.stderr.write(f"[orchestr8] run persistence skipped: {e}\n")


def _execute_job(
    *,
    task: str,
    roles: list[str],
    mode: str,
    question: str,
    context_json: str,
    model_overrides: dict[str, str] | None = None,
    council: str | None = None,
    on_step=None,
) -> dict:
    if not roles:
        raise ValueError("At least one role is required")
    if not question.strip():
        raise ValueError("question is required")

    def emit(step: dict) -> None:
        if on_step:
            try:
                on_step(step)
            except Exception:  # noqa: BLE001 — streaming must never break the job
                pass

    overrides = model_overrides or {}
    # Resolve legacy ids (qc_qa → critic) then de-dupe
    unique = []
    seen = set()
    for rid in roles:
        resolved = resolve_agent_id(rid)
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    unique = sort_agent_ids(unique)
    trace: list[dict] = []

    def override_for(aid: str) -> str | None:
        return overrides.get(aid) or overrides.get(resolve_agent_id(aid))

    if len(unique) == 1 or mode == "single":
        step = _run_agent(
            unique[0],
            task=task,
            question=question,
            context_json=context_json,
            trace=[],
            mode="single",
            model_override=override_for(unique[0]),
        )
        emit(step)
        return _finalize(
            text=step["text"],
            trace=[step],
            mode="single",
            roles=unique,
            overrides={k: v for k, v in overrides.items() if resolve_agent_id(k) in unique},
            council=council,
        )

    coordinator = _coordinator_id(unique)
    workers = [r for r in unique if r != coordinator]

    if mode == "parallel" and len(workers) > 1:
        parallel_results: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(6, len(workers))) as pool:
            futures = [
                pool.submit(
                    _run_agent,
                    rid,
                    task=task,
                    question=question,
                    context_json=context_json,
                    trace=[],
                    mode="parallel",
                    model_override=override_for(rid),
                )
                for rid in workers
            ]
            for fut in as_completed(futures):
                res = fut.result()
                parallel_results.append(res)
                emit(res)
        order = {r: i for i, r in enumerate(sort_agent_ids([t["role"] for t in parallel_results]))}
        parallel_results.sort(key=lambda t: order.get(t["role"], 99))
        trace.extend(parallel_results)

        synth_id = coordinator or _synthesizer_id(unique)
        synth = _run_agent(
            synth_id,
            task=task,
            question=f"Synthesize a final answer for the collector.\n\nOriginal question: {question}",
            context_json=context_json,
            trace=trace,
            mode="pipeline",
            model_override=override_for(synth_id),
        )
        label = get_agent(synth_id)["label"]
        synth_step = {**synth, "role_label": f"{label} (Synthesis)"}
        trace.append(synth_step)
        emit(synth_step)
        return _finalize(
            text=synth["text"],
            trace=trace,
            mode="parallel",
            roles=unique,
            overrides=overrides,
            council=council,
        )

    # pipeline
    execution_order = list(unique)
    council_meta = get_council(council) if council else None
    # No coordinator? Let the council's output_owner speak last so the final
    # voice is authoritative (e.g. Challenge Council → Critic), free of a re-run.
    if not coordinator and council_meta:
        owner = council_meta.get("output_owner")
        if owner in execution_order:
            execution_order = [r for r in execution_order if r != owner] + [owner]
    if coordinator:
        plan = _run_agent(
            coordinator,
            task=task,
            question=question,
            context_json=context_json,
            trace=[],
            mode="pipeline",
            model_override=override_for(coordinator),
        )
        label = get_agent(coordinator)["label"]
        plan_step = {**plan, "role_label": f"{label} (Plan)"}
        trace.append(plan_step)
        emit(plan_step)
        execution_order = [r for r in execution_order if r != coordinator]

    for agent_id in execution_order:
        step = _run_agent(
            agent_id,
            task=task,
            question=question,
            context_json=context_json,
            trace=trace,
            mode="pipeline",
            model_override=override_for(agent_id),
        )
        trace.append(step)
        emit(step)

    if coordinator:
        synth = _run_agent(
            coordinator,
            task=task,
            question=f"Write the final collector-facing answer.\n\nOriginal question: {question}",
            context_json=context_json,
            trace=trace,
            mode="pipeline",
            model_override=override_for(coordinator),
        )
        label = get_agent(coordinator)["label"]
        final_step = {**synth, "role_label": f"{label} (Final)"}
        trace.append(final_step)
        emit(final_step)
        final_text = synth["text"]
    else:
        final_text = trace[-1]["text"] if trace else ""

    return _finalize(
        text=final_text,
        trace=trace,
        mode="pipeline",
        roles=unique,
        overrides=overrides,
        council=council,
    )
