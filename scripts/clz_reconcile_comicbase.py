#!/usr/bin/env python3
"""ComicBase report vs CLZ: what to add to CLZ, what to check for removal, which counts to fix.

The operator is moving back to CLZ as the comics inventory and re-entering the books added in ComicBase
(2026-10-19). CLZ is pruned, not wiped, so books already in CLZ keep their CLZ id and their history in
VIP. This script reads a ComicBase Collection Report and the CLZ holdings in VIP (read only) and writes
three CSVs for the operator to act on in CLZ:

  add_to_clz.csv          ComicBase items with no CLZ copy, or whose CLZ copy is unclear. Columns fit
                          CLZ's "Import from Text / CSV File". Unclear rows say which CLZ copies might
                          already be the same book, so they are not imported twice.
  check_for_removal.csv   CLZ copies ComicBase does not list. Candidates only: the operator decides,
                          in CLZ, whether each one is gone. Nothing is deleted anywhere by this script.
  quantity_changes.csv    Books on both sides with different counts (ComicBase's is the newer count).

Usage:
  python scripts/clz_reconcile_comicbase.py --report "D:/VIP/imports/comicbase/<report>.htm" [--out DIR]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from comicbase_report import RULE_VERSION, VipHolding, match_items, parse_report  # noqa: E402

DEFAULT_DSN = os.environ.get("IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost")
DEFAULT_OUT = os.environ.get("VIP_EXPORTS_DIR", r"D:\VIP\exports")

CLZ_SQL = """
SELECT h.id::text, s.title, s.publisher, s.year_began, i.issue_number, v.cover_label, v.printing, h.quantity,
       h.source_row_id, h.location, h.clz_metadata->>'Barcode', h.clz_metadata->>'Issue Full'
  FROM vault_collection.holding h
  JOIN vault_comic.variant v ON v.asset_id = h.asset_id
  JOIN vault_comic.issue i   ON i.id = v.issue_id
  JOIN vault_comic.series s  ON s.id = i.series_id
 WHERE h.dropped_at IS NULL AND h.source = 'clz_import'
 ORDER BY s.title, i.issue_number, v.cover_label
"""


def reconcile(items, clz_rows):
    """Pure: ComicBase items + CLZ rows (CLZ_SQL shape) → (add, check_for_removal, quantity_changes, summary)."""
    holdings = [VipHolding(*r[:8]) for r in clz_rows]
    by_id = {r[0]: r for r in clz_rows}
    matches = match_items(items, holdings)

    def label(hid):
        r = by_id[hid]
        return f"{r[1]} #{r[11] or r[4]} ({r[5]}) [CLZ {r[8]}]"

    add, qty = [], []
    linked, maybe = set(), set()
    for m in matches:
        it = m.item
        issue = f"{it.issue_prefix} {it.issue_number}" if it.issue_prefix else it.issue_number
        if m.status == "matched":
            linked.add(m.holding_id)
            clz_qty = by_id[m.holding_id][7]
            if clz_qty != it.quantity:
                qty.append([label(m.holding_id), clz_qty, it.quantity, by_id[m.holding_id][8]])
            continue
        maybe.update(m.candidates)
        notes = []
        if it.variant_letter:
            notes.append(f"ComicBase variant /{it.variant_letter}: pick the CLZ cover")
        if it.printing > 1:
            notes.append(f"printing {it.printing}")
        if m.candidates:
            notes.append("CHECK FIRST, may already be in CLZ as: " + " | ".join(label(c) for c in m.candidates))
        add.append([it.series_title, issue, it.publisher, it.year_label, it.printing, it.quantity,
                    "check" if m.candidates else "add", "; ".join(notes)])

    removal = []
    for r in clz_rows:
        if r[0] in linked:
            continue
        removal.append([r[1], r[11] or r[4], r[5], r[2], r[7], r[9] or "", r[10] or "", r[8],
                        "possible match to a ComicBase item still to check" if r[0] in maybe else "not in ComicBase"])

    summary = {
        "rule": RULE_VERSION,
        "comicbase_items": len(items),
        "comicbase_copies": sum(i.quantity for i in items),
        "clz_holdings": len(clz_rows),
        "already_in_clz": len(linked),
        "add_rows": sum(1 for a in add if a[6] == "add"),
        "check_rows": sum(1 for a in add if a[6] == "check"),
        "check_for_removal": len(removal),
        "quantity_changes": len(qty),
    }
    return add, removal, qty, summary


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", required=True, help="ComicBase Collection Report (.htm)")
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    with open(args.report, encoding="utf-8-sig") as fh:
        items = parse_report(fh.read())
    import psycopg2

    conn = psycopg2.connect(args.dsn)
    try:
        cur = conn.cursor()
        cur.execute(CLZ_SQL)
        clz_rows = cur.fetchall()
    finally:
        conn.close()

    add, removal, qty, summary = reconcile(items, clz_rows)
    stem = re.sub(r"[^A-Za-z0-9]+", "-", os.path.splitext(os.path.basename(args.report))[0]).strip("-")
    out = os.path.join(args.out, f"clz-reconcile-{stem}")
    os.makedirs(out, exist_ok=True)
    write_csv(os.path.join(out, "add_to_clz.csv"),
              ["Series", "Issue", "Publisher", "Series Years", "Printing", "Quantity", "Action", "Notes"], add)
    write_csv(os.path.join(out, "check_for_removal.csv"),
              ["Series", "Issue", "Cover", "Publisher", "CLZ Quantity", "Location", "Barcode", "CLZ Id", "Why"], removal)
    write_csv(os.path.join(out, "quantity_changes.csv"),
              ["Book (CLZ)", "CLZ Quantity", "ComicBase Quantity", "CLZ Id"], qty)
    summary["report"] = os.path.basename(args.report)
    summary["out"] = out
    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
