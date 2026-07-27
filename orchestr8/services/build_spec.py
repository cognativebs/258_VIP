"""Build-spec (work order) extract / validate / emit (ADR 0003 · O1).

Specs are critic-passed work orders written to ``docs/specs/<id>.md`` and
carried in the immutable run bundle. Cursor executes them; Orchestr8 never
writes code.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from services.contracts import validate_instance

ROOT = Path(__file__).resolve().parent.parent.parent
ORCHESTR8 = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ORCHESTR8 / "config" / "build_spec.schema.json"
SPECS_DIR = ROOT / "docs" / "specs"

_FENCED = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL | re.IGNORECASE)


@lru_cache(maxsize=1)
def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def extract_build_spec(text: str) -> dict | None:
    """Pull a build-spec object from agent prose (last valid fenced JSON that looks like one)."""
    if not text:
        return None
    candidates: list[dict] = []
    for m in _FENCED.finditer(text):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and _looks_like_spec(obj):
            candidates.append(obj)
    # Also accept a top-level object if the whole message is JSON.
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            obj = json.loads(stripped)
            if isinstance(obj, dict) and _looks_like_spec(obj):
                candidates.append(obj)
        except json.JSONDecodeError:
            pass
    return candidates[-1] if candidates else None


def _looks_like_spec(obj: dict) -> bool:
    # Prefer explicit shape; fall back to key presence.
    if obj.get("schema") == "build_spec_v1":
        return True
    keys = {"goal", "cursor_prompt", "file_plan", "acceptance_tests"}
    return keys.issubset(obj.keys()) or {"id", "title", "goal", "cursor_prompt"}.issubset(obj.keys())


def validate_build_spec(spec: dict) -> list[str]:
    return validate_instance(spec, load_schema())


def render_markdown(spec: dict) -> str:
    """Render a build spec as a human + Cursor-friendly markdown work order."""
    prov = spec.get("provenance") or {}
    lines: list[str] = [
        f"# Build Spec — {spec.get('title', spec.get('id', 'untitled'))}",
        "",
        f"**ID:** `{spec.get('id', '')}`  ",
        f"**Verification:** {prov.get('verification_status', 'unverified')}  ",
        f"**Council:** {prov.get('council') or '—'}  ",
        f"**Run:** `{prov.get('run_id') or '—'}`  ",
        f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "> Orchestr8 authors this spec (ADR 0003). Execute it in Cursor. "
        "After implementation, paste the diff back to the Challenge Council for review.",
        "",
        "## Goal",
        "",
        spec.get("goal", "").strip(),
        "",
        "## Constraints",
        "",
    ]
    for c in spec.get("constraints") or []:
        lines.append(f"- {c}")
    lines += ["", "## Contracts / schemas first (DoD)", ""]
    for item in spec.get("contracts_first") or []:
        lines.append(f"- `{item.get('path')}` — {item.get('change')}")
    lines += ["", "## File plan", "", "| Path | Action | Notes |", "|---|---|---|"]
    for item in spec.get("file_plan") or []:
        lines.append(
            f"| `{item.get('path')}` | {item.get('action')} | {item.get('notes', '')} |"
        )
    lines += ["", "## Acceptance tests", ""]
    for i, t in enumerate(spec.get("acceptance_tests") or [], 1):
        lines.append(f"{i}. {t}")
    if spec.get("risks"):
        lines += ["", "## Risks", ""]
        for r in spec["risks"]:
            lines.append(f"- {r}")
    if spec.get("out_of_scope"):
        lines += ["", "## Out of scope", ""]
        for o in spec["out_of_scope"]:
            lines.append(f"- {o}")
    lines += [
        "",
        "## Cursor prompt (paste as-is)",
        "",
        "```",
        (spec.get("cursor_prompt") or "").strip(),
        "```",
        "",
        "## Provenance",
        "",
        f"- source: {prov.get('source', '')}",
        f"- method: {prov.get('method', '')}",
        f"- rule/model version: {prov.get('rule_or_model_version', '')}",
        f"- confidence: {prov.get('confidence', '')}",
        f"- verification: {prov.get('verification_status', '')}",
        f"- roles: {', '.join(prov.get('roles') or [])}",
        "",
    ]
    return "\n".join(lines)


def write_spec(spec: dict) -> Path:
    errs = validate_build_spec(spec)
    if errs:
        raise ValueError("Build spec failed schema: " + "; ".join(errs[:6]))
    SPECS_DIR.mkdir(parents=True, exist_ok=True)
    path = SPECS_DIR / f"{spec['id']}.md"
    path.write_text(render_markdown(spec), encoding="utf-8")
    # Also keep the machine-readable JSON beside it for O2 diff review.
    json_path = SPECS_DIR / f"{spec['id']}.json"
    json_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def attach_provenance(
    spec: dict,
    *,
    run_id: str | None,
    council: str | None,
    roles: list[str],
    vote: dict | None,
    confidence: float | None = None,
) -> dict:
    """Stamp provenance from the orchestration run onto a extracted/drafted spec."""
    vetoed = bool((vote or {}).get("vetoed"))
    status = "critic_vetoed" if vetoed else "critic_passed"
    # If no vote / no challenge members, stay unverified until human.
    if not vote or vote.get("effectivePolicy") in (None, "none"):
        if not vetoed and (vote or {}).get("verdict") in (None, "approve", "conditional"):
            # Pipeline with critic present → treat non-veto as critic_passed when critic ran.
            if "critic" in roles and not vetoed:
                status = "critic_passed"
            else:
                status = "unverified"
    out = dict(spec)
    out["provenance"] = {
        "source": "orchestr8.build_spec_council",
        "method": "multi_agent_pipeline",
        "rule_or_model_version": "build_spec_v1",
        "confidence": confidence if confidence is not None else 0.0,
        "verification_status": status,
        "run_id": run_id,
        "council": council,
        "roles": list(roles),
    }
    return out


def build_spec_from_committee_result(result: dict, *, question: str) -> dict:
    """Extract + stamp a build spec from a run_job result, or raise."""
    # Prefer the final text; fall back to walking the trace newest-first.
    texts = [result.get("text") or ""]
    for step in reversed(result.get("trace") or []):
        texts.append(step.get("text") or "")
        structured = step.get("structured")
        if isinstance(structured, dict) and _looks_like_spec(structured):
            texts.insert(0, json.dumps(structured))

    spec = None
    for t in texts:
        spec = extract_build_spec(t)
        if spec:
            break
    if not spec:
        raise ValueError(
            "No build_spec JSON found in committee output. "
            "Architect/synthesizer must append a fenced ```json build-spec block."
        )

    # Fill id/title from question if agents omitted them.
    if not spec.get("id"):
        slug = re.sub(r"[^a-z0-9]+", "-", (question or "spec").lower()).strip("-")[:48]
        spec["id"] = slug or "build-spec"
    if not spec.get("title"):
        spec["title"] = (question or "Build spec")[:120]

    confs = [
        s.get("confidence")
        for s in (result.get("trace") or [])
        if isinstance(s.get("confidence"), (int, float))
    ]
    avg_conf = round(sum(confs) / len(confs), 3) if confs else None

    stamped = attach_provenance(
        spec,
        run_id=result.get("runId"),
        council=result.get("council"),
        roles=result.get("roles") or [],
        vote=result.get("vote"),
        confidence=avg_conf,
    )
    return stamped
