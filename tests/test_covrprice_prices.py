"""CovrPrice values from the CLZ Cloud CSV export (scripts/comics_guide_prices.py covrprice).

Pure tests cover the ';'-split rejoin and the copy matching. The DB test needs IQVAULT_TEST_DSN with the CLZ
import; it runs in one transaction and rolls back.
"""
from __future__ import annotations

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from comics_guide_prices import match_covrprice, read_covrprice_csv  # noqa: E402

HEADER = "Issue;Issue No.;Full Title;Series;Variant;Variant Description;Storage Box;CovrPrice Value;My Value;Grade;Grading Company;Cover Price\n"


def _write(tmp_path, body: str):
    path = tmp_path / "export_comics.csv"
    path.write_text("﻿" + HEADER + body, encoding="utf-8")
    return str(path)


def test_a_title_split_by_an_unquoted_semicolon_is_rejoined(tmp_path):
    rows, broken = read_covrprice_csv(
        _write(
            tmp_path,
            "0A;0;Shazam!; Questions;Justice League, Vol. 1;A;Gary Frank Regular Cover;DC - Flash;3.00;;;;3.99\n"
            "1A;1;Plain;Some Series;A;Regular;BOX;5.00;;;;2.99\n"
            "1A;1;Too;Many;Splits;Here;A;Regular;BOX;5.00;;;;2.99\n",
        )
    )
    assert [r["Series"] for r in rows] == ["Justice League, Vol. 1", "Some Series"]
    assert rows[0]["Full Title"] == "Shazam!; Questions" and rows[0]["_rejoined"] is True
    assert rows[0]["CovrPrice Value"] == "3.00"
    assert rows[1]["_rejoined"] is False
    assert len(broken) == 1 and broken[0][0] == 4  # two extra columns: listed, never guessed


