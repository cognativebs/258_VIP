"""Provider adapters — keys from environment only.

Each chat_* returns {"text": str, "usage": {input, output, total}, "model": str}.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from services.provider_env import provider_keys

DEFAULT_MAX_TOKENS = 2048
DEFAULT_TEMPERATURE = 0.3
# Build-spec Architect can take minutes (large context + 8k completion).
DEFAULT_HTTP_TIMEOUT = 120

# OpenAI reasoning-tier models take max_completion_tokens instead of max_tokens
# and reject a custom temperature (it is pinned server-side). Covers the o-series
# and every GPT-5.x family, including gpt-5.6-sol / -terra / -luna.
_OPENAI_REASONING_PREFIXES = ("o1", "o3", "o4", "gpt-5")


def _http_timeout_for(max_tokens: int) -> int:
    """Scale socket timeout with requested completion size."""
    # ~0.04s per output token budget, floor 120s, cap 480s.
    return max(DEFAULT_HTTP_TIMEOUT, min(480, 90 + int(max_tokens) // 20))


def _post_json(url: str, headers: dict, body: dict, *, timeout: int = DEFAULT_HTTP_TIMEOUT) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(payload)
            msg = err.get("error", {}).get("message") or err.get("message") or payload
        except json.JSONDecodeError:
            msg = payload or str(e)
        raise RuntimeError(msg) from e


def _is_openai_reasoning(model: str) -> bool:
    """True when the model needs the reasoning-tier chat-completions parameters."""
    return model.lower().startswith(_OPENAI_REASONING_PREFIXES)


def _openai_choice_text(choice: dict) -> str:
    """Pull visible text from a chat-completions choice (string, parts, or refusal)."""
    msg = choice.get("message") if isinstance(choice, dict) else None
    if not isinstance(msg, dict):
        msg = {}
    content = msg.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str) and block.strip():
                parts.append(block.strip())
            elif isinstance(block, dict):
                text = block.get("text") or block.get("content")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        if parts:
            return "\n".join(parts)
    refusal = msg.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        return refusal.strip()
    legacy = choice.get("text") if isinstance(choice, dict) else None
    if isinstance(legacy, str) and legacy.strip():
        return legacy.strip()
    return ""


def _openai_empty_detail(data: dict) -> str:
    choice = (data.get("choices") or [{}])[0] if isinstance(data, dict) else {}
    usage = (data.get("usage") or {}) if isinstance(data, dict) else {}
    details = usage.get("completion_tokens_details") or {}
    finish = choice.get("finish_reason") or "unknown"
    return (
        f"Empty OpenAI response (finish_reason={finish}"
        f", completion_tokens={usage.get('completion_tokens', 0)}"
        f", reasoning_tokens={details.get('reasoning_tokens', 0)})"
    )


def chat_openai(
    *,
    model: str,
    system: str,
    user: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict:
    key = provider_keys().get("openai")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured in orchestr8/.env")

    reasoning = _is_openai_reasoning(model)
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if reasoning:
        # o-series and GPT-5.x: separate token param, temperature fixed server-side.
        # Default reasoning_effort is medium/high and can spend the whole cap
        # on hidden tokens (empty content, finish_reason=length).
        body["max_completion_tokens"] = max_tokens
        body["reasoning_effort"] = "low"
    else:
        body["max_tokens"] = max_tokens
        body["temperature"] = temperature

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    data = _post_json(
        "https://api.openai.com/v1/chat/completions",
        headers,
        body,
        timeout=_http_timeout_for(max_tokens),
    )
    text = _openai_choice_text((data.get("choices") or [{}])[0])
    # Reasoning models often spend the whole budget on hidden tokens and return
    # empty content. One retry with a larger completion cap usually recovers.
    if not text and reasoning:
        retry_tokens = max(int(max_tokens) * 2, 8192)
        body["max_completion_tokens"] = retry_tokens
        data = _post_json(
            "https://api.openai.com/v1/chat/completions",
            headers,
            body,
            timeout=_http_timeout_for(retry_tokens),
        )
        text = _openai_choice_text((data.get("choices") or [{}])[0])
    if not text:
        raise RuntimeError(_openai_empty_detail(data))
    usage = data.get("usage") or {}
    return {
        "text": text,
        "model": data.get("model", model),
        "usage": {
            "input": usage.get("prompt_tokens", 0),
            "output": usage.get("completion_tokens", 0),
            "total": usage.get("total_tokens", 0),
        },
    }


def chat_anthropic(
    *,
    model: str,
    system: str,
    user: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict:
    key = provider_keys().get("anthropic")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured in orchestr8/.env")
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=_http_timeout_for(max_tokens),
    )
    blocks = data.get("content") or []
    text = next((b.get("text", "") for b in blocks if b.get("type") == "text"), "").strip()
    if not text:
        raise RuntimeError("Empty Anthropic response")
    usage = data.get("usage") or {}
    return {
        "text": text,
        "model": data.get("model", model),
        "usage": {
            "input": usage.get("input_tokens", 0),
            "output": usage.get("output_tokens", 0),
            "total": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


def chat_grok(
    *,
    model: str,
    system: str,
    user: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict:
    key = provider_keys().get("grok")
    if not key:
        raise RuntimeError("XAI_API_KEY not configured in orchestr8/.env")
    data = _post_json(
        "https://api.x.ai/v1/chat/completions",
        {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        },
        timeout=_http_timeout_for(max_tokens),
    )
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise RuntimeError("Empty Grok response")
    usage = data.get("usage") or {}
    return {
        "text": text,
        "model": data.get("model", model),
        "usage": {
            "input": usage.get("prompt_tokens", 0),
            "output": usage.get("completion_tokens", 0),
            "total": usage.get("total_tokens", 0),
        },
    }


def chat_role(
    *,
    provider: str,
    model: str,
    system: str,
    user: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict:
    if provider == "openai":
        return chat_openai(model=model, system=system, user=user, temperature=temperature, max_tokens=max_tokens)
    if provider == "anthropic":
        return chat_anthropic(model=model, system=system, user=user, temperature=temperature, max_tokens=max_tokens)
    if provider == "grok":
        return chat_grok(model=model, system=system, user=user, temperature=temperature, max_tokens=max_tokens)
    raise RuntimeError(f"Unknown provider: {provider}")
