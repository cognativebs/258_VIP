"""Anthropic request shaping for the current Claude generation (2026-10-17).

Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 always think and reject temperature; the
models that support it get the server-side refusal fallback; a refusal or a cap hit before
any answer text is reported as such instead of "Empty Anthropic response".
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
    ANTHROPIC_FALLBACK_BETA,
    ANTHROPIC_THINKING_MAX_TOKENS_FLOOR,
    anthropic_request,
    anthropic_text,
)
from services.registry import load_models  # noqa: E402


@pytest.mark.parametrize(
    "model_id,price_in,price_out",
    [
        ("claude-opus-5-5", 4.00, 20.00),
        ("claude-sonnet-5-5", 2.00, 10.00),
        ("claude-haiku-5-5", 0.10, 0.50),
        ("claude-fable-5-1", 10.00, 50.00),
        ("claude-opus-4-8", 5.00, 25.00),
    ],
)
def test_current_claude_models_are_catalogued_with_prices(model_id, price_in, price_out):
    m = (load_models().get("models") or {})[model_id]
    assert (m["provider"], m["price_in"], m["price_out"]) == ("anthropic", price_in, price_out)


@pytest.mark.parametrize("model_id", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-5"])
def test_always_thinking_models_get_room_to_answer_and_no_temperature(model_id):
    _, body = anthropic_request(model_id, "sys", "q", 0.4, 2048)
    assert body["max_tokens"] == ANTHROPIC_THINKING_MAX_TOKENS_FLOOR
    assert "temperature" not in body
    assert "thinking" not in body


def test_fallback_is_opted_in_only_where_supported():
    headers, body = anthropic_request("claude-opus-5-5", "sys", "q", 0.4, 2048)
    assert headers == {"anthropic-beta": ANTHROPIC_FALLBACK_BETA}
    assert body["fallbacks"] == "default"
    headers, body = anthropic_request("claude-haiku-5-5", "sys", "q", 0.4, 2048)
    assert headers == {} and "fallbacks" not in body


def test_older_models_keep_their_cap_and_temperature():
    _, body = anthropic_request("claude-sonnet-4-6", "sys", "q", 0.4, 2048)
    assert body["max_tokens"] == 2048
    assert body["temperature"] == 0.4
    assert "fallbacks" not in body


def test_text_joins_text_blocks_and_skips_thinking():
    data = {"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "A"}, {"type": "text", "text": "B"}]}
    assert anthropic_text(data, "claude-opus-5-5") == "A\n\nB"


def test_refusal_and_empty_cap_are_named():
    with pytest.raises(RuntimeError, match=r"declined the request \(refusal: cyber\)"):
        anthropic_text({"stop_reason": "refusal", "stop_details": {"category": "cyber"}, "content": [], "model": "claude-opus-5-5"}, "claude-opus-5-5")
    with pytest.raises(RuntimeError, match="max_tokens reached before any answer text"):
        anthropic_text({"stop_reason": "max_tokens", "content": [{"type": "thinking", "thinking": ""}]}, "claude-opus-5-5")
    with pytest.raises(RuntimeError, match="^Empty Anthropic response$"):
        anthropic_text({"stop_reason": "end_turn", "content": []}, "claude-opus-5-5")
