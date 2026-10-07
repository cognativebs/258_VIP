"""ComicBase Collection Report import (ADR 0016): parsing, matching, the review list.

DB tests need IQVAULT_TEST_DSN and the CLZ holdings CI imports first; they run in one
transaction and roll back.
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

from comicbase_report import (  # noqa: E402
    ReportFormatError,
    VipHolding,
    match_items,
    parse_report,
    publisher_key,
    series_key,
)


def block(title: str, pub: str, issues: str, qty: int) -> str:
    return (
        f'<table class="reportGrid"><tr><td></td><td><h2>{title}</h2><h3>{pub}</h3>'
        f"<b>Issues: </b>{issues}<br /><strong>Total Qty: </strong>{qty}\n, <strong>Value: </strong>$1.00 </td></tr></table>"
    )


REPORT = "<html><body>" + "".join(
    [
        block("Action Comics (2nd Series)", "DC (2011&ndash;2017)", "5, 5/A", 2),
        block("Absolute Catwoman", "DC (2026)", "1/A(2), 1/B", 3),
        block("Fixture Spawn", "Image (1992&ndash;Present)", "200-2, Anl 1, 10.1(2)", 4),
        block('<span class="adult">Sex Criminals</span>', "Image (2013)", "1", 1),
    ]
) + "</body></html>"


def h(hid, title, pub, year, issue, label, printing=1, qty=1):
    return VipHolding(hid, title, pub, year, issue, label, printing, qty)


def test_parse_reads_issues_variants_printings_and_quantities():
    items = parse_report(REPORT)
    assert [(i.series_title, i.issue_prefix, i.issue_number, i.variant_letter, i.printing, i.quantity) for i in items] == [
        ("Action Comics (2nd Series)", None, "5", None, 1, 1),
        ("Action Comics (2nd Series)", None, "5", "A", 1, 1),
        ("Absolute Catwoman", None, "1", "A", 1, 2),
        ("Absolute Catwoman", None, "1", "B", 1, 1),
        ("Fixture Spawn", None, "200", None, 2, 1),
        ("Fixture Spawn", "Anl", "1", None, 1, 1),
        ("Fixture Spawn", None, "10.1", None, 1, 2),
        ("Sex Criminals", None, "1", None, 1, 1),
    ]
    first = items[0]
    assert (first.publisher, first.start_year, first.volume) == ("DC", 2011, 2)
    assert first.item_key == "action comics|2011|dc|5||p1"
    assert items[1].item_key != first.item_key


def test_parse_refuses_a_file_that_is_not_a_report_or_does_not_add_up():
    with pytest.raises(ReportFormatError, match="no ComicBase series"):
        parse_report("<html>CLZ export</html>")
    with pytest.raises(ReportFormatError, match="add up to 2, report says 3"):
        parse_report(block("X", "DC (2001)", "1, 2", 3))


def test_names_from_both_catalogues_meet():
    assert series_key("Action Comics, Vol. 2") == series_key("Action Comics (2nd Series)") == "action comics"
    assert series_key("G.I. Joe, Vol. 1 (Image)") == series_key("G.I. Joe (Image)") == "g i joe"
    assert series_key("Star Wars: Han Solo") == series_key("Han Solo")
    assert series_key("Star Wars") == "star wars"
    assert publisher_key("Marvel Comics") == publisher_key("Marvel") == "marvel"
    assert publisher_key("Unknown") == ""


def test_matching_pairs_only_what_is_unambiguous():
    items = parse_report(REPORT)
    holdings = [
        h("h-5a", "Action Comics, Vol. 2", "DC Comics", 2011, "5", "A"),
        h("h-5b", "Action Comics, Vol. 2", "DC Comics", 2011, "5", "B"),
        h("h-cat1", "Absolute Catwoman", "DC Comics", 2026, "1", "Cover A"),
        h("h-cat2", "Absolute Catwoman", "DC Comics", 2026, "1", "Cover B"),
        h("h-sp200", "Fixture Spawn", "Image Comics", 1992, "200", "2nd Printing"),
        h("h-sx1", "Sex Criminals", "Image Comics", 2013, "1", "A", qty=2),
        h("h-other", "Action Comics, Vol. 3", "DC Comics", 2023, "5", "A"),
    ]
    by = {(m.item.series_title, m.item.issue_prefix, m.item.issue_number, m.item.variant_letter): m for m in match_items(items, holdings)}
    # Regular + one variant on each side: regular → "A", variant → the other copy.
    assert by[("Action Comics (2nd Series)", None, "5", None)].holding_id == "h-5a"
    assert by[("Action Comics (2nd Series)", None, "5", "A")].holding_id == "h-5b"
    assert by[("Action Comics (2nd Series)", None, "5", "A")].status == "matched"
    # Two letters against two named covers: never guessed.
    assert by[("Absolute Catwoman", None, "1", "A")].status == "needs_review"
    assert set(by[("Absolute Catwoman", None, "1", "A")].candidates) == {"h-cat1", "h-cat2"}
    # A 2nd printing finds the copy whose label says so; an annual and an unknown issue are not guessed.
    assert by[("Fixture Spawn", None, "200", None)].holding_id == "h-sp200"
    assert by[("Fixture Spawn", "Anl", "1", None)].status == "needs_review"
    assert by[("Fixture Spawn", None, "10.1", None)].status == "unmatched"
    # One copy each side but the counts disagree → review, the holding offered.
    sx = by[("Sex Criminals", None, "1", None)]
    assert (sx.status, sx.holding_id) == ("needs_review", "h-sx1")
    assert "quantity differs (ComicBase 1, VIP 2)" in sx.reason
    matched = [m.holding_id for m in by.values() if m.status == "matched"]
    assert len(matched) == len(set(matched)) and "h-other" not in matched


DSN = os.environ.get("IQVAULT_TEST_DSN")


class _NoCommit:
    """Wraps a psycopg2 connection so the importer's commits stay inside the test transaction."""

    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def rollback(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.mark.skipif(not DSN, reason="IQVAULT_TEST_DSN not set — needs a migrated Postgres with the CLZ import")
def test_import_snapshots_matches_and_keeps_operator_decisions(tmp_path):
    psycopg2 = pytest.importorskip("psycopg2")
    import import_comicbase as ic

    conn = psycopg2.connect(DSN)
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT count(*) FROM vault_collection.holding h JOIN vault_comic.variant v ON v.asset_id = h.asset_id
                 JOIN vault_comic.issue i ON i.id = v.issue_id JOIN vault_comic.series s ON s.id = i.series_id
                WHERE s.title = 'Action Comics, Vol. 2' AND i.issue_number = '5' AND h.dropped_at IS NULL"""
        )
        if cur.fetchone()[0] < 2:
            pytest.skip("needs the CLZ import (Action Comics, Vol. 2 #5 regular + variant)")
        report = tmp_path / "Collection Report-test.htm"
        report.write_text(REPORT, encoding="utf-8")
        wrapped = _NoCommit(conn)

        first = ic.import_file(wrapped, str(report), dry_run=False, force=False)
        assert first["items"] == 8 and first["result"]["matched"] >= 2
        cur.execute("SELECT count(*) FROM vault_evidence.raw_snapshots WHERE source = 'comicbase_export' AND content_type = 'text/html'")
        assert cur.fetchone()[0] >= 1
        cur.execute(
            """SELECT ci.match_status, ci.needs_review, h.provider_ids->'comicbase'
                 FROM vault_collection.comicbase_item ci JOIN vault_collection.holding h ON h.id = ci.matched_holding_id
                WHERE ci.item_key = 'action comics|2011|dc|5||p1'"""
        )
        status, review, ids = cur.fetchone()
        assert (status, review) == ("matched", False) and "action comics|2011|dc|5||p1" in ids

        assert ic.import_file(wrapped, str(report), dry_run=False, force=False)["skipped"].startswith("already imported")

        # Operator confirms a reviewed item; a later import never moves it.
        cur.execute("SELECT candidate_holding_ids[1]::text FROM vault_collection.comicbase_item WHERE item_key = 'absolute catwoman|2026|dc|1|A|p1'")
        cand = cur.fetchone()[0]
        if cand:
            ic.confirm(wrapped, "absolute catwoman|2026|dc|1|A|p1", cand)
            ic.import_file(wrapped, str(report), dry_run=False, force=True)
            cur.execute(
                "SELECT match_status, match_method, matched_holding_id::text, needs_review FROM vault_collection.comicbase_item WHERE item_key = 'absolute catwoman|2026|dc|1|A|p1'"
            )
            assert cur.fetchone() == ("matched", "manual", cand, False)
        cur.execute("SELECT needs_review FROM vault_collection.comicbase_item WHERE item_key LIKE 'fixture spawn|%%Anl 1%%'")
        assert cur.fetchone() == (True,)
    finally:
        conn.rollback()
        conn.close()
