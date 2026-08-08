"""Guards on the CLZ ingest path — the code that reads the real collection.

The fixture is the actual 2026-07-04 CLZ export committed at the repo root, so
these tests fail if the parser starts dropping records or inventing grades.
"""
from __future__ import annotations

import os

import pytest

from clz_comic_parser import extract_row, parse_clz_xml, summarize

EXPORT_XML = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "comic_2026-07-04_19-11-11-export.xml",
)

EXPECTED_RECORDS = 2700


@pytest.fixture(scope="module")
def rows():
    return parse_clz_xml(EXPORT_XML)


def test_parses_every_record_in_the_export(rows):
    assert len(rows) == EXPECTED_RECORDS


def test_no_record_loses_its_clz_identity(rows):
    """Without CLZ Hash the Postgres loader cannot match on re-import."""
    missing = [r for r in rows if not r["CLZ Hash"]]
    assert missing == []


def test_ungraded_raw_books_are_labeled_assumed_not_graded(rows):
    raw_ungraded = [r for r in rows if r["Slab Status"] == "Raw" and r["Grade Rating"] == 0]
    assert raw_ungraded, "fixture should contain raw ungraded books"
    for row in raw_ungraded:
        assert row["Assumed Grade"] == "NM assumed"
        assert row["Needs Verification"] == "Yes"


def test_assumed_grade_never_masquerades_as_a_real_grade(rows):
    """An inferred grade must stay non-numeric so it cannot be read as verified."""
    for row in rows:
        if row["Grade Rating"] == 0 and row["Assumed Grade"]:
            assert row["Assumed Grade"] == "NM assumed"


def test_every_row_carries_a_decision(rows):
    actionable = {
        "Museum Candidate",
        "Investment Hold / Review",
        "Sell Duplicate",
        "Sell / Lot Candidate",
        "Verify then Lot",
        "Inventory Review",
    }
    for row in rows:
        assert row["Recommendation"] in actionable
        assert row["Sell Priority"] in {"High", "Medium", "Low"}


def test_scores_stay_in_range(rows):
    for row in rows:
        for field in ("Museum Score", "Investment Score", "Liquidity Score"):
            assert 0 <= row[field] <= 100


def test_summary_value_matches_price_times_quantity(rows):
    summary = {item["Metric"]: item["Value"] for item in summarize(rows)}
    expected = round(
        sum(float(r["Current Price"] or 0) * int(r["Quantity"] or 1) for r in rows), 2
    )
    assert summary["Unique Records"] == len(rows)
    assert summary["CLZ Current Value"] == expected


def test_grade_rating_is_preserved_for_slabbed_books(rows):
    slabbed_graded = [r for r in rows if r["Grade Rating"] > 0]
    for row in slabbed_graded:
        assert row["Assumed Grade"] == str(row["Grade Rating"])


def test_extract_row_handles_a_sparse_comic_element():
    import xml.etree.ElementTree as ET

    row = extract_row(ET.fromstring("<comic><issuenr>1</issuenr></comic>"))

    assert row["Issue"] == "1"
    assert row["Series"] == ""
    assert row["Quantity"] == 1
    assert row["Current Price"] == 0.0
