"""Model catalog contract + open per-role model selection.

Any catalog model may be assigned to any agent, so the catalog itself is the
only gate left. These tests hold that gate: the catalog matches its schema, the
2026 model ids are present, cross-provider overrides resolve, and OpenAI's
reasoning-tier models get the parameter shape their API requires.
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

yaml = pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

from providers.llm import (  # noqa: E402
    _anthropic_omits_temperature,
    _is_openai_reasoning,
    _is_temperature_rejected,
    _openai_choice_text,
    _openai_empty_detail,
)
from services.registry import (  # noqa: E402
    agents_public_list,
    load_agents,
    load_models,
    recommended_models,
    resolve_model,
    validate_model_catalog,
)


def catalog_ids() -> set[str]:
    return set(load_models().get("models") or {})


# --- catalog contract ---------------------------------------------------------

def test_catalog_matches_schema():
    assert validate_model_catalog() == []


@pytest.mark.parametrize(
    "model_id,provider",
    [
        ("gpt-5.6-sol", "openai"),
        ("gpt-5.6-terra", "openai"),
        ("gpt-5.6-luna", "openai"),
        ("claude-fable-5", "anthropic"),
        ("claude-opus-5", "anthropic"),
        ("claude-sonnet-5", "anthropic"),
        ("grok-4.6", "grok"),
        ("grok-4.5", "grok"),
        ("grok-4.3", "grok"),
    ],
)
def test_current_models_are_catalogued(model_id: str, provider: str):
    models = load_models().get("models") or {}
    assert model_id in models, f"{model_id} missing from config/models.yaml"
    assert models[model_id]["provider"] == provider


def test_every_agent_model_reference_exists():
    """A default or recommended id that is not in the catalog fails at run time."""
    known = catalog_ids()
    unknown: list[str] = []
    for aid, meta in load_agents().items():
        if meta.get("enabled") is False:
            continue
        for mid in {meta["default_model"], *(meta.get("allowed_models") or [])}:
            if mid not in known:
                unknown.append(f"{aid} -> {mid}")
    assert unknown == [], f"agent.yaml references models missing from the catalog: {unknown}"


# Still in the catalog so old run bundles and saved team settings resolve, but
# xAI no longer publishes them — nothing should route to one by default.
RETIRED_MODEL_IDS = {"grok-3", "grok-3-mini", "grok-4"}


def test_no_agent_defaults_to_or_recommends_a_retired_model():
    stale: list[str] = []
    for aid, meta in load_agents().items():
        if meta.get("enabled") is False:
            continue
        if meta["default_model"] in RETIRED_MODEL_IDS:
            stale.append(f"{aid} default -> {meta['default_model']}")
        for mid in meta.get("allowed_models") or []:
            if mid in RETIRED_MODEL_IDS:
                stale.append(f"{aid} recommends -> {mid}")
    assert stale == [], f"agents point at models xAI no longer publishes: {stale}"


# --- open selection -----------------------------------------------------------

def test_any_model_can_be_assigned_to_any_role():
    """The whole catalog resolves for every enabled agent, cross-provider included."""
    known = sorted(catalog_ids())
    for aid, meta in load_agents().items():
        if meta.get("enabled") is False:
            continue
        for mid in known:
            resolved = resolve_model(aid, mid)
            assert resolved["model"] == mid


def test_override_dispatches_to_the_model_provider_not_the_agent_home():
    """architect is an Anthropic agent; a Grok override must route to Grok."""
    resolved = resolve_model("architect", "grok-4.6")
    assert resolved["provider"] == "grok"
    assert resolved["home_provider"] == "anthropic"
    assert resolved["model_label"] == "Grok 4.6"


def test_off_list_model_resolves_but_is_flagged_unrecommended():
    off_list = "gpt-5.6-luna"
    assert off_list not in recommended_models("architect")
    resolved = resolve_model("architect", off_list)
    assert resolved["recommended"] is False
    assert resolve_model("architect", "claude-sonnet-4-6")["recommended"] is True


def test_full_council_lists_every_pipeline_agent():
    from services.registry import get_council, pipeline_order

    council = get_council("full")
    assert council is not None
    assert council["mode"] == "pipeline"
    assert council["voting"] == "veto_on_critical"
    assert council["agents"] == pipeline_order()


def test_unknown_model_is_still_rejected():
    with pytest.raises(ValueError, match="Unknown model in catalog"):
        resolve_model("architect", "gpt-9-imaginary")


def test_agents_api_offers_the_whole_catalog_per_agent():
    known = catalog_ids()
    agents = agents_public_list()
    assert agents
    for agent in agents:
        offered = {m["id"] for m in agent["allowedModels"]}
        assert offered == known, f"{agent['id']} cannot reach the full catalog"
        assert agent["defaultModel"] in agent["recommendedModels"] or agent[
            "recommendedModels"
        ]
        assert any(m["recommended"] for m in agent["allowedModels"])


def test_agents_api_marks_models_whose_provider_has_no_key(
    monkeypatch: pytest.MonkeyPatch,
):
    for var in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GROK_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")

    by_id = {m["id"]: m for m in agents_public_list()[0]["allowedModels"]}
    assert by_id["gpt-5.6-sol"]["configured"] is True
    assert by_id["claude-fable-5"]["configured"] is False


# --- provider parameter shape -------------------------------------------------

@pytest.mark.parametrize(
    "model_id",
    ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "o3-mini"],
)
def test_reasoning_tier_models_use_completion_tokens(model_id: str):
    """These reject max_tokens/temperature — the adapter must switch parameters."""
    assert _is_openai_reasoning(model_id) is True


@pytest.mark.parametrize("model_id", ["gpt-4.1", "gpt-4o", "gpt-4o-mini"])
def test_classic_chat_models_keep_max_tokens(model_id: str):
    assert _is_openai_reasoning(model_id) is False


def _sent_body(monkeypatch: pytest.MonkeyPatch, model_id: str) -> dict:
    """Capture the JSON body chat_openai would put on the wire."""
    import providers.llm as llm

    captured: dict = {}

    def fake_post(url, headers, body, *, timeout=0):
        captured.update(body)
        return {"choices": [{"message": {"content": "ok"}}], "usage": {}}

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")
    llm.chat_openai(model=model_id, system="s", user="u", max_tokens=4096)
    return captured


def test_gpt5_request_omits_the_parameters_openai_rejects(
    monkeypatch: pytest.MonkeyPatch,
):
    body = _sent_body(monkeypatch, "gpt-5.6-sol")
    assert body["max_completion_tokens"] == 4096
    assert body["reasoning_effort"] == "low"
    assert "max_tokens" not in body
    assert "temperature" not in body


def test_classic_model_request_keeps_max_tokens_and_temperature(
    monkeypatch: pytest.MonkeyPatch,
):
    body = _sent_body(monkeypatch, "gpt-4.1")
    assert body["max_tokens"] == 4096
    assert "temperature" in body
    assert "max_completion_tokens" not in body
    assert "reasoning_effort" not in body


def test_openai_choice_text_joins_content_parts():
    choice = {
        "message": {
            "content": [
                {"type": "text", "text": "Hello"},
                {"type": "text", "text": "world"},
            ]
        }
    }
    assert _openai_choice_text(choice) == "Hello\nworld"


def test_openai_choice_text_uses_refusal_when_content_empty():
    choice = {"message": {"content": None, "refusal": "I can't do that."}}
    assert _openai_choice_text(choice) == "I can't do that."


def test_openai_empty_detail_includes_finish_and_reasoning_tokens():
    data = {
        "choices": [{"finish_reason": "length", "message": {"content": None}}],
        "usage": {
            "completion_tokens": 2048,
            "completion_tokens_details": {"reasoning_tokens": 2048},
        },
    }
    detail = _openai_empty_detail(data)
    assert "finish_reason=length" in detail
    assert "reasoning_tokens=2048" in detail


def test_gpt5_empty_content_retries_with_higher_completion_cap(
    monkeypatch: pytest.MonkeyPatch,
):
    import providers.llm as llm

    calls: list[dict] = []

    def fake_post(url, headers, body, *, timeout=0):
        calls.append(dict(body))
        if len(calls) == 1:
            return {
                "choices": [
                    {
                        "finish_reason": "length",
                        "message": {"content": None},
                    }
                ],
                "usage": {
                    "completion_tokens": 2048,
                    "completion_tokens_details": {"reasoning_tokens": 2048},
                },
            }
        return {"choices": [{"message": {"content": "recovered"}}], "usage": {}}

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")
    result = llm.chat_openai(
        model="gpt-5.6-sol", system="s", user="u", max_tokens=2048
    )
    assert result["text"] == "recovered"
    assert len(calls) == 2
    assert calls[0]["max_completion_tokens"] == 2048
    assert calls[1]["max_completion_tokens"] == 8192


def test_empty_openai_error_is_retryable_at_orchestrator():
    from services.orchestrator import _is_retryable_provider_error

    err = RuntimeError(
        "Empty OpenAI response (finish_reason=length, completion_tokens=2048, "
        "reasoning_tokens=2048)"
    )
    assert _is_retryable_provider_error(err) is True


def test_empty_openai_error_names_finish_reason(
    monkeypatch: pytest.MonkeyPatch,
):
    import providers.llm as llm

    def fake_post(url, headers, body, *, timeout=0):
        return {
            "choices": [{"finish_reason": "stop", "message": {"content": ""}}],
            "usage": {},
        }

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")
    with pytest.raises(RuntimeError, match="finish_reason=stop"):
        llm.chat_openai(model="gpt-4.1", system="s", user="u", max_tokens=128)


def test_anthropic_sonnet5_omits_temperature():
    assert _anthropic_omits_temperature("claude-sonnet-5") is True
    assert _anthropic_omits_temperature("claude-opus-5") is True
    assert _anthropic_omits_temperature("claude-fable-5") is True
    assert _anthropic_omits_temperature("claude-sonnet-4-6") is False


def test_temperature_deprecated_message_is_detected():
    assert _is_temperature_rejected(
        RuntimeError("`temperature` is deprecated for this model.")
    )


def test_anthropic_sonnet5_request_omits_temperature(
    monkeypatch: pytest.MonkeyPatch,
):
    import providers.llm as llm

    captured: dict = {}

    def fake_post(url, headers, body, *, timeout=0):
        captured.update(body)
        return {
            "content": [{"type": "text", "text": "ok"}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-EXAMPLE")
    llm.chat_anthropic(model="claude-sonnet-5", system="s", user="u", max_tokens=256)
    assert "temperature" not in captured
    assert captured["max_tokens"] == 256


def test_anthropic_retries_without_temperature_when_api_rejects(
    monkeypatch: pytest.MonkeyPatch,
):
    import providers.llm as llm

    calls: list[dict] = []

    def fake_post(url, headers, body, *, timeout=0):
        calls.append(dict(body))
        if "temperature" in body:
            raise RuntimeError("`temperature` is deprecated for this model.")
        return {
            "content": [{"type": "text", "text": "recovered"}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(llm, "_post_json", fake_post)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-EXAMPLE")
    result = llm.chat_anthropic(
        model="claude-sonnet-4-6", system="s", user="u", max_tokens=256
    )
    assert result["text"] == "recovered"
    assert "temperature" in calls[0]
    assert "temperature" not in calls[1]
