"""Parse agent responses into (prose, structured JSON) with normalized confidence.

Agents are asked to append a fenced ```json block conforming to their skill's
JSON Output Schema. We extract the last valid block, keep the prose above it for
the chat UI, and expose the structured object for confidence + voting logic.
"""
from __future__ import annotations

import json
import re
from typing import Any

# Capture everything between a ```json (or bare ```) fence and the closing fence.
# Non-greedy on the *fence*, not on braces, so nested objects/arrays survive.
_FENCED = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL | re.IGNORECASE)


def extract_structured(text: str) -> tuple[str, dict[str, Any] | None]:
    """Return (prose, structured|None). Never raises."""
    if not text:
        return text, None

    parsed: dict | None = None
    prose = text

    # Prefer the last valid fenced JSON block (agents append it after prose).
    for m in reversed(list(_FENCED.finditer(text))):
        candidate = _try_load(m.group(1))
        if candidate is not None:
            parsed = candidate
            prose = (text[: m.start()] + text[m.end():]).strip()
            break

    # Fallback: the whole message is a bare JSON object.
    if parsed is None:
        stripped = text.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            candidate = _try_load(stripped)
            if candidate is not None:
                parsed = candidate
                prose = ""

    if parsed is not None and not prose.strip():
        prose = _prose_from_structured(parsed) or text

    return (prose or text), parsed


def _try_load(raw: str) -> dict | None:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _prose_from_structured(parsed: dict) -> str:
    for key in ("summary", "narrative", "answer", "residual_risk", "verdict"):
        val = parsed.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def normalize_confidence(value: Any) -> float | None:
    """Accept 0–1 or 0–100; clamp to [0, 1]. Return None if unparseable."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v > 1.0:
        v = v / 100.0
    return max(0.0, min(1.0, v))
