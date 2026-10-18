#!/usr/bin/env python3
"""O2 diff review CLI (ADR 0003): score a Cursor diff against its build spec.

    git diff main...HEAD | python scripts/review_diff.py --spec-id o2-diff-review
    python scripts/review_diff.py --spec-id o2-diff-review --diff my.patch --offline

--offline runs the rule precheck only (no model call). Without it the Challenge Council
(critic, tester, domain_expert) reviews too, which costs a model run. The review is written
under docs/specs/reviews/ and the verdict is printed; exit code 0 approve, 1 conditional, 2 reject.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from services.diff_review import DiffReviewError, review_diff, write_review  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--spec-id", required=True)
    ap.add_argument("--diff", help="diff file (default: stdin)")
    ap.add_argument("--offline", action="store_true", help="rule precheck only; no model call")
    ap.add_argument("--json", action="store_true", help="print the full bundle")
    args = ap.parse_args()
    diff_text = open(args.diff, encoding="utf-8").read() if args.diff else sys.stdin.read()
    try:
        bundle = review_diff(args.spec_id, diff_text, offline=args.offline)
    except DiffReviewError as e:
        print(f"diff review: {e}", file=sys.stderr)
        return 3
    path = write_review(bundle)
    if args.json:
        print(json.dumps(bundle, indent=2, ensure_ascii=False))
    else:
        print(f"{bundle['verdict'].upper()} · {args.spec_id} · {len(bundle['findings'])} finding(s) · {path}")
        for f in bundle["findings"]:
            print(f"  - {f['severity']} ({f['source']}): {f['detail']}")
    return {"approve": 0, "conditional": 1, "reject": 2}[bundle["verdict"]]


if __name__ == "__main__":
    raise SystemExit(main())
