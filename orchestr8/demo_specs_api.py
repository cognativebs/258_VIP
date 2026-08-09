#!/usr/bin/env python3
"""Offline smoke for GET /v1/specs (Orchestr8 Console gate support)."""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from api.specs_routes import handle_get_spec, handle_list_specs  # noqa: E402


def main() -> int:
    status, body = handle_list_specs()
    ids = {s["id"] for s in body.get("specs") or []}
    checks = [
        ("list 200", status == 200),
        ("has orchestr8-runs-api", "orchestr8-runs-api" in ids),
        ("has o2-diff-review", "o2-diff-review" in ids),
    ]
    st2, one = handle_get_spec("orchestr8-runs-api")
    checks.append(("get 200", st2 == 200))
    checks.append(("get has markdown", bool(one.get("markdown"))))
    st3, missing = handle_get_spec("does-not-exist-xyz")
    checks.append(("missing 404", st3 == 404 and missing.get("error") == "not_found"))

    passed = 0
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        passed += int(ok)
    print()
    if passed == len(checks):
        print(f"PASS - {passed}/{len(checks)} specs API checks.")
        return 0
    print(f"FAIL - {passed}/{len(checks)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
