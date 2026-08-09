"""Provider chat-key loading + shape checks (no PyYAML / registry imports)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    # CI ingest job installs requirements-dev.txt only; gateway runtime still
    # has python-dotenv via orchestr8/requirements.txt.
    pass


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
