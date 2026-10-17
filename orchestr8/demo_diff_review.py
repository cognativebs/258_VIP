#!/usr/bin/env python3
"""O2 offline gate — diff review catches a spec-violating diff (no API keys).

    python demo_diff_review.py

Proves, against docs/specs/o2-diff-review.json:
  1. A diff that omits the schema and adds no test or demo is rejected by the precheck
  2. A conforming diff passes the precheck (approve offline)
  3. A conforming diff the council marks conditional comes back conditional with findings
  4. A council veto rejects even a conforming diff
  5. The review artifact is written with provenance and matches its schema

Exit 0 on PASS.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from services.contracts import validate_instance  # noqa: E402
from services.diff_review import _schema, required_paths, load_spec, review_diff, write_review  # noqa: E402

SPEC = "o2-diff-review"


def _file(path: str, body: str = "x = 1") -> str:
    return f"diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1 @@\n+{body}\n"


def conforming_diff() -> str:
    return "".join(_file(p) for p in required_paths(load_spec(SPEC)))


def violating_diff() -> str:
    # Service and CLI only: no schema, no demo / test, no backlog.
    return _file("orchestr8/services/diff_review.py") + _file("orchestr8/scripts/review_diff.py")


def fake_council(verdict: str, vetoed: bool = False, issues: list | None = None):
    def run_job(**kwargs):
        assert kwargs["roles"] == ["critic", "tester", "domain_expert"] and kwargs["council"] == "challenge"
        return {
            "runId": "run_demo_o2",
            "roles": kwargs["roles"],
            "text": "council text",
            "trace": [{"role": "critic", "structured": {"verdict": verdict, "issues": issues or []}}],
            "vote": {"verdict": verdict, "vetoed": vetoed, "summary": f"council {verdict}"},
        }

    return run_job


def main() -> int:
    checks: list[tuple[str, bool]] = []

    bad = review_diff(SPEC, violating_diff(), offline=True)
    checks.append(("violating diff is rejected", bad["verdict"] == "reject"))
    checks.append(("schema file reported missing", "orchestr8/config/diff_review.schema.json" in bad["precheck"]["missing_paths"]))
    checks.append(("missing acceptance test is critical", any(f["criterion"] == "acceptance tests" and f["severity"] == "critical" for f in bad["findings"])))

    good = review_diff(SPEC, conforming_diff(), offline=True)
    checks.append(("conforming diff approved offline", good["verdict"] == "approve" and good["precheck"]["missing_paths"] == []))
    checks.append(("demo counted as a test", "orchestr8/demo_diff_review.py" in good["precheck"]["test_paths"]))

    cond = review_diff(
        SPEC,
        conforming_diff(),
        run_job_impl=fake_council("conditional", issues=[{"severity": "major", "criterion": "acceptance test 3", "detail": "artifact path not shown"}]),
    )
    checks.append(("council conditional -> conditional", cond["verdict"] == "conditional"))
    checks.append(("council finding listed", any(f["source"] == "council" for f in cond["findings"])))
    checks.append(("council run recorded", cond["council"]["run_id"] == "run_demo_o2"))

    veto = review_diff(SPEC, conforming_diff(), run_job_impl=fake_council("reject", vetoed=True))
    checks.append(("council veto rejects", veto["verdict"] == "reject"))

    with tempfile.TemporaryDirectory() as tmp:
        path = write_review(cond, Path(tmp))
        stored = json.loads(path.read_text(encoding="utf-8"))
        checks.append(("artifact written (.json + .md)", path.exists() and path.with_suffix(".md").exists()))
        checks.append(("artifact matches schema", validate_instance(stored, _schema()) == []))
        checks.append(("provenance populated", stored["provenance"]["method"] == "rule_precheck+challenge_council" and stored["provenance"]["source"]))
        try:
            write_review(cond, Path(tmp))
            checks.append(("artifact is immutable", False))
        except FileExistsError:
            checks.append(("artifact is immutable", True))

    failed = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{'PASS' if not failed else 'FAIL'} - {len(checks) - len(failed)}/{len(checks)} O2 offline checks.")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
