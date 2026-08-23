"""Multi-agent orchestration — driven by agents/*/agent.yaml + skill.md."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from providers.llm import _is_openai_reasoning, chat_role
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
    repo_context = ""
    collection_ctx = context_json or "{}"
    attached_block = ""
    try:
        import json

        from services.operator_attachments import (
            attachments_from_context_json,
            format_for_prompt,
            summarize_for_collection_json,
        )

        parsed = json.loads(context_json) if context_json else {}
        if isinstance(parsed, dict):
            if task == "build_spec" and parsed.get("repoContext"):
                repo_context = str(parsed.get("repoContext"))
                rest = {k: v for k, v in parsed.items() if k != "repoContext"}
            else:
                rest = parsed
            collection_ctx = json.dumps(summarize_for_collection_json(rest))
        attached_block = format_for_prompt(attachments_from_context_json(context_json))
    except Exception:  # noqa: BLE001 — attachment formatting must never break a job
        pass

    parts = [
        f"TASK TYPE: {task}",
        f"YOUR ROLE: {meta['label']} ({agent_id})",
        "",
        "--- USER QUESTION ---",
        question,
        "",
        "--- COLLECTION CONTEXT (JSON) ---",
        collection_ctx,
    ]
    if repo_context:
        parts += ["", "--- REPO CONTEXT (read-only tools) ---", repo_context]
    if attached_block:
        parts += ["", attached_block]
    if task == "build_spec":
        parts.append(
            "\n--- BUILD SPEC RULES ---\n"
            "Author a critic-passable work order for Cursor. Schemas/contracts first. "
            "Ground every path in REPO CONTEXT. Append a fenced ```json build_spec block "
            '(include "schema": "build_spec_v1").'
        )
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
    max_tokens = int(routed.get("max_tokens", 2048) or 2048)
    # GPT-5.x / o-series spend hidden reasoning tokens against the same cap.
    # A 2048 budget often returns empty content (finish_reason=length).
    if routed.get("provider") == "openai" and _is_openai_reasoning(
        str(routed.get("model") or "")
    ):
        max_tokens = max(max_tokens, 8192)
    # Build Spec needs larger completions; Domain Expert often drafts/repairs the JSON too.
    if task == "build_spec":
        if resolved == "architect":
            max_tokens = max(max_tokens, 8192)
        elif resolved == "domain_expert":
            max_tokens = max(max_tokens, 4096)

    try:
        result = _chat_role_retry(
            provider=routed["provider"],
            model=routed["model"],
            system=system,
            user=user,
            temperature=routed.get("temperature", 0.3),
            max_tokens=max_tokens,
            retries=1,
        )
    except Exception as e:
        # Degrade gracefully for ordinary errors. Credit/billing pauses the
        # pipeline (no walk-around) so the operator can top up and resume.
        step["text"] = f"[{meta['label']} unavailable: {e}]"
        step["error"] = str(e)
        step["usage"] = {"input": 0, "output": 0, "total": 0}
        try:
            from services.credit_pause import is_credit_error

            if is_credit_error(e):
                step["pause"] = "credit"
        except Exception:  # noqa: BLE001
            pass
        return step

    raw_text = result["text"]
    usage = result.get("usage") or {"input": 0, "output": 0, "total": 0}
    cost = usd_cost(routed["model"], usage.get("input", 0), usage.get("output", 0))

    # Build Spec: Architect often hits max_tokens mid-JSON. One continuation stitch.
    if task == "build_spec" and resolved == "architect":
        raw_text, usage, cost = _continue_truncated_build_spec(
            raw_text,
            usage=usage,
            cost=cost,
            routed={**routed, "max_tokens": max_tokens},
            system=system,
        )

    prose, structured = extract_structured(raw_text)
    step["text"] = prose
    step["usage"] = usage
    step["costUsd"] = cost
    if structured is not None:
        step["structured"] = structured
        conf = normalize_confidence(structured.get("confidence"))
        if conf is not None:
            step["confidence"] = conf
        verdict = structured.get("verdict")
        if isinstance(verdict, str) and verdict:
            step["verdict"] = verdict
    return step


def _is_retryable_provider_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        needle in msg
        for needle in (
            "timed out",
            "timeout",
            "temporarily unavailable",
            "overloaded",
            "529",
            "rate limit",
            "connection reset",
            "empty openai response",
            "empty anthropic response",
            "empty grok response",
        )
    )


def _chat_role_retry(
    *,
    provider: str,
    model: str,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    retries: int = 0,
) -> dict:
    last: BaseException | None = None
    attempts = 1 + max(0, retries)
    for i in range(attempts):
        try:
            return chat_role(
                provider=provider,
                model=model,
                system=system,
                user=user,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as e:  # noqa: BLE001
            last = e
            if i + 1 < attempts and _is_retryable_provider_error(e):
                continue
            raise
    assert last is not None
    raise last


def _continue_truncated_build_spec(
    raw_text: str,
    *,
    usage: dict,
    cost: float,
    routed: dict,
    system: str,
) -> tuple[str, dict, float]:
    """If Architect was cut off mid build-spec JSON, request one continuation."""
    from services.build_spec import extract_build_spec, looks_like_truncated_build_spec

    if extract_build_spec(raw_text) or not looks_like_truncated_build_spec(raw_text):
        return raw_text, usage, cost
    try:
        cont = chat_role(
            provider=routed["provider"],
            model=routed["model"],
            system=system,
            user=(
                "Your previous reply was truncated mid build-spec JSON (max_tokens). "
                "Continue EXACTLY from the cutoff — output only the remainder of the JSON "
                "object and close the ``` fence. Do not restart the object. Do not add prose "
                "before the continuation.\n\n"
                "--- CUTOFF TAIL (last 2000 chars) ---\n"
                f"{raw_text[-2000:]}"
            ),
            temperature=routed.get("temperature", 0.3),
            max_tokens=routed.get("max_tokens", 8192),
        )
    except Exception:  # noqa: BLE001
        return raw_text, usage, cost

    cont_text = cont.get("text") or ""
    merged = raw_text + cont_text
    cu = cont.get("usage") or {"input": 0, "output": 0, "total": 0}
    merged_usage = {
        "input": int(usage.get("input", 0)) + int(cu.get("input", 0)),
        "output": int(usage.get("output", 0)) + int(cu.get("output", 0)),
        "total": int(usage.get("total", 0)) + int(cu.get("total", 0)),
    }
    merged_cost = cost + usd_cost(
        routed["model"], cu.get("input", 0), cu.get("output", 0)
    )
    return merged, merged_usage, merged_cost


def _finalize(
    *,
    text: str,
    trace: list[dict],
    mode: str,
    roles: list[str],
    overrides: dict,
    council: str | None,
    paused: bool = False,
    pause: dict | None = None,
    resume: dict | None = None,
) -> dict:
    council_meta = get_council(council) if council else None
    vote = evaluate_votes(trace, council_meta)
    gated = apply_gate(text, vote)
    out = {
        "text": gated,
        "trace": trace,
        "mode": mode,
        "roles": roles,
        "modelOverrides": overrides,
        "usage": _aggregate_usage(trace),
        "council": council,
        "vote": vote,
    }
    if paused and pause:
        out["paused"] = True
        out["pause"] = pause
        out["resume"] = resume or {}
        out["text"] = pause.get("headline") or gated
    return out


def _spent_usd(trace: list[dict]) -> float:
    return round(sum((s.get("costUsd") or 0.0) for s in trace), 6)


def _pause_credit(
    *,
    step: dict,
    trace: list[dict],
    unique: list[str],
    overrides: dict,
    council: str | None,
    mode: str,
    task: str,
    question: str,
    context_json: str,
    failed_phase: str,
    remaining_roles: list[str],
    on_progress=None,
) -> dict:
    from services.credit_pause import build_pause, build_resume_payload, seed_trace

    seed = seed_trace(trace)
    pause = build_pause(
        step,
        seed=seed,
        remaining_roles=remaining_roles,
        spent_usd=_spent_usd(trace),
    )
    if on_progress:
        try:
            on_progress(
                {
                    "phase": "paused",
                    "message": pause["headline"],
                    "role": step.get("role"),
                }
            )
        except Exception:  # noqa: BLE001
            pass
    resume = build_resume_payload(
        task=task,
        mode=mode,
        roles=unique,
        question=question,
        context_json=context_json,
        council=council,
        model_overrides=overrides,
        seed=seed,
        failed_role=str(step.get("role") or ""),
        failed_phase=failed_phase,
    )
    return _finalize(
        text=pause["headline"],
        trace=trace,
        mode=mode,
        roles=unique,
        overrides=overrides,
        council=council,
        paused=True,
        pause=pause,
        resume=resume,
    )


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
    on_progress=None,
    resume: dict | None = None,
) -> dict:
    """Execute a job, then persist an immutable run bundle (ADR 0002 · O0)."""

    def progress(phase: str, message: str, role: str | None = None) -> None:
        if not on_progress:
            return
        try:
            on_progress({"phase": phase, "message": message, "role": role})
        except Exception:  # noqa: BLE001
            pass

    # For build_spec tasks, inject a read-only repo context pack unless the caller
    # already provided one (Autonomy 0 — tools never write).
    if task == "build_spec":
        progress(
            "repo_context",
            "Gathering read-only repo context (list/read/grep/diff)…",
            "architect",
        )
        context_json = _ensure_repo_context(context_json)
        progress("repo_context_done", "Repo context ready — starting council roles…", "architect")

    result = _execute_job(
        task=task,
        roles=roles,
        mode=mode,
        question=question,
        context_json=context_json,
        model_overrides=model_overrides,
        council=council,
        on_step=on_step,
        on_progress=on_progress,
        resume=resume,
    )
    if result.get("paused") and isinstance(result.get("resume"), dict):
        result["resume"]["context_json"] = context_json
        result["resume"]["question"] = question
        result["resume"]["task"] = task
        if resume and resume.get("prior_run_id"):
            result["resume"]["prior_run_id"] = resume.get("prior_run_id")
    _persist_run(result, task=task, question=question, context_json=context_json)

    if task == "build_spec" and not result.get("paused"):
        _emit_build_spec(result, question=question)

    return result


def resume_job(
    run_id: str,
    *,
    on_step=None,
    on_progress=None,
) -> dict:
    """Continue a credit-paused run. Successful steps are not re-called."""
    from services.credit_pause import load_resume_from_bundle
    from services.runstore import load_run

    bundle = load_run(run_id)
    if not bundle:
        raise ValueError(f"Run not found: {run_id}")
    payload = load_resume_from_bundle(bundle)
    payload["prior_run_id"] = run_id
    if on_progress:
        try:
            on_progress(
                {
                    "phase": "resume",
                    "message": (
                        f"Resuming after top-off — retry {payload.get('failed_role')}, "
                        "skip completed roles."
                    ),
                    "role": payload.get("failed_role"),
                }
            )
        except Exception:  # noqa: BLE001
            pass
    return run_job(
        task=payload.get("task") or bundle.get("task") or "general",
        roles=list(payload.get("roles") or bundle.get("roles") or []),
        mode=str(payload.get("mode") or bundle.get("mode") or "pipeline"),
        question=str(payload.get("question") or bundle.get("question") or ""),
        context_json=str(payload.get("context_json") or "{}"),
        model_overrides=payload.get("model_overrides") or {},
        council=payload.get("council") or (bundle.get("provenance") or {}).get("council"),
        on_step=on_step,
        on_progress=on_progress,
        resume=payload,
    )


def _ensure_repo_context(context_json: str) -> str:
    import json

    try:
        ctx = json.loads(context_json) if context_json else {}
        if not isinstance(ctx, dict):
            ctx = {"raw": context_json}
    except json.JSONDecodeError:
        ctx = {"raw": context_json}

    try:
        from services.operator_attachments import merge_into_context

        ctx = merge_into_context(ctx)
    except Exception:  # noqa: BLE001
        pass

    if ctx.get("repoContext"):
        return json.dumps(ctx)

    try:
        from services.tools import gather_build_context

        ctx["repoContext"] = gather_build_context("architect")
    except Exception as e:  # noqa: BLE001
        ctx["repoContext"] = f"(repo context unavailable: {e})"
    return json.dumps(ctx)


def _emit_build_spec(result: dict, *, question: str) -> None:
    """Best-effort: extract a build spec and write docs/specs/<id>.md + .json."""
    try:
        from services.build_spec import build_spec_from_committee_result, write_spec

        if result.get("vote", {}).get("vetoed"):
            result["buildSpecStatus"] = "vetoed"
            return
        spec = build_spec_from_committee_result(result, question=question)
        path = write_spec(spec)
        result["buildSpecId"] = spec["id"]
        result["buildSpecPath"] = str(path)
        result["buildSpecStatus"] = spec["provenance"]["verification_status"]
    except Exception as e:  # noqa: BLE001
        import sys

        sys.stderr.write(f"[orchestr8] build_spec emit skipped: {e}\n")
        result["buildSpecStatus"] = f"emit_failed: {e}"


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
    on_progress=None,
    resume: dict | None = None,
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

    def progress(phase: str, message: str, role: str | None = None) -> None:
        if not on_progress:
            return
        try:
            on_progress({"phase": phase, "message": message, "role": role})
        except Exception:  # noqa: BLE001
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
    # Prefer the council's declared agent order (e.g. build_spec: architect → … → critic).
    # Fall back to the global pipeline_order when no council is set.
    council_meta_early = get_council(council) if council else None
    if council_meta_early and council_meta_early.get("agents"):
        rank = {a: i for i, a in enumerate(council_meta_early["agents"])}
        unique = sorted(unique, key=lambda r: rank.get(r, 999))
    else:
        unique = sort_agent_ids(unique)
    from services.credit_pause import seed_trace, step_is_credit_pause

    resume = resume or {}
    trace: list[dict] = list(resume.get("seed_trace") or [])

    def override_for(aid: str) -> str | None:
        return overrides.get(aid) or overrides.get(resolve_agent_id(aid))

    def pause_now(step: dict, phase: str, remaining: list[str]) -> dict:
        return _pause_credit(
            step=step,
            trace=trace,
            unique=unique,
            overrides=overrides,
            council=council,
            mode=mode if mode in ("single", "pipeline", "parallel") else "pipeline",
            task=task,
            question=question,
            context_json=context_json,
            failed_phase=phase,
            remaining_roles=remaining,
            on_progress=on_progress,
        )

    if len(unique) == 1 or mode == "single":
        label0 = get_agent(unique[0])["label"]
        progress("role_start", f"Calling {label0}…", unique[0])
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
        if step_is_credit_pause(step):
            return pause_now(step, "single", [unique[0]])
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
    done_ok = {s.get("role") for s in seed_trace(trace)}

    if mode == "parallel" and len(workers) > 1:
        pending = [r for r in workers if r not in done_ok]
        credit_hit: dict | None = None
        if pending:
            progress(
                "role_start",
                f"Calling {len(pending)} roles in parallel…",
                pending[0],
            )
            parallel_results: list[dict] = []
            with ThreadPoolExecutor(max_workers=min(6, len(pending))) as pool:
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
                    for rid in pending
                ]
                for fut in as_completed(futures):
                    if fut.cancelled():
                        continue
                    res = fut.result()
                    parallel_results.append(res)
                    emit(res)
                    if step_is_credit_pause(res):
                        credit_hit = credit_hit or res
                        for other in futures:
                            other.cancel()
            order = {r: i for i, r in enumerate(sort_agent_ids([t["role"] for t in parallel_results]))}
            parallel_results.sort(key=lambda t: order.get(t["role"], 99))
            trace.extend(parallel_results)
        if credit_hit:
            leftover = [
                r
                for r in workers
                if r not in {s.get("role") for s in seed_trace(trace)}
            ]
            leftover = leftover + ([coordinator] if coordinator else [])
            return pause_now(credit_hit, "parallel", leftover)

        synth_id = coordinator or _synthesizer_id(unique)
        final_done = any(
            s.get("role") == synth_id and "Synthesis" in (s.get("role_label") or "")
            for s in seed_trace(trace)
        )
        if not final_done:
            progress("role_start", f"Calling {get_agent(synth_id)['label']} (Synthesis)…", synth_id)
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
            if step_is_credit_pause(synth_step):
                return pause_now(synth_step, "final", [synth_id])
        else:
            synth_step = next(
                s for s in reversed(trace) if s.get("role") == synth_id
            )
        return _finalize(
            text=synth_step["text"],
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
    plan_done = bool(
        coordinator
        and any(
            s.get("role") == coordinator and "Plan" in (s.get("role_label") or "")
            for s in seed_trace(trace)
        )
    )
    if coordinator:
        execution_order = [r for r in execution_order if r != coordinator]
        if not plan_done:
            progress(
                "role_start",
                f"Calling {get_agent(coordinator)['label']} (Plan)…",
                coordinator,
            )
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
            if step_is_credit_pause(plan_step):
                return pause_now(plan_step, "plan", [coordinator] + execution_order)

    done_workers = {s.get("role") for s in seed_trace(trace) if s.get("role") != coordinator}
    for agent_id in execution_order:
        if agent_id in done_workers:
            continue
        progress(
            "role_start",
            f"Calling {get_agent(agent_id)['label']}…",
            agent_id,
        )
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
        if step_is_credit_pause(step):
            leftover = [r for r in execution_order if r not in done_workers and r != agent_id]
            if coordinator:
                leftover.append(coordinator)
            return pause_now(step, "worker", [agent_id] + leftover)
        # Don't burn Domain/Tester/Critic spend when Architect never produced a spec.
        if (
            task == "build_spec"
            and step.get("role") == "architect"
            and step.get("error")
        ):
            progress(
                "abort",
                "Architect failed after retry — stopping Build Spec pipeline early.",
                "architect",
            )
            return _finalize(
                text=step["text"],
                trace=trace,
                mode="pipeline",
                roles=unique,
                overrides=overrides,
                council=council,
            )

    final_done = bool(
        coordinator
        and any(
            s.get("role") == coordinator and "Final" in (s.get("role_label") or "")
            for s in seed_trace(trace)
        )
    )
    if coordinator and not final_done:
        progress(
            "role_start",
            f"Calling {get_agent(coordinator)['label']} (Final)…",
            coordinator,
        )
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
        if step_is_credit_pause(final_step):
            return pause_now(final_step, "final", [coordinator])
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