def test_missing_series_column_is_refused(tmp_path):
    path = tmp_path / "old.csv"
    path.write_text("Issue;Issue No.;Full Title;Variant Description;Storage Box;CovrPrice Value\n1A;1;X;R;B;5.00\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="Series"):
        read_covrprice_csv(str(path))


def _row(series, issue, variant, box, value, grade=""):
    return {"Series": series, "Issue": issue, "Variant Description": variant, "Storage Box": box,
            "CovrPrice Value": value, "Grade": grade, "Grading Company": "", "_line": 2, "_rejoined": False}


def _holding(n, series, issue, variant, box):
    return (f"h{n}", f"a{n}", f"row{n}", series, issue, variant, box)


def test_identical_copies_each_get_the_value_and_mismatches_are_listed():
    ww = ("Wonder Woman, Vol. 4", "49B", "Neal Adams Variant")
    rows = [
        _row(*ww, "AUTOGRAPHS", "24.00"),
        _row(*ww, "BOX - Direct Issues", "24.00"),
        _row("Dup", "1A", "Regular", "BOX", "6.00"),
        _row("Dup", "1A", "Regular", "BOX", "6.00"),
        _row("Short", "2A", "Regular", "BOX", "4.00"),
        _row("Short", "2A", "Regular", "BOX", "4.00"),
        _row("Split", "3A", "Regular", "BOX", "4.00"),
        _row("Split", "3A", "Regular", "BOX", "9.00"),
        _row("Slab", "4A", "Regular", "BOX", "90.00", grade="9.8"),
        _row("Zero", "5A", "Regular", "BOX", "0.00"),
        _row("Nowhere", "6A", "Regular", "BOX", "3.00"),
    ]
    holdings = [
        _holding(1, *ww, "AUTOGRAPHS"),
        _holding(2, *ww, "box - direct  issues"),  # case and spacing do not matter
        _holding(3, "Dup", "1A", "Regular", "BOX"),
        _holding(4, "Dup", "1A", "Regular", "BOX"),
        _holding(5, "Short", "2A", "Regular", "BOX"),
        _holding(6, "Split", "3A", "Regular", "BOX"),
        _holding(7, "Split", "3A", "Regular", "BOX"),
        _holding(8, "Slab", "4A", "Regular", "BOX"),
        _holding(9, "Zero", "5A", "Regular", "BOX"),
    ]
    pairs, not_priced = match_covrprice(rows, holdings)
    assert sorted((h[0], r["CovrPrice Value"]) for r, h in pairs) == [
        ("h1", "24.00"), ("h2", "24.00"), ("h3", "6.00"), ("h4", "6.00"),
    ]
    reasons = {row[0].split(" #")[0]: row[3] for row in not_priced}
    assert reasons["Short"] == "2 export row(s) vs 1 VIP copies"
    assert reasons["Split"] == "identical copies carry different CovrPrice values"
    assert reasons["Slab"].startswith("graded copy")
    assert reasons["Zero"] == "no CovrPrice value in the export"
    assert reasons["Nowhere"].startswith("no VIP copy")


DSN = os.environ.get("IQVAULT_TEST_DSN")


class _NoCommit:
    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.mark.skipif(not DSN, reason="IQVAULT_TEST_DSN not set — needs a migrated Postgres with the CLZ import")
def test_covrprice_rows_are_dated_vendor_guide_rows_written_once(tmp_path):
    psycopg2 = pytest.importorskip("psycopg2")
    import comics_guide_prices as g

    conn = psycopg2.connect(DSN)
    try:
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM vault_market.data_source WHERE source_key = 'covrprice'")
        if cur.fetchone()[0] < 1:
            pytest.skip("needs migration 20261101_01")
        cur.execute(
            """SELECT clz_metadata->>'Series', clz_metadata->>'Issue Full', clz_metadata->>'Edition / Variant',
                      clz_metadata->>'Location'
                 FROM vault_collection.holding h
                WHERE h.source = 'clz_import' AND h.dropped_at IS NULL AND h.source_row_id IS NOT NULL
                  AND (SELECT count(*) FROM vault_collection.holding o
                        WHERE o.source = 'clz_import' AND o.dropped_at IS NULL
                          AND o.clz_metadata->>'Series' = h.clz_metadata->>'Series'
                          AND o.clz_metadata->>'Issue Full' = h.clz_metadata->>'Issue Full'
                          AND coalesce(o.clz_metadata->>'Edition / Variant', '') = coalesce(h.clz_metadata->>'Edition / Variant', '')
                          AND coalesce(o.clz_metadata->>'Location', '') = coalesce(h.clz_metadata->>'Location', '')) = 1
                LIMIT 1"""
        )
        found = cur.fetchone()
        if not found:
            pytest.skip("needs the CLZ import")
        series, issue, variant, box = (v or "" for v in found)
        export = _write(tmp_path, f"{issue};1;T;{series};A;{variant};{box};24.00;;;;3.99\n1A;1;T;No Such Series;A;R;B;3.00;;;;1\n")
        wrapped = _NoCommit(conn)
        # A same-day load would make the first write a no-op (ON CONFLICT DO NOTHING); clear CovrPrice rows
        # in this transaction only. finally rolls the connection back, so committed rows stay.
        cur.execute("DELETE FROM vault_market.guide_price_observation WHERE source = 'covrprice'")
        first = g.run_covrprice(wrapped, export, dry_run=False, out_dir=str(tmp_path))
        assert (first["rows"], first["copies_priced"], first["rows_written"], first["not_priced"]) == (2, 1, 1, 1)
        cur.execute(
            """SELECT condition_key, guide_price::float, evidence_class, prov_verification::text, baseline_eligible
                 FROM vault_market.guide_price_observation WHERE source = 'covrprice' AND ingest_batch = %s""",
            (f"covrprice:{first['raw_snapshot']}",),
        )
        assert cur.fetchall() == [("raw_nm", 24.0, "vendor_derived", "unverified", False)]
        assert g.run_covrprice(wrapped, export, dry_run=False, out_dir=str(tmp_path))["rows_written"] == 0
    finally:
        conn.rollback()
        conn.close()
