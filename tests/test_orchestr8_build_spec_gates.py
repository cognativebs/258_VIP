"""Build Spec gates: author-before-critic, critic_passed, safe spec ids. No live keys."""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

from providers.llm import _canonical_model, _is_openai_reasoning, _repair_openai_body  # noqa: E402
from services.build_spec import (  # noqa: E402
    attach_provenance,
    critic_review_state,
    safe_spec_id,
    write_spec,
)
from services.contracts import validate_instance  # noqa: E402
from services.orchestrator import (  # noqa: E402
    _drop_unknown_roles,
    order_build_spec_roles,
    sort_agent_ids,
)


def _min_spec(**overrides) -> dict:
    spec = {
        "id": "test-spec-gates",
        "title": "Test spec gates",
        "goal": "Prove critic_passed requires a post-author Critic review.",
        "constraints": ["No live keys"],
        "contracts_first": [{"path": "n/a", "change": "none"}],
        "file_plan": [{"path": "apps/orchestr8-console", "action": "modify", "notes": "test"}],
        "acceptance_tests": ["pytest tests/test_orchestr8_build_spec_gates.py"],
        "risks": ["Low"],
        "cursor_prompt": "Implement the test-only build spec gates described in this file.",
        "provenance": {
            "source": "test",
            "method": "unit",
            "verification_status": "unverified",
        },
    }
    spec.update(overrides)
    return spec


def test_pipeline_order_puts_critic_before_architect():
    ordered = sort_agent_ids(["architect", "critic", "tester", "domain_expert"])
    assert ordered.index("critic") < ordered.index("architect")


def test_build_spec_order_puts_architect_before_critic():
    roster = ["critic", "tester", "architect", "domain_expert", "researcher"]
    ordered = order_build_spec_roles(roster)
    assert ordered.index("architect") < ordered.index("critic")
    assert set(ordered) == set(roster)


def test_build_spec_order_does_not_drop_full_council_extras():
    roster = [
        "orchestrator",
        "project_manager",
        "domain_expert",
        "researcher",
        "critic",
        "tester",
        "architect",
        "synthesizer",
    ]
    ordered = order_build_spec_roles(roster)
    assert set(ordered) == set(roster)
    assert ordered.index("architect") < ordered.index("critic")


def test_critic_review_pre_author():
    trace = [
        {"role": "critic", "text": "no spec yet"},
        {"role": "architect", "text": "spec"},
    ]
    assert critic_review_state(trace) == "pre_author"


def test_critic_review_post_author():
    trace = [
        {"role": "architect", "text": "spec"},
        {"role": "critic", "text": "ok"},
    ]
    assert critic_review_state(trace) == "post_author"


def test_critic_passed_requires_post_author():
    roles = ["architect", "critic"]
    vote = {"vetoed": False, "verdict": "approve"}
    pre = attach_provenance(
        _min_spec(),
        run_id="run_x",
        council="full",
        roles=roles,
        vote=vote,
        trace=[{"role": "critic"}, {"role": "architect"}],
    )
    assert pre["provenance"]["verification_status"] == "unverified"
    assert pre["provenance"]["critic_review"] == "pre_author"

    post = attach_provenance(
        _min_spec(),
        run_id="run_x",
        council="full",
        roles=roles,
        vote=vote,
        trace=[{"role": "architect"}, {"role": "critic"}],
    )
    assert post["provenance"]["verification_status"] == "critic_passed"
    assert post["provenance"]["critic_review"] == "post_author"


def test_safe_spec_id_strips_path_segments():
    assert safe_spec_id("specs/x") == "specs-x"
    assert "/" not in safe_spec_id("../evil/../id")
    assert "\\" not in safe_spec_id("..\\x")
    assert not safe_spec_id("../x").startswith("..")


@pytest.mark.parametrize(
    "raw",
    ["../x", "AI", "a", "?? ", "..\\x", "", "Add O2 diff review", "x" * 200],
)
def test_safe_spec_id_always_satisfies_the_schema(raw):
    """A degenerate question must not blow up write_spec after the council ran."""
    slug = safe_spec_id(raw)
    id_schema = {
        "type": "string",
        "minLength": 3,
        "maxLength": 80,
        "pattern": "^[a-z0-9][a-z0-9-]{1,79}$",
    }
    assert validate_instance(slug, id_schema) == [], f"{raw!r} -> {slug!r}"


