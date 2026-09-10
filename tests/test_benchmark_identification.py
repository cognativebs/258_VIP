"""Phase 0 identification benchmark — no provider calls."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "benchmark_identification.py"


def test_demo_report_metrics():
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--demo"],
        check=True,
        capture_output=True,
        text=True,
    )
    report = json.loads(proc.stdout)
    assert report["caseCount"] == 3
    fixture = next(a for a in report["adapters"] if a["adapterId"] == "fixture-catalog")
    assert fixture["top1Accuracy"] == 1
    assert fixture["exactParallelAccuracy"] == 0.5
    assert fixture["cardNumberAccuracy"] == 1
    assert fixture["callsConsumed"] == 2
    tcgdex = next(a for a in report["adapters"] if a["adapterId"] == "tcgdex")
    assert tcgdex["failureRate"] == 1
    assert report["overall"]["callsConsumed"] == 3
