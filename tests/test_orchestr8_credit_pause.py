"""Credit/billing pause: stop the council, keep completed steps, resume the failed role."""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

from services.credit_pause import (  # noqa: E402
    is_credit_error,
    load_resume_from_bundle,
    seed_trace,
    step_is_credit_pause,
)


def test_detects_provider_credit_errors():
    assert is_credit_error("Error code: 402 - Your credit balance is too low")
    assert is_credit_error("insufficient_quota: You exceeded your current quota")
    assert is_credit_error("HTTP 402 payment required — add credits")
    assert not is_credit_error("timed out talking to the model")
    assert not is_credit_error("accreditation required for this listing")


def test_seed_trace_drops_failed_steps():
    seed = seed_trace(
        [
            {"role": "architect", "text": "ok"},
            {"role": "domain_expert", "text": "nope", "error": "402"},
        ]
    )
    assert [s["role"] for s in seed] == ["architect"]


def test_resume_requires_paused_bundle():
    with pytest.raises(ValueError, match="not paused"):
        load_resume_from_bundle({"run_id": "run_x", "resume": {}})


def _step(role: str, *, error: str | None = None) -> dict:
    out = {
        "role": role,
        "role_label": role.replace("_", " ").title(),
        "provider": "anthropic",
        "provider_label": "Anthropic",
        "model": "claude-test",
        "model_label": "Claude test",
        "text": "ok" if not error else f"[{role} unavailable: {error}]",
        "usage": {"input": 1, "output": 1, "total": 2},
        "costUsd": 0.01 if not error else 0.0,
    }
    if error:
        out["error"] = error
        out["pause"] = "credit"
    return out


def test_pipeline_pauses_and_does_not_call_later_roles():
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services import orchestrator as orch

    calls: list[str] = []

    def fake_run(agent_id, **_kwargs):
        calls.append(agent_id)
        if agent_id == "domain_expert":
            return _step(agent_id, error="Error code: 402 - insufficient credits")
        return _step(agent_id)

    orch._run_agent = fake_run  # type: ignore[method-assign]
    result = orch._execute_job(
        task="build_spec",
        roles=["architect", "domain_expert", "tester", "critic"],
        mode="pipeline",
        question="Spec the HUD",
        context_json="{}",
        council="build_spec",
    )
    assert result.get("paused") is True
    assert result["pause"]["role"] == "domain_expert"
    assert result["pause"]["reason"] == "credit"
    assert "tester" not in calls
    assert "critic" not in calls
    assert [s["role"] for s in result["resume"]["seed_trace"]] == ["architect"]
    assert result["resume"]["failed_role"] == "domain_expert"


def test_resume_retries_failed_role_only():
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services import orchestrator as orch

    seed = [_step("architect")]
    calls: list[str] = []

    def fake_run(agent_id, **_kwargs):
        calls.append(agent_id)
        return _step(agent_id)

    orch._run_agent = fake_run  # type: ignore[method-assign]
    result = orch._execute_job(
        task="build_spec",
        roles=["architect", "domain_expert", "tester", "critic"],
        mode="pipeline",
        question="Spec the HUD",
        context_json="{}",
        council="build_spec",
        resume={
            "seed_trace": seed,
            "failed_role": "domain_expert",
            "failed_phase": "worker",
        },
    )
    assert not result.get("paused")
    assert calls[0] == "domain_expert"
    assert "architect" not in calls
    assert "tester" in calls
    assert "critic" in calls


def test_non_credit_error_is_not_a_pause_step():
    assert not step_is_credit_pause({"role": "tester", "error": "timed out", "text": "nope"})


def test_pipeline_stops_when_coordinator_plan_fails():
    """Empty / generic plan failure must not cascade into every later role."""
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services import orchestrator as orch

    calls: list[str] = []

    def fake_run(agent_id, **_kwargs):
        calls.append(agent_id)
        out = {
            "role": agent_id,
            "role_label": agent_id,
            "provider": "openai",
            "provider_label": "OpenAI",
            "model": "gpt-5.6-sol",
            "text": "ok",
            "usage": {"input": 1, "output": 1, "total": 2},
            "costUsd": 0.01,
        }
        if agent_id == "orchestrator":
            out["text"] = "[Orchestrator unavailable: Empty OpenAI response]"
            out["error"] = "Empty OpenAI response"
            out["costUsd"] = 0.0
        return out

    orch._run_agent = fake_run  # type: ignore[method-assign]
    result = orch._execute_job(
        task="build_spec",
        roles=["orchestrator", "architect", "domain_expert", "tester", "critic"],
        mode="pipeline",
        question="Spec the HUD",
        context_json="{}",
        council="build_spec",
    )
    assert calls == ["orchestrator"]
    assert not result.get("paused")
    assert result["usage"]["errors"] == 1
    assert [s["role"] for s in result["trace"]] == ["orchestrator"]
