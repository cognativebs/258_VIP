from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from clz_diff_classify import ExistingClzHolding, classify_clz_diff  # noqa: E402


class ClzDiffClassifyTests(unittest.TestCase):
    def test_new_changed_unchanged_disappeared(self) -> None:
        existing = {
            "A": ExistingClzHolding("A", current_price=10.0, quantity=1),
            "B": ExistingClzHolding("B", current_price=5.0, quantity=1),
            "C": ExistingClzHolding("C", current_price=8.0, quantity=2),
        }
        incoming = {
            "A": {"id": "A", "Current Price": 12, "Quantity": 1},
            "C": {"id": "C", "Current Price": 8, "Quantity": 2},
            "D": {"id": "D", "Current Price": 3, "Quantity": 1},
        }
        diff = classify_clz_diff(existing, incoming)
        self.assertEqual([r.source_row_id for r in diff.new], ["D"])
        self.assertEqual([r.source_row_id for r in diff.changed], ["A"])
        self.assertEqual(diff.changed[0].changed_fields, ["Current Price"])
        self.assertEqual(diff.changed[0].change_types, ["clz_value_drift"])
        self.assertEqual([r.source_row_id for r in diff.unchanged], ["C"])
        self.assertEqual([r.source_row_id for r in diff.disappeared], ["B"])
        self.assertFalse(diff.disappeared[0].possibly_sold)
        self.assertEqual(diff.disappeared[0].change_types, ["ownership_sold"])

    def test_disappeared_is_never_a_delete_class(self) -> None:
        existing = {"Z": ExistingClzHolding("Z", current_price=1.0, quantity=1)}
        diff = classify_clz_diff(existing, {})
        self.assertEqual(diff.disappeared[0].classification, "disappeared")
        self.assertFalse(diff.disappeared[0].possibly_sold)

    def test_change_types_are_separated(self) -> None:
        from clz_diff_classify import change_types_for

        self.assertEqual(change_types_for("new", []), ["ownership_new"])
        self.assertEqual(change_types_for("disappeared", []), ["ownership_sold"])
        self.assertEqual(change_types_for("changed", ["Quantity"]), ["ownership_quantity"])
        self.assertEqual(change_types_for("changed", ["Slab Status", "Grade Rating"]), ["condition_grade"])
        self.assertEqual(change_types_for("changed", ["Current Price"]), ["clz_value_drift"])
        self.assertEqual(change_types_for("changed", ["Location"]), ["metadata_only"])
        self.assertEqual(
            change_types_for("changed", ["Current Price", "Location"]),
            ["clz_value_drift"],
        )


if __name__ == "__main__":
    unittest.main()
