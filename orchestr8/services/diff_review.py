"""O2 diff review (ADR 0003, build spec docs/specs/o2-diff-review.json).

After Cursor implements a build spec, the operator pastes the diff back. Two passes score it:

1. Rule precheck (deterministic, no model): every path the spec's contracts_first and file_plan
   create or modify must appear in the diff; a spec with acceptance tests needs at least one test
   or demo file in the diff. A missing required path or a missing test is critical.
2. Challenge Council (critic, tester, domain_expert; veto_on_critical): judges the diff against
   the acceptance tests only, not style.

Verdict: any critical precheck finding or a council veto rejects; a major finding or a council
"conditional" caps it at conditional; otherwise approve. The bundle is validated against
config/diff_review.schema.json and written under docs/specs/reviews/ with provenance.
Autonomy 0: nothing here writes or runs the reviewed code.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from services.contracts import validate_instance

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent
SPECS_DIR = REPO_ROOT / "docs" / "specs"
REVIEWS_DIR = SPECS_DIR / "reviews"
SCHEMA_PATH = ROOT / "config" / "diff_review.schema.json"
RULE_VERSION = "diff_review_v1"
CHALLENGE_ROLES = ["critic", "tester", "domain_expert"]
# Large diffs are cut for the council (the precheck always reads the whole diff) and say so.
MAX_COUNCIL_DIFF_CHARS = 60_000
_TEST_PATH = re.compile(r"(^|/)(tests?/|test_[^/]*$|[^/]*\.test\.[a-z]+$|[^/]*_test\.[a-z]+$|demo_[^/]*$)")


class DiffReviewError(ValueError):
    pass


@lru_cache(maxsize=1)
def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def load_spec(spec_id: str) -> dict:
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,120}", spec_id or ""):
        raise DiffReviewError(f"invalid spec id: {spec_id!r}")
    path = SPECS_DIR / f"{spec_id}.json"
    if not path.exists():
        raise DiffReviewError(f"build spec not found: docs/specs/{spec_id}.json")
    return json.loads(path.read_text(encoding="utf-8"))


def parse_diff(diff_text: str) -> dict:
    """Files touched (new path for renames) with line counts, from a unified / git diff."""
    files: list[str] = []
    additions = deletions = 0
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            m = re.match(r"diff --git a/(.+?) b/(.+)$", line)
            if m and m.group(2) not in files:
                files.append(m.group(2))
        elif line.startswith("+++ "):
            target = line[4:].strip()
            if target != "/dev/null":
                target = target[2:] if target.startswith("b/") else target
                if target not in files:
                    files.append(target)
        elif line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return {"files": files, "additions": additions, "deletions": deletions}


def required_paths(spec: dict) -> list[str]:
    out: list[str] = []
    for item in spec.get("contracts_first") or []:
        path = (item or {}).get("path")
        if path and path not in out:
            out.append(path)
    for item in spec.get("file_plan") or []:
        path, action = (item or {}).get("path"), (item or {}).get("action")
        if path and action in ("create", "modify") and path not in out:
            out.append(path)
    return out


def precheck(spec: dict, diff_text: str) -> tuple[dict, list[dict]]:
    stats = parse_diff(diff_text)
    touched = set(stats["files"])
    required = required_paths(spec)
    # Bookkeeping files (backlog, READMEs) are listed but never block a review.
    missing = [p for p in required if p not in touched]
    tests = [p for p in stats["files"] if _TEST_PATH.search(p)]
    findings: list[dict] = []
    for p in missing:
        doc = p.endswith(".md")
        findings.append(
            {
                "severity": "minor" if doc else "critical",
                "criterion": "file plan",
                "detail": f"The spec plans {p}; the diff does not touch it.",
                "source": "precheck",
            }
        )
    if (spec.get("acceptance_tests") or []) and not tests:
        findings.append(
            {
                "severity": "critical",
                "criterion": "acceptance tests",
                "detail": f"The spec lists {len(spec['acceptance_tests'])} acceptance test(s); the diff adds or changes no test or demo file.",
                "source": "precheck",
            }
        )
    truncated = len(diff_text) > MAX_COUNCIL_DIFF_CHARS
    if truncated:
        findings.append(
            {
                "severity": "minor",
                "criterion": "review coverage",
                "detail": f"Diff is {len(diff_text):,} characters; the council read the first {MAX_COUNCIL_DIFF_CHARS:,}. The precheck read all of it.",
                "source": "precheck",
            }
        )
    result = {
        "required_paths": required,
        "missing_paths": missing,
        "test_paths": tests,
        "diff_stats": {**stats, "chars": len(diff_text), "truncated": truncated},
    }
    return result, findings


def council_question(spec: dict, diff_text: str, pre: dict) -> str:
    tests = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(spec.get("acceptance_tests") or [])) or "(none listed)"
    shown = diff_text[:MAX_COUNCIL_DIFF_CHARS]
    missing_code = [p for p in pre["missing_paths"] if not p.endswith(".md")]
    missing_docs = [p for p in pre["missing_paths"] if p.endswith(".md")]
    return "\n\n".join(
        [
            f"Review this implementation diff against build spec `{spec.get('id')}` ({spec.get('title', '')}).",
            f"Goal: {spec.get('goal', '')}",
            f"Acceptance tests:\n{tests}",
            f"Rule precheck (already scored, do not repeat it): missing planned code paths {missing_code or 'none'}; "
            f"missing planned documentation {missing_docs or 'none'}; test or demo files in the diff {pre['test_paths'] or 'none'}.",
            "Judge only whether the code meets the goal and each acceptance test and respects the constraints. Ignore style. "
            "Documentation and bookkeeping files (backlog, READMEs) are never critical: mention them as minor at most. "
            "A critical issue is an acceptance test the code cannot pass, or a broken constraint. "
            "End with one fenced json block: {\"verdict\": \"approve|conditional|reject\", \"confidence\": 0.0-1.0, "
            "\"issues\": [{\"severity\": \"critical|major|minor\", \"criterion\": \"which acceptance test or constraint\", \"detail\": \"...\"}], "
            "\"conditions\": [\"what must change before approval\"], \"summary\": \"one sentence\"}.",
            f"Diff{' (truncated)' if pre['diff_stats']['truncated'] else ''}:\n```diff\n{shown}\n```",
        ]
    )


def _council_from_result(result: dict) -> tuple[dict, list[dict]]:
    vote = result.get("vote") or {}
    findings: list[dict] = []
    for step in result.get("trace") or []:
        s = step.get("structured") or {}
        for issue in s.get("issues") if isinstance(s.get("issues"), list) else []:
            if not isinstance(issue, dict) or issue.get("severity") not in ("critical", "major", "minor"):
                continue
            detail = str(issue.get("detail") or issue.get("description") or "").strip()
            if not detail:
                continue
            findings.append(
                {
                    "severity": issue["severity"],
                    "criterion": str(issue.get("criterion") or step.get("role") or "council"),
                    "detail": f"{step.get('role', 'council')}: {detail}"[:800],
                    "source": "council",
                }
            )
    verdict = vote.get("verdict") if vote.get("verdict") in ("approve", "conditional", "reject") else "unparsed"
    council = {
        "run_id": result.get("runId"),
        "roles": list(result.get("roles") or CHALLENGE_ROLES),
        "vetoed": bool(vote.get("vetoed")),
        "verdict": verdict,
        "summary": str(vote.get("summary") or result.get("text") or "")[:1200],
    }
    return council, findings


def decide(findings: list[dict], council: dict | None) -> str:
    if any(f["severity"] == "critical" for f in findings if f["source"] == "precheck"):
        return "reject"
    if council and (council["vetoed"] or council["verdict"] == "reject"):
        return "reject"
    if any(f["severity"] in ("critical", "major") for f in findings) or (council and council["verdict"] in ("conditional", "unparsed")):
        return "conditional"
    return "approve"


def new_review_id(now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%S")
    return f"review_{stamp}_{uuid.uuid4().hex[:8]}"


def review_diff(
    spec_id: str,
    diff_text: str,
    *,
    offline: bool = False,
    run_job_impl: Callable[..., dict] | None = None,
    model_overrides: dict | None = None,
    now: datetime | None = None,
) -> dict:
    """Score a diff. offline=True runs the rule precheck only (no model call, no cost)."""
    if not (diff_text or "").strip():
        raise DiffReviewError("diff_text is empty")
    spec = load_spec(spec_id)
    pre, findings = precheck(spec, diff_text)
    council = None
    if not offline:
        if run_job_impl is None:
            from services.orchestrator import run_job as run_job_impl  # noqa: PLC0415
        result = run_job_impl(
            task="diff_review",
            roles=list(CHALLENGE_ROLES),
            mode="pipeline",
            question=council_question(spec, diff_text, pre),
            context_json=json.dumps({"spec": spec, "precheck": pre}),
            model_overrides=model_overrides or {},
            council="challenge",
        )
        council, council_findings = _council_from_result(result)
        findings = findings + council_findings
    verdict = decide(findings, council)
    bundle = {
        "schema": "diff_review_v1",
        "id": new_review_id(now),
        "spec_id": spec_id,
        "created_at": (now or datetime.now(timezone.utc)).isoformat(),
        "verdict": verdict,
        "findings": findings,
        "precheck": pre,
        "council": council,
        "provenance": {
            "source": "orchestr8.diff_review",
            "method": "rule_precheck" if offline else "rule_precheck+challenge_council",
            "rule_version": RULE_VERSION,
            # The precheck is certain about what it checks; a council verdict is a judgment.
            "confidence": 0.9 if offline else 0.7,
            "verification": "unverified" if offline or council is None or council["verdict"] == "unparsed" else "council_reviewed",
        },
    }
    errs = validate_instance(bundle, _schema())
    if errs:
        raise DiffReviewError("review bundle failed schema: " + "; ".join(errs[:5]))
    return bundle


def render_markdown(bundle: dict) -> str:
    lines = [
        f"# Diff review — {bundle['spec_id']}",
        "",
        f"**Verdict:** {bundle['verdict']}  ",
        f"**Review:** `{bundle['id']}` · {bundle['created_at']}  ",
        f"**Method:** {bundle['provenance']['method']} · confidence {bundle['provenance']['confidence']} · {bundle['provenance']['verification']}",
        "",
        "## Findings",
        "",
    ]
    if not bundle["findings"]:
        lines.append("None.")
    for f in bundle["findings"]:
        lines.append(f"- **{f['severity']}** ({f['source']}, {f['criterion']}): {f['detail']}")
    pre = bundle["precheck"]
    lines += [
        "",
        "## Precheck",
        "",
        f"- Files in diff: {len(pre['diff_stats']['files'])} (+{pre['diff_stats']['additions']} / -{pre['diff_stats']['deletions']}){' · truncated for the council' if pre['diff_stats']['truncated'] else ''}",
        f"- Planned paths missing: {', '.join(pre['missing_paths']) or 'none'}",
        f"- Test or demo files: {', '.join(pre['test_paths']) or 'none'}",
    ]
    if bundle["council"]:
        c = bundle["council"]
        lines += ["", "## Challenge Council", "", f"- Run: `{c['run_id']}` · roles {', '.join(c['roles'])}", f"- Verdict: {c['verdict']}{' (vetoed)' if c['vetoed'] else ''}", f"- {c['summary']}"]
    return "\n".join(lines) + "\n"


def write_review(bundle: dict, reviews_dir: Path | None = None) -> Path:
    """Immutable: one .json + .md per review id; an existing id is never overwritten."""
    out = reviews_dir or REVIEWS_DIR
    out.mkdir(parents=True, exist_ok=True)
    stem = f"{bundle['spec_id']}--{bundle['id']}"
    json_path = out / f"{stem}.json"
    if json_path.exists():
        raise FileExistsError(f"review {bundle['id']} already written")
    json_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"{stem}.md").write_text(render_markdown(bundle), encoding="utf-8")
    return json_path


def list_reviews(reviews_dir: Path | None = None, limit: int = 50) -> list[dict[str, Any]]:
    out = reviews_dir or REVIEWS_DIR
    if not out.exists():
        return []
    rows = []
    for path in sorted(out.glob("*.json"), reverse=True)[:limit]:
        try:
            b = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        rows.append({"id": b.get("id"), "spec_id": b.get("spec_id"), "created_at": b.get("created_at"), "verdict": b.get("verdict"), "findings": len(b.get("findings") or []), "method": (b.get("provenance") or {}).get("method")})
    return sorted(rows, key=lambda r: str(r["created_at"]), reverse=True)
