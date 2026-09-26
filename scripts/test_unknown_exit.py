"""Unknown-exit impact matches the TS contract and never touches holdings."""
from __future__ import annotations

import unittest

from unknown_exit import evaluate_unknown_exit_impact, gifted_share

JULY = {
    "catalogHoldings": 2700,
    "catalogValue": 24238,
    "scopeName": "General Inventory",
    "scopeHoldings": 1044,
    "scopeValue": 3640,
}


class UnknownExitImpactTests(unittest.TestCase):
    def test_thousand_bulk_is_a_range_not_a_point(self) -> None:
        impact = evaluate_unknown_exit_impact(JULY, 1000)
        self.assertEqual(impact["method"], "inferred")
        self.assertEqual(impact["verificationStatus"], "unverified")
        self.assertFalse(impact["holdingsTouched"])
        self.assertFalse(impact["titlesInvented"])
        self.assertEqual(impact["physicalValueHigh"], 24238)
        expected_low = round(24238 - 3640 * (1000 / 1044), 2)
        self.assertEqual(impact["physicalValueLow"], expected_low)
        self.assertLess(impact["physicalValueLow"], impact["physicalValueHigh"])
        self.assertEqual(impact["physicalHoldingsLow"], 1700)
        self.assertEqual(impact["recommendations"][0]["action"], "Pass")
        self.assertIn("DO_NOT_DELETE_HOLDINGS", impact["recommendations"][0]["reasonCodes"])
        self.assertEqual(impact["recommendations"][1]["action"], "Hold")
        self.assertNotIn("giftedHoldingIds", impact)

    def test_qty_over_scope_caps_at_general_inventory(self) -> None:
        impact = evaluate_unknown_exit_impact(JULY, 5000)
        self.assertEqual(impact["giftedShare"], 1)
        self.assertEqual(impact["unaccountedValueHigh"], 3640)
        self.assertEqual(impact["physicalValueLow"], 20598)
        self.assertEqual(gifted_share(1000, 1044), 1000 / 1044)


if __name__ == "__main__":
    unittest.main()