def test_write_spec_recovers_from_a_degenerate_id(tmp_path, monkeypatch):
    import services.build_spec as bs

    monkeypatch.setattr(bs, "SPECS_DIR", tmp_path)
    path = bs.write_spec(_min_spec(id="AI"))
    assert path.parent == tmp_path.resolve()
    assert path.name == "build-spec-ai.md"


def test_write_spec_stays_in_docs_specs(tmp_path, monkeypatch):
    import services.build_spec as bs

    monkeypatch.setattr(bs, "SPECS_DIR", tmp_path)
    path = bs.write_spec(_min_spec(id="../escape-attempt"))
    assert path.parent == tmp_path.resolve()
    assert path.name == "escape-attempt.md"


def test_validator_enforces_pattern_and_maxlength():
    schema = {"type": "string", "pattern": "^[a-z0-9-]+$", "maxLength": 8}
    assert validate_instance("ok-id", schema) == []
    assert any("pattern" in e for e in validate_instance("../x", schema))
    assert any("maxLength" in e for e in validate_instance("toolongid", schema))


def test_reasoning_detection_covers_future_and_prefixed_ids():
    assert _is_openai_reasoning("o5")
    assert _is_openai_reasoning("gpt-6")
    assert _is_openai_reasoning("openai/gpt-5.4")
    assert _canonical_model("openai/gpt-5.4") == "gpt-5.4"
    assert not _is_openai_reasoning("gpt-4.1")


def test_repair_openai_body_switches_token_param():
    body = {"model": "o5", "max_tokens": 100, "temperature": 0.3}
    repaired = _repair_openai_body(
        body, RuntimeError("Use max_completion_tokens instead of max_tokens")
    )
    assert repaired is not None
    assert "max_tokens" not in repaired
    assert repaired["max_completion_tokens"] == 100


# --- leftover console team naming a deleted custom role -----------------------
# A team lives in localStorage, so it outlives the role it names. Before the
# filter one stale id raised "Unknown agent" and killed the whole council.


def test_drop_unknown_roles_splits_registered_from_stale():
    keep, dropped = _drop_unknown_roles(["architect", "deleted_custom_role", "critic"])
    assert keep == ["architect", "critic"]
    assert dropped == ["deleted_custom_role"]


def test_stale_role_does_not_kill_the_council(monkeypatch):
    import services.orchestrator as orch

    seen: dict = {}

    def fake_run_agent(agent_id, *a, **k):
        return {"role": agent_id, "role_label": agent_id, "text": f"{agent_id} ok", "usage": {}}

    monkeypatch.setattr(orch, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orch, "_emit_build_spec", lambda *a, **k: seen.setdefault("emit", True))

    result = orch.run_job(
        task="build_spec",
        roles=["architect", "deleted_custom_role", "critic"],
        mode="pipeline",
        question="stale role must not abort the run",
        context_json="{}",
        council="build_spec",
    )
    assert "deleted_custom_role" not in result["roles"]
    assert result["droppedRoles"] == ["deleted_custom_role"]
    assert "architect" in result["roles"]


def test_all_roles_stale_falls_back_to_the_council_roster(monkeypatch):
    import services.orchestrator as orch

    monkeypatch.setattr(
        orch,
        "_run_agent",
        lambda agent_id, *a, **k: {"role": agent_id, "text": "ok", "usage": {}},
    )
    monkeypatch.setattr(orch, "_emit_build_spec", lambda *a, **k: None)

    result = orch.run_job(
        task="build_spec",
        roles=["gone_a", "gone_b"],
        mode="pipeline",
        question="every role stale",
        context_json="{}",
        council="build_spec",
    )
    assert result["roles"] == ["architect", "domain_expert", "tester", "critic"]
    assert result["droppedRoles"] == ["gone_a", "gone_b"]


def test_all_roles_stale_without_a_council_raises_an_actionable_error():
    from services.orchestrator import run_job

    with pytest.raises(ValueError) as exc:
        run_job(
            task="build_spec",
            roles=["gone_a"],
            mode="pipeline",
            question="q",
            context_json="{}",
            council=None,
        )
    assert "gone_a" in str(exc.value)
    assert "not in the registry" in str(exc.value)
