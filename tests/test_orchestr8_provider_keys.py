"""Catch swapped Orchestr8 provider keys (sk-ant- in OPENAI, etc.)."""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

# Import the lightweight module (no PyYAML) so the ingest CI job can run these
# checks without installing orchestr8/requirements.txt.
from services.provider_env import provider_key_warnings, provider_keys  # noqa: E402


def test_detects_anthropic_key_in_openai_slot():
    warnings = provider_key_warnings(
        {
            "openai": "sk-ant-api03-EXAMPLE",
            "anthropic": None,
            "grok": None,
        }
    )
    assert any("Anthropic" in w and "OPENAI_API_KEY" in w for w in warnings)


def test_detects_openai_key_in_anthropic_slot():
    warnings = provider_key_warnings(
        {
            "openai": None,
            "anthropic": "sk-proj-EXAMPLE",
            "grok": None,
        }
    )
    assert any("OpenAI" in w and "ANTHROPIC_API_KEY" in w for w in warnings)


def test_clean_shapes_produce_no_warnings():
    warnings = provider_key_warnings(
        {
            "openai": "sk-proj-EXAMPLE",
            "anthropic": "sk-ant-api03-EXAMPLE",
            "grok": "xai-EXAMPLE",
        }
    )
    assert warnings == []


def test_grok_api_key_alias(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.setenv("GROK_API_KEY", "xai-from-alias")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    keys = provider_keys()
    assert keys["grok"] == "xai-from-alias"
