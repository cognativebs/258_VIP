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
# Anchor for brace-walk recovery when nested ``` inside cursor_prompt breaks fences.
_SPEC_ANCHOR = re.compile(
    r'"schema"\s*:\s*"build_spec_v1"|"id"\s*:\s*"[^"]+"\s*,\s*"title"',
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _extract_balanced_object(text: str, start: int) -> str | None:
    """Return substring of a JSON object starting at ``start`` ('{'), respecting strings."""
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _brace_walk_specs(text: str) -> list[dict]:
    """Find build_spec objects even when markdown fences are nested/broken."""
    found: list[dict] = []
    for m in _SPEC_ANCHOR.finditer(text):
        # Walk left to the opening brace of this object.
        brace = text.rfind("{", 0, m.start())
        if brace < 0:
            continue
        # Prefer the nearest '{' that still contains the match.
        raw = _extract_balanced_object(text, brace)
        # If nearest brace failed, try a few earlier braces (prose noise).
        if not raw:
            for _ in range(5):
                brace = text.rfind("{", 0, brace)
                if brace < 0:
                    break
                raw = _extract_balanced_object(text, brace)
                if raw and m.start() < brace + len(raw):
                    break
                raw = None
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and _looks_like_spec(obj):
            found.append(obj)
    return found


def looks_like_truncated_build_spec(text: str) -> bool:
    """True when a build_spec was started but cut off (max_tokens) before valid JSON closed."""
    if not text:
        return False
    if extract_build_spec(text):
        return False
    has_anchor = bool(_SPEC_ANCHOR.search(text))
    if not has_anchor:
        return False
    # Odd fence count ⇒ opened ```json without closing fence (classic truncation).
    if text.count("```") % 2 == 1:
        return True
    # Anchor present but brace-walk cannot balance ⇒ mid-object cutoff.
    return True


def extract_build_spec(text: str) -> dict | None:
    """Pull a build-spec object from agent prose (fenced JSON, or brace-walk recovery)."""
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
    # Nested ``` inside cursor_prompt commonly breaks fences — recover via brace walk.
    if not candidates:
        candidates.extend(_brace_walk_specs(text))
    else:
        # Prefer brace-walk if it finds a later/longer valid spec (truncated fence case).
        for obj in _brace_walk_specs(text):
            if obj not in candidates:
                candidates.append(obj)
    return candidates[-1] if candidates else None


def _looks_like_spec(obj: dict) -> bool:
    # Prefer explicit shape; fall back to key presence.
    if obj.get("schema") == "build_spec_v1":
        return True
    keys = {"goal", "cursor_prompt", "file_plan", "acceptance_tests"}
    return keys.issubset(obj.keys()) or {"id", "title", "goal", "cursor_prompt"}.issubset(obj.keys())


def normalize_build_spec(spec: dict) -> dict:
    """Coerce common Architect shape drift so schema validation can pass."""
    out = dict(spec)

    # contracts_first sometimes arrives as a single object or {schemas:[...]}
    cf = out.get("contracts_first")
    if isinstance(cf, dict):
        if isinstance(cf.get("schemas"), list):
            items = []
            for s in cf["schemas"]:
                if isinstance(s, dict):
                    items.append(
                        {
                            "path": str(s.get("location") or s.get("path") or "packages/…"),
                            "change": str(
                                s.get("description")
                                or s.get("change")
                                or s.get("name")
                                or json.dumps(s)[:200]
                            ),
                        }
                    )
            out["contracts_first"] = items or [
                {"path": "n/a", "change": str(cf.get("description") or "see goal")}
            ]
        else:
            out["contracts_first"] = [
                {
                    "path": str(cf.get("path") or cf.get("location") or "n/a"),
                    "change": str(cf.get("change") or cf.get("description") or json.dumps(cf)[:240]),
                }
            ]
    elif not isinstance(cf, list) or not cf:
        out["contracts_first"] = [{"path": "n/a", "change": "No new contracts — UI-only change"}]

    # file_plan: ensure notes + allowed actions
    plan = []
    for item in out.get("file_plan") or []:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "modify").lower()
        if action not in {"create", "modify", "delete", "leave"}:
            # architects invent discover/modify_or_create
            if "create" in action:
                action = "create"
            elif "delete" in action:
                action = "delete"
            else:
                action = "modify"
        plan.append(
            {
                "path": str(item.get("path") or "unknown"),
                "action": action,
                "notes": str(item.get("notes") or item.get("instruction") or item.get("description") or ""),
            }
        )
    out["file_plan"] = plan or [{"path": "apps/orchestr8-console", "action": "modify", "notes": "see goal"}]

    def _as_str_list(val: Any, *, fallback: str) -> list[str]:
        if not val:
            return [fallback]
        out_list: list[str] = []
        for item in val if isinstance(val, list) else [val]:
            if isinstance(item, str):
                out_list.append(item)
            elif isinstance(item, dict):
                out_list.append(
                    str(
                        item.get("text")
                        or item.get("test")
                        or item.get("risk")
                        or item.get("description")
                        or item.get("id")
                        or json.dumps(item)[:240]
                    )
                )
            else:
                out_list.append(str(item))
        return out_list or [fallback]

    out["acceptance_tests"] = _as_str_list(out.get("acceptance_tests"), fallback="Manual smoke on Console load")
    out["risks"] = _as_str_list(out.get("risks"), fallback="Low — UI-only")
    if out.get("out_of_scope") is not None:
        out["out_of_scope"] = _as_str_list(out.get("out_of_scope"), fallback="")
        out["out_of_scope"] = [x for x in out["out_of_scope"] if x]
    if not isinstance(out.get("constraints"), list) or not out["constraints"]:
        out["constraints"] = ["Stay within stated goal; no scope creep"]
    else:
        out["constraints"] = _as_str_list(out["constraints"], fallback="Stay within stated goal")

    if not out.get("cursor_prompt") or len(str(out.get("cursor_prompt"))) < 40:
        out["cursor_prompt"] = (
            f"Implement: {out.get('title') or out.get('goal')}\n\n"
            f"Goal: {out.get('goal')}\n"
            f"Follow file_plan and acceptance_tests in this build spec."
        )

    return out


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
    spec = normalize_build_spec(spec)
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
    # Prefer Architect (owns the JSON), then other trace steps, then final text.
    texts: list[str] = []
    for step in result.get("trace") or []:
        if step.get("role") in ("architect", "synthesizer"):
            texts.append(step.get("text") or "")
            structured = step.get("structured")
            if isinstance(structured, dict) and _looks_like_spec(structured):
                texts.insert(0, json.dumps(structured))
    for step in reversed(result.get("trace") or []):
        if step.get("role") in ("architect", "synthesizer"):
            continue
        texts.append(step.get("text") or "")
    texts.append(result.get("text") or "")

    spec = None
    for t in texts:
        spec = extract_build_spec(t)
        if spec:
            break
    if not spec:
        arch_step = next(
            (
                s
                for s in (result.get("trace") or [])
                if s.get("role") in ("architect", "synthesizer")
            ),
            None,
        )
        arch_text = (arch_step or {}).get("text") or ""
        arch_err = (arch_step or {}).get("error")
        if arch_err or arch_text.startswith("[Architect unavailable"):
            raise ValueError(
                f"Architect call failed ({arch_err or arch_text}). "
                "No build-spec JSON to emit — re-run (provider timeout/overload is usually transient)."
            )
        if looks_like_truncated_build_spec(arch_text):
            usage = (arch_step or {}).get("usage") or {}
            out_tok = usage.get("output")
            hint = f" (architect output_tokens={out_tok})" if out_tok else ""
            raise ValueError(
                "Architect build-spec JSON was truncated mid-object"
                f"{hint}. Raise architect max_tokens, keep JSON-first/compact, "
                "and re-run (or Revise from veto if applicable)."
            )
        # Domain Expert sometimes drafts a JSON block when Architect is thin — flag truncation.
        for s in result.get("trace") or []:
            if s.get("role") == "domain_expert" and looks_like_truncated_build_spec(
                s.get("text") or ""
            ):
                raise ValueError(
                    "Domain Expert build-spec JSON was truncated; Architect did not emit a complete spec. Re-run."
                )
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

    spec = normalize_build_spec(spec)

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
