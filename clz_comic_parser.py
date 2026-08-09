#!/usr/bin/env python3
"""
CLZ Comics XML Parser -> IQVault-ready CSV files.

Usage:
  python clz_comic_parser.py input.xml --outdir ComicArchive/processed

This parser preserves CLZ fields, then adds decision/intelligence fields:
Museum Score, Investment Score, Liquidity Score, Collection Pillar,
Upgrade Candidate, Duplicate, Sell Priority, Needs Grading, Needs Photo,
Needs Verification.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import statistics
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

PILLARS = [
    "Batman",
    "Absolute Universe",
    "Spider-Man",
    "X-Men",
    "Superman",
    "First Appearances",
    "Cover Art & Favorite Artists",
    "Sci-Fi",
    "Bronze & Silver Age Keys",
    "Investment Portfolio",
    "Good Girl / Risqué Covers",
    "Personal Favorites",
    "General Inventory",
]

FAVORITE_ARTISTS = [
    "Artgerm", "Stanley Lau", "Warren Louw", "Derrick Chew", "Nathan Szerdy",
    "Jee Hyung Lee", "JeeHyung Lee", "J. Scott Campbell", "Adam Hughes", "Alex Ross",
    "Skottie Young", "Francesco Mattina", "Mark Brooks", "Jim Lee", "Clayton Crain",
]

RISQUE_TERMS = [
    "Lady Death", "Power Hour", "Powerhour", "Vampirella", "Red Sonja", "Dejah Thoris",
    "Purgatori", "Hellwitch", "La Muerta", "Unnatural", "Notti", "Naughty", "Risqué",
    "Risque", "Good Girl", "Pin-Up", "Pinup", "Swimsuit", "Lingerie", "Cosplay",
    "Virgin", "Nude", "Seduction", "Temptation", "Bikini", "Grimm Fairy Tales",
]

SCI_FI_TERMS = [
    "Star Wars", "Star Trek", "Alien", "Aliens", "Predator", "Terminator", "Dune",
    "Cyber", "Robot", "Robots", "Space", "Cosmic", "Future", "Futuristic", "Sci-Fi",
    "Science Fiction", "AI", "Artificial Intelligence", "Transformers", "Battlestar", "Blade Runner",
]

BATMAN_TERMS = ["Batman", "Detective Comics", "Dark Knight", "Joker", "Harley Quinn", "Catwoman", "Nightwing", "Robin", "Batgirl"]
SUPERMAN_TERMS = ["Superman", "Action Comics", "Superboy", "Supergirl", "Lois Lane", "Krypton"]
SPIDER_TERMS = ["Spider-Man", "Amazing Spider-Man", "Spider-Gwen", "Miles Morales", "Venom", "Carnage", "Symbiote", "Web of Spider", "Spectacular Spider"]
XMEN_TERMS = ["X-Men", "X-Force", "X-Factor", "Wolverine", "Deadpool", "Cable", "Mutant", "New Mutants", "Uncanny", "X-23", "Weapon X"]
ABSOLUTE_TERMS = ["Absolute Batman", "Absolute Superman", "Absolute Wonder Woman", "Absolute Flash", "Absolute Green Lantern", "Absolute Martian Manhunter", "Absolute Universe", "DC All In", "All-In", "All In"]


def text(elem: Optional[ET.Element], path: str = "", default: str = "") -> str:
    if elem is None:
        return default
    target = elem.find(path) if path else elem
    if target is None or target.text is None:
        return default
    return target.text.strip()


def texts(elem: Optional[ET.Element], path: str) -> List[str]:
    if elem is None:
        return []
    return [e.text.strip() for e in elem.findall(path) if e is not None and e.text]


def parse_float(value: str | None) -> float:
    if value is None:
        return 0.0
    s = str(value).strip().replace("$", "").replace(",", "")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def contains_any(blob: str, terms: Iterable[str]) -> bool:
    low = blob.lower()
    return any(term.lower() in low for term in terms)


def date_text(comic: ET.Element, root_name: str) -> str:
    node = comic.find(root_name)
    return text(node, "displaydate") or text(node, "date")


def timestamp_to_date(ts: str) -> str:
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d")
    except Exception:
        return ""


def extract_row(comic: ET.Element) -> Dict[str, Any]:
    main = comic.find("mainsection")
    series = main.find("series") if main is not None else None
    edition = comic.find("edition")
    publisher = comic.find("publisher")
    location = comic.find("location")
    age = comic.find("age")
    format_node = comic.find("format")
    grade = comic.find("grade")
    seriesgroup = comic.find("seriesgroup")
    collection = comic.find("collection")

    key_categories = texts(comic, "keycategories/keycategory/displayname")
    genres = texts(comic, "genres/genre/displayname")
    signees = texts(comic, "signees/signee/displayname")

    issue = text(comic, "issuenr")
    issue_ext = text(comic, "issueext")
    issue_full = f"{issue}{issue_ext}" if issue_ext else issue

    grade_rating = parse_float(text(grade, "rating"))
    slab_status = text(comic, "isslabbed")
    assumed_grade = "NM assumed" if slab_status == "Raw" and grade_rating == 0 else (str(grade_rating) if grade_rating else "")

    row = {
        "CLZ Hash": text(comic, "hash"),
        "BP Comic ID": text(comic, "bpcomicid"),
        "BP Series ID": text(series, "bpseriesid"),
        "Series": text(series, "displayname"),
        "Series Group": text(seriesgroup, "displayname"),
        "Title": text(main, "title") if main is not None else "",
        "Issue": issue,
        "Issue Ext": issue_ext,
        "Issue Full": issue_full,
        "Edition / Variant": text(edition, "displayname"),
        "Publisher": text(publisher, "displayname"),
        "Cover Date": date_text(comic, "coverdate"),
        "Release Date": date_text(comic, "releasedate"),
        "Publication Date": date_text(comic, "publicationdate"),
        "Added Date": timestamp_to_date(text(comic, "addeddate/timestamp")),
        "Modified Date": timestamp_to_date(text(comic, "modifieddate/timestamp")),
        "Barcode": text(comic, "barcode"),
        "Format": text(format_node, "displayname"),
        "Quantity": int(parse_float(text(comic, "quantity") or "1") or 1),
        "Location": text(location, "displayname"),
        "Collection Status": text(comic, "collectionstatus"),
        "Collection": text(collection, "displayname"),
        "Crossover": text(comic, "crossover/displayname"),
        "Story Arc": text(comic, "storyarc/displayname"),
        "Age": text(age, "displayname"),
        "Current Price": parse_float(text(comic, "currentprice")),
        "Cover Price": parse_float(text(comic, "coverprice")),
        "Purchase Price": parse_float(text(comic, "purchaseprice")),
        "Purchase Date": text(comic, "purchasedate"),
        "Read It": text(comic, "readit"),
        "Tags": text(comic, "tags"),
        "Is Key Comic": text(comic, "iskeycomic"),
        "Key Comic Reason": text(comic, "keycomicreason"),
        "Key Categories": "; ".join(key_categories),
        "Grade Rating": grade_rating,
        "Assumed Grade": assumed_grade,
        "Slab Status": slab_status,
        "Country": text(comic, "country/displayname"),
        "Language": text(comic, "language/displayname"),
        "Signees": "; ".join(signees),
        "Genres": "; ".join(genres),
        "Cover Image URL": text(comic, "coverfrontdefault"),
        "Value Locked": text(comic, "valueislocked"),
        "Raw XML Index": text(comic, "index"),
    }
    return row


def choose_pillar(row: Dict[str, Any]) -> str:
    blob = " | ".join(str(row.get(k, "")) for k in [
        "Series", "Series Group", "Title", "Edition / Variant", "Publisher", "Crossover", "Story Arc", "Key Comic Reason", "Genres"
    ])
    age = row.get("Age", "")
    is_key = row.get("Is Key Comic") in {"Major", "Minor", "Yes"} or bool(row.get("Key Categories"))

    if contains_any(blob, ABSOLUTE_TERMS):
        return "Absolute Universe"
    if contains_any(blob, BATMAN_TERMS):
        return "Batman"
    if contains_any(blob, SPIDER_TERMS):
        return "Spider-Man"
    if contains_any(blob, XMEN_TERMS):
        return "X-Men"
    if contains_any(blob, SUPERMAN_TERMS):
        return "Superman"
    if contains_any(blob, RISQUE_TERMS):
        return "Good Girl / Risqué Covers"
    if contains_any(blob, SCI_FI_TERMS):
        return "Sci-Fi"
    if is_key and "1st" in str(row.get("Key Categories", "") + row.get("Key Comic Reason", "")):
        return "First Appearances"
    if age in {"Silver", "Bronze", "Golden"}:
        return "Bronze & Silver Age Keys"
    if contains_any(blob, FAVORITE_ARTISTS):
        return "Cover Art & Favorite Artists"
    if is_key or row.get("Current Price", 0) >= 50:
        return "Investment Portfolio"
    return "General Inventory"


def add_intelligence(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    signature_counts = Counter()
    barcode_counts = Counter()
    for r in rows:
        sig = (r["Series"], r["Issue"], r["Issue Ext"], r["Edition / Variant"], r["Barcode"])
        signature_counts[sig] += 1
        if r["Barcode"]:
            barcode_counts[r["Barcode"]] += 1

    for r in rows:
        blob = " | ".join(str(r.get(k, "")) for k in r.keys())
        is_key = r["Is Key Comic"] in {"Major", "Minor", "Yes"} or bool(r["Key Categories"])
        key_reason = r.get("Key Comic Reason", "")
        key_categories = r.get("Key Categories", "")
        current = float(r.get("Current Price", 0) or 0)
        age = r.get("Age", "")
        publisher = r.get("Publisher", "")
        qty = int(r.get("Quantity", 1) or 1)
        sig = (r["Series"], r["Issue"], r["Issue Ext"], r["Edition / Variant"], r["Barcode"])
        duplicate = qty > 1 or signature_counts[sig] > 1 or (r["Barcode"] and barcode_counts[r["Barcode"]] > 1)

        pillar = choose_pillar(r)
        fav_artist = contains_any(blob, FAVORITE_ARTISTS)
        risque = contains_any(blob, RISQUE_TERMS)
        first_app = "1st" in (key_reason + " " + key_categories).lower() or "first" in key_categories.lower()
        major_key = str(r.get("Is Key Comic", "")).lower() == "major"
        high_value_location = "high value" in str(r.get("Location", "")).lower()
        raw = r.get("Slab Status") == "Raw"

        museum = 0
        museum += 25 if pillar != "General Inventory" else 0
        museum += 20 if is_key else 0
        museum += 15 if first_app else 0
        museum += 15 if current >= 50 else 8 if current >= 20 else 0
        museum += 15 if age in {"Golden", "Silver", "Bronze"} else 0
        museum += 10 if fav_artist else 0
        museum += 10 if risque else 0
        museum += 10 if high_value_location else 0
        museum -= 15 if duplicate else 0
        museum = max(0, min(100, museum))

        investment = 0
        investment += 25 if is_key else 0
        investment += 20 if first_app else 0
        investment += 20 if current >= 50 else 12 if current >= 20 else 0
        investment += 15 if age in {"Golden", "Silver", "Bronze"} else 0
        investment += 10 if "Variant" in r.get("Edition / Variant", "") or "Incentive" in r.get("Edition / Variant", "") else 0
        investment += 10 if publisher in {"Marvel Comics", "DC Comics", "Image Comics"} else 0
        investment -= 10 if current == 0 and not is_key else 0
        investment = max(0, min(100, investment))

        liquidity = 0
        liquidity += 20 if publisher in {"Marvel Comics", "DC Comics"} else 8 if publisher == "Image Comics" else 0
        liquidity += 25 if pillar in {"Batman", "Spider-Man", "X-Men", "Superman"} else 10 if pillar != "General Inventory" else 0
        liquidity += 20 if is_key else 0
        liquidity += 15 if current >= 25 else 5 if current > 0 else 0
        liquidity += 10 if raw else 5
        liquidity = max(0, min(100, liquidity))

        if museum >= 75:
            recommendation = "Museum Candidate"
        elif investment >= 65:
            recommendation = "Investment Hold / Review"
        elif duplicate and current >= 15:
            recommendation = "Sell Duplicate"
        elif pillar == "General Inventory" and not is_key:
            recommendation = "Sell / Lot Candidate"
        elif current == 0 and not is_key:
            recommendation = "Verify then Lot"
        else:
            recommendation = "Inventory Review"

        if recommendation in {"Sell Duplicate", "Sell / Lot Candidate", "Verify then Lot"}:
            sell_priority = "High" if (duplicate or current == 0 or pillar == "General Inventory") else "Medium"
        elif museum < 40 and investment < 40:
            sell_priority = "Medium"
        else:
            sell_priority = "Low"

        needs_grading = raw and (current >= 75 or major_key or (first_app and current >= 40) or (age in {"Golden", "Silver", "Bronze"} and current >= 50))
        needs_photo = not bool(r.get("Cover Image URL"))
        needs_verification = any([
            not r.get("Barcode"),
            not r.get("Series"),
            not r.get("Issue"),
            current == 0 and is_key,
            duplicate,
            r.get("Assumed Grade") == "NM assumed",
        ])
        upgrade_candidate = museum >= 60 and raw and (current >= 30 or is_key)

        r.update({
            "Collection Pillar": pillar,
            "Duplicate": "Yes" if duplicate else "No",
            "Duplicate Count": max(signature_counts[sig], barcode_counts[r["Barcode"]] if r["Barcode"] else 0, qty),
            "Museum Score": museum,
            "Investment Score": investment,
            "Liquidity Score": liquidity,
            "Sell Priority": sell_priority,
            "Recommendation": recommendation,
            "Upgrade Candidate": "Yes" if upgrade_candidate else "No",
            "Needs Grading": "Yes" if needs_grading else "No",
            "Needs Photo": "Yes" if needs_photo else "No",
            "Needs Verification": "Yes" if needs_verification else "No",
            "Verification Notes": "; ".join(filter(None, [
                "Assumed NM, not verified" if r.get("Assumed Grade") == "NM assumed" else "",
                "Duplicate/quantity check" if duplicate else "",
                "Missing barcode" if not r.get("Barcode") else "",
                "Key with zero current price" if current == 0 and is_key else "",
            ])),
        })
    return rows


def parse_clz_xml(path: str) -> List[Dict[str, Any]]:
    tree = ET.parse(path)
    root = tree.getroot()
    comics = root.findall(".//comiclist/comic")
    rows = [extract_row(c) for c in comics]
    return add_intelligence(rows)


def write_csv(path: str, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    # Fixed "\n" rather than the csv default "\r\n": derived files must be
    # byte-identical when regenerated from the same snapshot on any platform.
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


def summarize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    total_value = sum(float(r.get("Current Price", 0) or 0) * int(r.get("Quantity", 1) or 1) for r in rows)
    total_qty = sum(int(r.get("Quantity", 1) or 1) for r in rows)
    summary = [
        {"Metric": "Unique Records", "Value": len(rows)},
        {"Metric": "Total Quantity", "Value": total_qty},
        {"Metric": "CLZ Current Value", "Value": round(total_value, 2)},
        {"Metric": "Museum Candidates", "Value": sum(1 for r in rows if r["Recommendation"] == "Museum Candidate")},
        {"Metric": "High Sell Priority", "Value": sum(1 for r in rows if r["Sell Priority"] == "High")},
        {"Metric": "Duplicate Records", "Value": sum(1 for r in rows if r["Duplicate"] == "Yes")},
        {"Metric": "Needs Grading", "Value": sum(1 for r in rows if r["Needs Grading"] == "Yes")},
        {"Metric": "Needs Verification", "Value": sum(1 for r in rows if r["Needs Verification"] == "Yes")},
    ]
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("xml_path")
    parser.add_argument("--outdir", default=".")
    args = parser.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    rows = parse_clz_xml(args.xml_path)

    preferred_order = [
        "Collection Pillar", "Recommendation", "Sell Priority", "Museum Score", "Investment Score", "Liquidity Score",
        "Duplicate", "Duplicate Count", "Upgrade Candidate", "Needs Grading", "Needs Photo", "Needs Verification", "Verification Notes",
        "Series", "Issue Full", "Issue", "Issue Ext", "Title", "Edition / Variant", "Publisher", "Series Group",
        "Age", "Release Date", "Cover Date", "Publication Date", "Barcode", "Quantity", "Location", "Current Price", "Cover Price",
        "Purchase Price", "Purchase Date", "Is Key Comic", "Key Comic Reason", "Key Categories", "Story Arc", "Crossover", "Genres",
        "Slab Status", "Grade Rating", "Assumed Grade", "Signees", "Tags", "Cover Image URL", "CLZ Hash", "BP Comic ID", "BP Series ID", "Added Date", "Modified Date"
    ]
    all_fields = preferred_order + [k for k in rows[0].keys() if k not in preferred_order] if rows else preferred_order
    write_csv(os.path.join(args.outdir, "iqvault_comics_enriched.csv"), rows, all_fields)
    write_csv(os.path.join(args.outdir, "iqvault_comics_sell_queue.csv"), [r for r in rows if r["Sell Priority"] in {"High", "Medium"}], all_fields)
    write_csv(os.path.join(args.outdir, "iqvault_comics_museum_candidates.csv"), [r for r in rows if r["Museum Score"] >= 70], all_fields)
    write_csv(os.path.join(args.outdir, "iqvault_comics_summary.csv"), summarize(rows), ["Metric", "Value"])

    print(f"Parsed {len(rows)} comic records")
    print(f"Output directory: {args.outdir}")

if __name__ == "__main__":
    main()
