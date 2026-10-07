"""Unknown-exit impact: range, no invented titles, no holding deletes."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from unknown_exit import evaluate_unknown_exit_impact, gifted_share  # noqa: E402

JULY = {
    "catalogHoldings": 2700,
    "catalogValue": 24238,
    "scopeName": "General Inventory",
    "scopeHoldings": 1044,
    "scopeValue": 3640,
}


def test_thousand_bulk_is_a_range_not_a_point() -> None:
    impact = evaluate_unknown_exit_impact(JULY, 1000)
    assert impact["method"] == "inferred"
    assert impact["verificationStatus"] == "unverified"
    assert impact["holdingsTouched"] is False
    assert impact["titlesInvented"] is False
    assert impact["physicalValueHigh"] == 24238
    expected_low = round(24238 - 3640 * (1000 / 1044), 2)
    assert impact["physicalValueLow"] == expected_low
    assert impact["physicalValueLow"] < impact["physicalValueHigh"]
    assert impact["physicalHoldingsLow"] == 1700
    assert impact["recommendations"][0]["action"] == "Pass"
    assert "DO_NOT_DELETE_HOLDINGS" in impact["recommendations"][0]["reasonCodes"]
    assert impact["recommendations"][1]["action"] == "Hold"
    assert "giftedHoldingIds" not in impact


def test_qty_over_scope_caps_at_general_inventory() -> None:
    impact = evaluate_unknown_exit_impact(JULY, 5000)
    assert impact["giftedShare"] == 1
    assert impact["unaccountedValueHigh"] == 3640
    assert impact["physicalValueLow"] == 20598
    assert gifted_share(1000, 1044) == 1000 / 1044
