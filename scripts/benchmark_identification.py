#!/usr/bin/env python3
"""Identification benchmark harness (plan 0001 Phase 0).

Scores a JSON list of predicted-vs-expected cases. Does not call providers.

    python scripts/benchmark_identification.py --demo
    python scripts/benchmark_identification.py --input cases.json

Case shape (also defined in @vip/scan-ingest IdentificationBenchmarkCase):

    {
      "id": "1",
      "adapterId": "fixture-catalog",
      "predictedCatalogKey": "...",
      "predictedCollectorNumber": "136",
      "predictedParallel": "silver",
      "predictedConfidence": 0.95,
      "expectedCatalogKey": "...",
      "expectedCollectorNumber": "136",
      "expectedParallel": "silver",
      "confirmedCorrect": null,
      "failed": false,
      "providerCalls": 1
    }
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

BANDS = (
    ("high", 0.9, 1.0001),
    ("mid", 0.45, 0.9),
    ("low", 0.0, 0.45),
)


def _norm(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def _ratio(correct: int, total: int) -> float | None:
    if total == 0:
        return None
    return round(correct / total, 4)


def _top1(row: dict[str, Any]) -> bool | None:
    if row.get("failed"):
        return False
    if row.get("confirmedCorrect") is not None:
        return bool(row["confirmedCorrect"])
    pred = _norm(row.get("predictedCatalogKey"))
    exp = _norm(row.get("expectedCatalogKey"))
    if not pred or not exp:
        return None
    return pred == exp


def _parallel(row: dict[str, Any]) -> bool | None:
    exp = _norm(row.get("expectedParallel"))
    if not exp:
        return None
    if row.get("failed"):
        return False
    return _norm(row.get("predictedParallel")) == exp


def _number(row: dict[str, Any]) -> bool | None:
    exp = _norm(row.get("expectedCollectorNumber"))
    if not exp:
        return None
    if row.get("failed"):
        return False
    return _norm(row.get("predictedCollectorNumber")) == exp


def score_slice(adapter_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    top1_ok = top1_n = 0
    par_ok = par_n = 0
    num_ok = num_n = 0
    failed = 0
    calls = 0
    calibration = []
    for name, lo, hi in BANDS:
        in_band = [
            r
            for r in rows
            if r.get("predictedConfidence") is not None
            and lo <= float(r["predictedConfidence"]) < hi
        ]
        correct = sum(1 for r in in_band if _top1(r) is True)
        calibration.append(
            {
                "band": name,
                "minInclusive": lo,
                "maxExclusive": hi,
                "count": len(in_band),
                "correct": correct,
                "accuracy": _ratio(correct, len(in_band)),
            }
        )
    for row in rows:
        calls += int(row.get("providerCalls") or 0)
        if row.get("failed"):
            failed += 1
        t1 = _top1(row)
        if t1 is not None:
            top1_n += 1
            top1_ok += int(t1)
        p = _parallel(row)
        if p is not None:
            par_n += 1
            par_ok += int(p)
        n = _number(row)
        if n is not None:
            num_n += 1
            num_ok += int(n)
    return {
        "adapterId": adapter_id,
        "cases": len(rows),
        "top1Accuracy": _ratio(top1_ok, top1_n),
        "exactParallelAccuracy": _ratio(par_ok, par_n),
        "cardNumberAccuracy": _ratio(num_ok, num_n),
        "failureRate": 0 if not rows else round(failed / len(rows), 4),
        "callsConsumed": calls,
        "calibration": calibration,
    }


def score_cases(cases: list[dict[str, Any]]) -> dict[str, Any]:
    by_adapter: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cases:
        by_adapter[str(row.get("adapterId") or "merged")].append(row)
    adapters = [score_slice(aid, rows) for aid, rows in sorted(by_adapter.items())]
    return {
        "ruleOrModelVersion": "catalog-resolver@0.1.0",
        "caseCount": len(cases),
        "adapters": adapters,
        "overall": score_slice("overall", cases),
    }


DEMO_CASES = [
    {
        "id": "1",
        "adapterId": "fixture-catalog",
        "predictedCatalogKey": "sports:prizm:wemby:136",
        "predictedCollectorNumber": "136",
        "predictedParallel": "silver",
        "predictedConfidence": 0.95,
        "expectedCatalogKey": "sports:prizm:wemby:136",
        "expectedCollectorNumber": "136",
        "expectedParallel": "silver",
        "failed": False,
        "providerCalls": 1,
    },
    {
        "id": "2",
        "adapterId": "fixture-catalog",
        "predictedCatalogKey": "sports:prizm:wemby:136",
        "predictedCollectorNumber": "136",
        "predictedParallel": "base",
        "predictedConfidence": 0.92,
        "expectedCatalogKey": "sports:prizm:wemby:136",
        "expectedCollectorNumber": "136",
        "expectedParallel": "red ice",
        "failed": False,
        "providerCalls": 1,
    },
    {
        "id": "3",
        "adapterId": "tcgdex",
        "predictedCatalogKey": None,
        "predictedCollectorNumber": None,
        "predictedParallel": None,
        "predictedConfidence": None,
        "expectedCatalogKey": "pokemon:base-set:4:charizard",
        "expectedCollectorNumber": "4",
        "expectedParallel": None,
        "failed": True,
        "providerCalls": 1,
    },
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, help="JSON file: array of cases or {cases: [...]}")
    ap.add_argument("--demo", action="store_true", help="Score the built-in fixture cases")
    args = ap.parse_args()

    if args.demo:
        cases = DEMO_CASES
    elif args.input:
        payload = json.loads(args.input.read_text())
        cases = payload["cases"] if isinstance(payload, dict) and "cases" in payload else payload
        if not isinstance(cases, list):
            print("input must be a JSON array of cases", file=sys.stderr)
            return 2
    else:
        print("pass --demo or --input path", file=sys.stderr)
        return 2

    report = score_cases(cases)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
