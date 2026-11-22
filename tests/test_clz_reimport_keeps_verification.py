"""A CLZ re-import must not undo a person's verification click (AGENTS.md:
needs_review is never auto-cleared; confirmed facts are never silently
overwritten). Runs inside one transaction that is always rolled back."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

DSN = os.environ.get("IQVAULT_TEST_DSN")


class _NoCommit:
    """Pass-through connection whose commit() is a no-op, so the test can roll back."""

    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _row(needs_verification: str, notes: str) -> dict:
    return {
        "CLZ Hash": "zz-test-reimport-verification-0001",
        "Series": "Reimport Verification Test",
        "Publisher": "Test Publisher",
        "Issue": "1",
        "Quantity": 1,
        "Assumed Grade": "NM",
        "Needs Verification": needs_verification,
        "Verification Notes": notes,
    }


@pytest.mark.skipif(not DSN, reason="IQVAULT_TEST_DSN not set — needs a migrated Postgres")
def test_reimport_keeps_operator_verification(capsys):
    psycopg2 = pytest.importorskip("psycopg2")
    from load_comics import load_inventory
    from comics_db import update_holding

    raw = psycopg2.connect(DSN)
    raw.autocommit = False
    conn = _NoCommit(raw)
    row_id = _row("Yes", "")["CLZ Hash"]
    try:
        load_inventory(conn, [_row("Yes", "NM assumed · unverified")])
        update_holding(conn, row_id, {"Needs Verification": "No"})

        # The export still says Yes; a re-import must keep the person's No.
        load_inventory(conn, [_row("Yes", "NM assumed · unverified")])
        cur = raw.cursor()
        cur.execute(
            """SELECT needs_verification, clz_metadata->>'Verification Marked At',
                      clz_metadata->>'Needs Verification'
               FROM vault_collection.holding
               WHERE source = 'clz_import' AND source_row_id = %s""",
            (row_id,),
        )
        needs, marked_at, meta_needs = cur.fetchone()
        assert needs is False
        assert marked_at
        assert meta_needs == "No"
    finally:
        raw.rollback()
        raw.close()


@pytest.mark.skipif(not DSN, reason="IQVAULT_TEST_DSN not set — needs a migrated Postgres")
def test_reimport_still_updates_unmarked_rows(capsys):
    psycopg2 = pytest.importorskip("psycopg2")
    from load_comics import load_inventory

    raw = psycopg2.connect(DSN)
    raw.autocommit = False
    conn = _NoCommit(raw)
    row_id = _row("Yes", "")["CLZ Hash"]
    try:
        load_inventory(conn, [_row("Yes", "first")])
        load_inventory(conn, [_row("No", "second")])
        cur = raw.cursor()
        cur.execute(
            """SELECT needs_verification, verification_notes
               FROM vault_collection.holding
               WHERE source = 'clz_import' AND source_row_id = %s""",
            (row_id,),
        )
        assert cur.fetchone() == (False, "second")
    finally:
        raw.rollback()
        raw.close()
