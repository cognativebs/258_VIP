"""O2 diff review: rule precheck, council merge, artifact, edge cases. No network."""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

from services import diff_review as dr  # noqa: E402


def _file(path: str, sign: str = "+", body: str = "x") -> str:
    return f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n{sign}{body}\n"


SPEC = {
    "id": "fixture-spec",
    "title": "Fixture",
    "goal": "Do the thing",
    "contracts_first": [{"path": "pkg/schema.json"}],
    "file_plan": [
        {"path": "pkg/schema.json", "action": "create"},
        {"path": "pkg/service.py", "action": "create"},
        {"path": "pkg/old.py", "action": "delete"},
        {"path": "docs/backlog.md", "action": "modify"},
    ],
    "acceptance_tests": ["service returns ok"],
}


def test_parse_diff_counts_lines_and_follows_renames_and_new_files():
    text = (
        "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@\n+one\n+two\n-three\n"
        "diff --git a/old/name.py b/new/name.py\nrename from old/name.py\nrename to new/name.py\n"
        "--- /dev/null\n+++ b/brand_new.py\n@@\n+x\n"
    )
    stats = dr.parse_diff(text)
    assert stats["files"] == ["a.py", "new/name.py", "brand_new.py"]
    assert (stats["additions"], stats["deletions"]) == (3, 1)


def test_required_paths_skip_deletes_and_dedupe():
    assert dr.required_paths(SPEC) == ["pkg/schema.json", "pkg/service.py", "docs/backlog.md"]


def test_missing_code_path_and_missing_test_are_critical_missing_doc_is_minor():
    pre, findings = dr.precheck(SPEC, _file("pkg/service.py"))
    assert pre["missing_paths"] == ["pkg/schema.json", "docs/backlog.md"]
    severities = {(f["criterion"], f["severity"]) for f in findings}
    assert ("file plan", "critical") in severities
    assert ("file plan", "minor") in severities
    assert ("acceptance tests", "critical") in severities
    assert dr.decide(findings, None) == "reject"


def test_all_paths_and_a_test_file_approve_offline():
    diff = _file("pkg/schema.json") + _file("pkg/service.py") + _file("docs/backlog.md") + _file("tests/test_service.py")
    pre, findings = dr.precheck(SPEC, diff)
    assert pre["test_paths"] == ["tests/test_service.py"]
    assert findings == [] and dr.decide(findings, None) == "approve"


def test_large_diff_is_flagged_truncated_for_the_council_only(monkeypatch):
    monkeypatch.setattr(dr, "MAX_COUNCIL_DIFF_CHARS", 50)
    diff = _file("pkg/schema.json") + _file("pkg/service.py") + _file("docs/backlog.md") + _file("tests/test_service.py")
    pre, findings = dr.precheck(SPEC, diff)
    assert pre["diff_stats"]["truncated"] is True
    assert [f["severity"] for f in findings] == ["minor"]
    assert "(truncated)" in dr.council_question(SPEC, diff, pre)


def test_council_major_finding_caps_at_conditional_and_unparsed_council_is_not_approval():
    council = {"run_id": "r", "roles": ["critic"], "vetoed": False, "verdict": "approve", "summary": ""}
    assert dr.decide([{"severity": "major", "source": "council", "criterion": "c", "detail": "d"}], council) == "conditional"
    assert dr.decide([], {**council, "verdict": "unparsed"}) == "conditional"
    assert dr.decide([], {**council, "vetoed": True}) == "reject"
    assert dr.decide([], council) == "approve"


def test_bad_spec_id_and_empty_diff_are_refused():
    with pytest.raises(dr.DiffReviewError, match="invalid spec id"):
        dr.review_diff("../etc/passwd", "x", offline=True)
    with pytest.raises(dr.DiffReviewError, match="empty"):
        dr.review_diff("o2-diff-review", "  ", offline=True)
    with pytest.raises(dr.DiffReviewError, match="not found"):
        dr.review_diff("no-such-spec", "x", offline=True)


def test_cli_exit_code_follows_the_verdict(tmp_path, monkeypatch):
    patch = tmp_path / "bad.patch"
    patch.write_text(_file("orchestr8/services/diff_review.py"), encoding="utf-8")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    # Reviews from this test go to a temp dir, not docs/specs/reviews.
    code = (
        "import sys, pathlib; sys.path.insert(0, %r); import services.diff_review as d; "
        "d.REVIEWS_DIR = pathlib.Path(%r); sys.argv = ['review_diff.py', '--spec-id', 'o2-diff-review', '--diff', %r, '--offline']; "
        "import runpy; runpy.run_path(%r, run_name='__main__')"
    ) % (ORCH_ROOT, str(tmp_path / "reviews"), str(patch), os.path.join(ORCH_ROOT, "scripts", "review_diff.py"))
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, cwd=ORCH_ROOT)
    assert proc.returncode == 2, proc.stderr
    assert "REJECT" in proc.stdout
    assert list((tmp_path / "reviews").glob("*.json"))
