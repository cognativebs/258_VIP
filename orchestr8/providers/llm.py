"""Provider adapters — keys from environment only.

Each chat_* returns {"text": str, "usage": {input, output, total}, "model": str}.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from services.roles import provider_keys

DEFAULT_MAX_TOKENS = 2048
DEFAULT_TEMPERATURE = 0.3

# OpenAI reasoning models: use max_completion_tokens and reject custom temperature.
_OPENAI_REASONING_PREFIXES = ("o1", "o3", "o4")


def _post_json(url: str, headers: dict, body: dict, *, timeout: int = 120) -> dict:
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
    return model.lower().startswith(_OPENAI_REASONING_PREFIXES)


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
        # o-series: separate token param, temperature fixed at default
        body["max_completion_tokens"] = max_tokens
    else:
        body["max_tokens"] = max_tokens
        body["temperature"] = temperature

    data = _post_json(
        "https://api.openai.com/v1/chat/completions",
        {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        body,
    )
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise RuntimeError("Empty OpenAI response")
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
