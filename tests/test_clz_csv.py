"""CLZ Cloud CSV/TXT export → the same rows the desktop XML export produces."""
from __future__ import annotations

import csv
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from clz_comic_parser import (  # noqa: E402
    CSV_COLUMN_ALIASES,
    ClzCsvError,
    csv_column_map,
    parse_clz_csv,
    parse_clz_file,
    parse_clz_xml,
)

XML = os.path.join(REPO_ROOT, "comic_2026-07-04_19-11-11-export.xml")


def write(path, header, rows, delimiter=","):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=delimiter)
        w.writerow(header)
        w.writerows(rows)
    return str(path)


def test_headers_match_by_name_whatever_the_case_or_punctuation():
    cols = csv_column_map(["Series", "Issue Nr", "Variant Description", "Raw / Slabbed", "Value", "Storage Box"])
    assert cols == {
        "Series": "Series",
        "Issue": "Issue Nr",
        "Edition / Variant": "Variant Description",
        "Slab Status": "Raw / Slabbed",
        "Current Price": "Value",
        "Location": "Storage Box",
    }


def test_rows_get_stable_ids_grades_and_prices(tmp_path):
    header = ["Series", "Issue", "Variant", "Publisher", "Quantity", "Value", "Grade", "Raw / Slabbed"]
    rows = [
        ["Batman", "1", "Cover A", "DC", "1", "$1,250.00", "", "Raw"],
        ["Batman", "1", "Cover A", "DC", "1", "1250", "", "Raw"],  # a second copy, same details
        ["Spawn", "1", "", "Image", "2", "40", "9.8", "Slabbed"],
        ["", "5", "", "", "1", "", "", ""],  # no series: skipped
    ]
    path = write(tmp_path / "export.csv", header, rows)
    out = parse_clz_csv(path)
    assert [r["Series"] for r in out] == ["Batman", "Batman", "Spawn"]
    ids = [r["CLZ Hash"] for r in out]
    assert len(set(ids)) == 3 and all(i.startswith("csv") for i in ids)
    assert ids == [r["CLZ Hash"] for r in parse_clz_csv(path)]  # same file, same ids
    batman, _, spawn = out
    assert (batman["Current Price"], batman["Assumed Grade"], batman["Slab Status"]) == (1250.0, "NM assumed", "Raw")
    assert (spawn["Grade Rating"], spawn["Assumed Grade"], spawn["Slab Status"], spawn["Quantity"]) == (9.8, "9.8", "Slabbed", 2)
    assert batman["Duplicate"] == "Yes"


def test_a_clz_hash_column_is_used_as_is(tmp_path):
    path = write(tmp_path / "export.txt", ["Series", "Issue", "Hash"], [["X-Men", "1", "abc123def456"]], delimiter="\t")
    assert parse_clz_csv(path)[0]["CLZ Hash"] == "abc123def456"


def test_refuses_a_file_without_series_and_issue(tmp_path):
    with pytest.raises(ClzCsvError, match="Series and Issue"):
        parse_clz_csv(write(tmp_path / "x.csv", ["Title", "Price"], [["Nope", "1"]]))


@pytest.mark.skipif(not os.path.exists(XML), reason="committed CLZ XML export not present")
def test_a_full_cloud_export_reads_exactly_like_the_xml(tmp_path):
    xml_rows = parse_clz_xml(XML)
    fields = [f for f in CSV_COLUMN_ALIASES if f != "CLZ Hash"]
    path = write(
        tmp_path / "cloud.csv",
        fields,
        [["" if f == "Grade Rating" and not r.get(f) else r.get(f, "") for f in fields] for r in xml_rows],
        delimiter=";",
    )
    csv_rows = parse_clz_file(path)
    assert len(csv_rows) == len(xml_rows) == 2700
    for key in ("Series", "Issue Full", "Edition / Variant", "Quantity", "Current Price", "Assumed Grade",
                "Duplicate", "Collection Pillar", "Recommendation", "Sell Priority", "Museum Score"):
        assert [r[key] for r in csv_rows] == [r[key] for r in xml_rows], key
    assert len({r["CLZ Hash"] for r in csv_rows}) == 2700
