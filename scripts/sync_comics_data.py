#!/usr/bin/env python3
"""Convert CLZ parser CSV output to IQVault web data (JSON)."""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(
    ROOT,
    "iqvault_comics_parser_package",
    "ComicArchive_processed",
    "iqvault_comics_enriched.csv",
)
OUT_DIR = os.path.join(ROOT, "iqvault", "public", "comics")

NUMERIC = {
    "Museum Score",
    "Investment Score",
    "Liquidity Score",
    "Current Price",
    "Cover Price",
    "Purchase Price",
    "Grade Rating",
    "Quantity",
    "Duplicate Count",
}


def normalize(row: dict) -> dict:
    out = {}
    for key, val in row.items():
        if key in NUMERIC:
            try:
                out[key] = float(val) if val not in ("", None) else 0
            except ValueError:
                out[key] = 0
        elif key == "Quantity":
            try:
                out[key] = int(float(val or 1))
            except ValueError:
                out[key] = 1
        else:
            out[key] = val or ""
    out["id"] = f"{out.get('BP Comic ID', '')}-{out.get('CLZ Hash', '')[:8]}"
    return out


def build_meta(rows: list[dict], snapshot: dict[str, str] | None = None) -> dict:
    total_value = sum(r.get("Current Price", 0) * r.get("Quantity", 1) for r in rows)
    pillars = Counter(r.get("Collection Pillar", "Unknown") for r in rows)
    pillar_value = defaultdict(float)
    for r in rows:
        pillar_value[r.get("Collection Pillar", "Unknown")] += r.get("Current Price", 0) * r.get(
            "Quantity", 1
        )

    locations = Counter(r.get("Location", "") or "Unassigned" for r in rows)
    recs = Counter(r.get("Recommendation", "") for r in rows)

    snapshot = snapshot or {}

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        # Never hardcode a date here: a stale label is how a July export ends up
        # reading as today's collection.
        "snapshotLabel": snapshot.get("label", "CLZ export · snapshot unidentified"),
        "snapshotId": snapshot.get("id"),
        "snapshotHash": snapshot.get("hash"),
        "recordCount": len(rows),
        "totalQuantity": sum(r.get("Quantity", 1) for r in rows),
        "totalValue": round(total_value, 2),
        "museumCandidates": sum(1 for r in rows if r.get("Recommendation") == "Museum Candidate"),
        "highSellPriority": sum(1 for r in rows if r.get("Sell Priority") == "High"),
        "duplicates": sum(1 for r in rows if r.get("Duplicate") == "Yes"),
        "needsGrading": sum(1 for r in rows if r.get("Needs Grading") == "Yes"),
        "needsVerification": sum(1 for r in rows if r.get("Needs Verification") == "Yes"),
        "pillars": [
            {
                "name": name,
                "count": count,
                "value": round(pillar_value[name], 2),
            }
            for name, count in pillars.most_common()
        ],
        "recommendations": dict(recs.most_common()),
        "topLocations": [
            {"name": k, "count": v} for k, v in locations.most_common(12)
        ],
        "avgMuseumScore": round(
            sum(r.get("Museum Score", 0) for r in rows) / max(len(rows), 1), 1
        ),
        "avgInvestmentScore": round(
            sum(r.get("Investment Score", 0) for r in rows) / max(len(rows), 1), 1
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot-label", default=None, help="e.g. 'CLZ export 2026-07-04'")
    ap.add_argument("--snapshot-id", default=None, help="vault_evidence.raw_snapshots id")
    ap.add_argument("--snapshot-hash", default=None, help="sha256 of the source export")
    args = ap.parse_args()

    if not os.path.isfile(CSV_PATH):
        raise SystemExit(f"Missing CSV: {CSV_PATH}\nRun clz_comic_parser.py first.")

    os.makedirs(OUT_DIR, exist_ok=True)

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = [normalize(r) for r in csv.DictReader(f)]

    snapshot = {
        k: v
        for k, v in (
            ("label", args.snapshot_label),
            ("id", args.snapshot_id),
            ("hash", args.snapshot_hash),
        )
        if v
    }
    meta = build_meta(rows, snapshot)

    with open(os.path.join(OUT_DIR, "inventory.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)

    with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"Synced {len(rows)} comics -> {OUT_DIR}")
    print(f"Total value: ${meta['totalValue']:,.2f}")


if __name__ == "__main__":
    main()
