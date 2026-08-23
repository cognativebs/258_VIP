"""Operator-attached text for a council run (Build Spec chat).

Uploads arrive in contextJson.operatorAttachments. In-repo paths arrive as
operatorRefPaths and are read with the same sandbox as architect read_file.
Caps keep a pasted novel from blowing the job token budget.
"""
from __future__ import annotations

import json
from typing import Any

MAX_ATTACHMENTS = 8
MAX_REF_PATHS = 12
MAX_TEXT_CHARS = 24_000
MAX_TOTAL_CHARS = 80_000

ALLOWED_SUFFIXES = (
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".csv",
    ".ts",
    ".tsx",
    ".py",
)


class AttachmentError(ValueError):
    """Rejected attachment — operator-readable."""


def _clean_one(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip() or "untitled.txt"
    text = raw.get("text")
    if not isinstance(text, str):
        return None
    text = text[:MAX_TEXT_CHARS]
    if not text.strip():
        return None
    source = raw.get("source") if raw.get("source") in {"upload", "repo", "paste"} else "upload"
    return {"name": name[:180], "text": text, "source": source}


def normalize_attachments(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    total = 0
    for item in raw[:MAX_ATTACHMENTS]:
        cleaned = _clean_one(item)
        if not cleaned:
            continue
        if total + len(cleaned["text"]) > MAX_TOTAL_CHARS:
            remain = MAX_TOTAL_CHARS - total
            if remain < 80:
                break
            cleaned["text"] = cleaned["text"][:remain]
        out.append(cleaned)
        total += len(cleaned["text"])
    return out


def normalize_ref_paths(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    paths: list[str] = []
    for item in raw:
        path = str(item or "").strip().replace("\\", "/")
        if not path or path.startswith("/") or ".." in path.split("/"):
            continue
        if not path.lower().endswith(ALLOWED_SUFFIXES):
            continue
        paths.append(path)
        if len(paths) >= MAX_REF_PATHS:
            break
    return paths


def resolve_ref_paths(paths: list[str]) -> list[dict[str, str]]:
    """Read repo-relative paths through the architect sandbox."""
    from services.tools import read_file

    attachments: list[dict[str, str]] = []
    for path in normalize_ref_paths(paths):
        try:
            result = read_file("architect", path, max_bytes=MAX_TEXT_CHARS)
        except Exception as e:  # noqa: BLE001
            attachments.append(
                {
                    "name": path,
                    "text": f"(could not read {path}: {e})",
                    "source": "repo",
                }
            )
            continue
        attachments.append(
            {
                "name": result.get("path") or path,
                "text": str(result.get("content") or ""),
                "source": "repo",
            }
        )
    return normalize_attachments(attachments)


def merge_into_context(ctx: dict) -> dict:
    """Normalize uploads and resolve operatorRefPaths onto operatorAttachments."""
    attached = normalize_attachments(ctx.get("operatorAttachments"))
    refs = resolve_ref_paths(ctx.get("operatorRefPaths") or [])
    seen = {a["name"] for a in attached}
    for item in refs:
        if item["name"] in seen:
            continue
        attached.append(item)
        seen.add(item["name"])
    ctx["operatorAttachments"] = normalize_attachments(attached)
    ctx["operatorRefPaths"] = normalize_ref_paths(ctx.get("operatorRefPaths") or [])
    return ctx


def summarize_for_collection_json(ctx: dict) -> dict:
    """Keep names in the JSON blob; full text lives in OPERATOR ATTACHMENTS."""
    out = dict(ctx)
    attached = out.get("operatorAttachments")
    if isinstance(attached, list):
        out["operatorAttachments"] = [
            {
                "name": str(item.get("name") or ""),
                "source": str(item.get("source") or "upload"),
                "chars": len(item.get("text") or "") if isinstance(item.get("text"), str) else 0,
            }
            for item in attached
            if isinstance(item, dict)
        ]
    return out


def format_for_prompt(attachments: list[dict[str, str]]) -> str:
    if not attachments:
        return ""
    blocks = ["--- OPERATOR ATTACHMENTS (reference only; not VIP truth) ---"]
    for item in attachments:
        blocks.append(f"\n### {item['name']} ({item.get('source') or 'upload'})\n{item['text']}")
    return "\n".join(blocks)


def attachments_from_context_json(context_json: str) -> list[dict[str, str]]:
    try:
        ctx = json.loads(context_json) if context_json else {}
    except json.JSONDecodeError:
        return []
    if not isinstance(ctx, dict):
        return []
    return normalize_attachments(ctx.get("operatorAttachments"))
