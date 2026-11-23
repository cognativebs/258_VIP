"""Comics API write path stamps an operator verification click (burn-down counter)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import comics_db  # noqa: E402


class _Cursor:
    def __init__(self, log: list) -> None:
        self.log = log
        self.rowcount = 1
        self.description = [("source_row_id",)]

    def execute(self, sql: str, params=None) -> None:
        self.log.append((sql, params))

    def fetchone(self):
        return ("h1",)

    def close(self) -> None:
        pass


class _Conn:
    def __init__(self) -> None:
        self.log: list = []

    def cursor(self) -> _Cursor:
        return _Cursor(self.log)

    def commit(self) -> None:
        pass


def _meta_patch(conn: _Conn) -> dict:
    params = conn.log[0][1]
    return json.loads(params[-2])


def test_needs_verification_click_is_stamped(monkeypatch) -> None:
    monkeypatch.setattr(comics_db, "row_from_holding", lambda rec: rec)
    conn = _Conn()
    comics_db.update_holding(conn, "h1", {"Needs Verification": "No"})
    meta = _meta_patch(conn)
    assert meta["Needs Verification"] == "No"
    assert comics_db.VERIFICATION_MARKED_AT_KEY in meta


def test_other_edits_do_not_stamp(monkeypatch) -> None:
    monkeypatch.setattr(comics_db, "row_from_holding", lambda rec: rec)
    conn = _Conn()
    comics_db.update_holding(conn, "h1", {"Location": "Bin A"})
    assert comics_db.VERIFICATION_MARKED_AT_KEY not in _meta_patch(conn)
