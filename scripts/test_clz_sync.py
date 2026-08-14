"""Tests for CLZ inbox sync delta, hash-skip, and dropped-row filter."""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
import sys

sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

from clz_delta import (  # noqa: E402
    ExistingHolding,
    compute_delta,
    holding_is_active,
    holding_row_id,
)
from clz_sync import FileHashStore, accept_inbox_drop, inbox_status, run_sync, sanitize_inbox_filename  # noqa: E402
from comics_db import HOLDINGS_SQL  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "clz-sample.xml"


class HoldingIdTests(unittest.TestCase):
    def test_prefers_explicit_id(self) -> None:
        self.assertEqual(holding_row_id({"id": "abc", "CLZ Hash": "ffff"}), "abc")

    def test_bp_plus_hash_prefix(self) -> None:
        self.assertEqual(
            holding_row_id({"BP Comic ID": "485164", "CLZ Hash": "4c446c866b374e12"}),
            "485164-4c446c86",
        )


class DeltaTests(unittest.TestCase):
    def test_added_dropped_price_changed(self) -> None:
        existing = {
            "A": ExistingHolding("A", current_price=10.0),
            "B": ExistingHolding("B", current_price=5.0),
        }
        incoming = {
            "A": {"id": "A", "Current Price": 12},
            "C": {"id": "C", "Current Price": 5},
        }
        delta = compute_delta(existing, incoming)
        self.assertEqual(delta.added, ["C"])
        self.assertEqual(delta.dropped, ["B"])
        self.assertEqual(delta.price_changed, ["A"])
        self.assertEqual(delta.updated, ["A"])
        self.assertEqual(delta.unchanged, 0)
        self.assertEqual(delta.revived, [])

    def test_revived_clears_dropped(self) -> None:
        existing = {
            "A": ExistingHolding(
                "A",
                current_price=10.0,
                dropped_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            )
        }
        incoming = {"A": {"id": "A", "Current Price": 10}}
        delta = compute_delta(existing, incoming)
        self.assertEqual(delta.revived, ["A"])
        self.assertEqual(delta.dropped, [])
        self.assertEqual(delta.price_changed, [])

    def test_unchanged_when_price_matches(self) -> None:
        existing = {"A": ExistingHolding("A", current_price=36.0)}
        incoming = {"A": {"id": "A", "Current Price": 36}}
        delta = compute_delta(existing, incoming)
        self.assertEqual(delta.unchanged, 1)
        self.assertEqual(delta.updated, [])


class ActiveFilterTests(unittest.TestCase):
    def test_dropped_row_not_active(self) -> None:
        self.assertTrue(holding_is_active({"dropped_at": None}))
        self.assertFalse(
            holding_is_active({"dropped_at": datetime(2026, 8, 13, tzinfo=timezone.utc)})
        )

    def test_holdings_sql_excludes_dropped(self) -> None:
        self.assertIn("dropped_at IS NULL", HOLDINGS_SQL)


class HashSkipTests(unittest.TestCase):
    def test_second_drop_of_same_xml_skips(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing fixture {FIXTURE}")
        tmp = Path(tempfile.mkdtemp(prefix="clz-inbox-"))
        try:
            inbox = tmp / "inbox"
            archive = tmp / "archive"
            inbox.mkdir()
            shutil.copy2(FIXTURE, inbox / "export.xml")
            store = FileHashStore(archive / ".hashes.json")
            first = run_sync(inbox=inbox, archive=archive, store=store, load=False)
            self.assertFalse(first["empty"])
            self.assertEqual(len(first["files"]), 1)
            self.assertFalse(first["files"][0]["skipped"])
            archived = list(archive.glob("*.xml"))
            self.assertEqual(len(archived), 1)
            self.assertTrue((inbox / "processed" / "export.xml").is_file())

            shutil.copy2(FIXTURE, inbox / "export.xml")
            second = run_sync(inbox=inbox, archive=archive, store=store, load=False)
            self.assertEqual(len(second["files"]), 1)
            self.assertTrue(second["files"][0]["skipped"])
            self.assertTrue(second["files"][0]["already_current"])
            self.assertEqual(len(list(archive.glob("*.xml"))), 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class InboxDropTests(unittest.TestCase):
    def test_sanitize_strips_path_and_requires_xml(self) -> None:
        self.assertEqual(sanitize_inbox_filename("../../secret.xml"), "secret.xml")
        self.assertEqual(sanitize_inbox_filename(r"C:\Users\greg\export.xml"), "export.xml")
        self.assertEqual(sanitize_inbox_filename("comic (1).xml"), "comic (1).xml")
        with self.assertRaises(ValueError):
            sanitize_inbox_filename("export.csv")
        with self.assertRaises(ValueError):
            sanitize_inbox_filename(".hidden.xml")

    def test_save_rejects_non_xml_and_empty(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="clz-drop-"))
        try:
            with self.assertRaises(ValueError):
                accept_inbox_drop("export.xml", b"", inbox=tmp)
            with self.assertRaises(ValueError):
                accept_inbox_drop("export.xml", b"not xml at all", inbox=tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_accept_writes_fixture_and_status_counts_pending(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing fixture {FIXTURE}")
        tmp = Path(tempfile.mkdtemp(prefix="clz-drop-"))
        try:
            inbox = tmp / "inbox"
            result = accept_inbox_drop(
                "C:\\\\Users\\\\greg\\\\export.xml",
                FIXTURE.read_bytes(),
                inbox=inbox,
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["savedAs"], "export.xml")
            self.assertTrue(Path(result["path"]).is_file())
            self.assertGreater(result["bytes"], 0)
            os.environ["CLZ_INBOX_DIR"] = str(inbox)
            os.environ["CLZ_ARCHIVE_DIR"] = str(tmp / "archive")
            try:
                status = inbox_status()
            finally:
                os.environ.pop("CLZ_INBOX_DIR", None)
                os.environ.pop("CLZ_ARCHIVE_DIR", None)
            self.assertEqual(status["pendingCount"], 1)
            self.assertEqual(status["pendingFiles"], ["export.xml"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
