#!/usr/bin/env python3
"""Comics guide prices from CLZ (primary) and ComicBase (second opinion) → vault_market.guide_price_observation.

Operator, 2026-10-25: CLZ uploads are the comics inventory and pricing; ComicBase stays connected for
pricing as a second opinion. Both are vendor guides (evidence class vendor_derived), never sold comps,
and every value is a dated row (one per holding, source, condition, day), never a scalar overwrite.
baseline_eligible is false on these rows, so the PriceCharting baseline is unchanged.

  clz        CLZ's value for each active CLZ holding, dated by the CLZ export it came from
             (import_clz.py runs this after every load). Condition: as catalogued, NM assumed · unverified.
  comicbase  ComicBase's price for each ComicBase item that matches exactly one CLZ holding
             (comicbase-report-match). The export file is kept as a raw snapshot. Items that do not
             match exactly are written to not_priced.csv in the exports folder, never guessed.

Usage:
  python scripts/comics_guide_prices.py clz [--dry-run]
  python scripts/comics_guide_prices.py comicbase --file "D:/VIP/imports/comicbase/Exported Comic Books.txt" [--dry-run]
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

DEFAULT_DSN = os.environ.get("IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost")
DEFAULT_OUT = os.environ.get("VIP_EXPORTS_DIR", r"D:\VIP\exports")
RULE_VERSION = "comics-guide-prices@0.1.0"
CONFIDENCE = 0.6  # vendor guide, below the 0.75 cap (ADR 0012)
CATALOGUE_CONFIDENCE = 0.5  # same guide, paired to the copy by cover description only

INSERT_SQL = """
INSERT INTO vault_market.guide_price_observation
  (asset_id, holding_id, holding_source_row_id, condition_key, snapshot_on, observed_at, observation_kind,
   source, data_source_id, evidence_class, guide_price, currency, raw_snapshot_id, provider_ids,
   prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes,
   ingest_batch, baseline_eligible)
VALUES (%s::uuid, %s::uuid, %s, %s, %s::date, %s, 'guide_quote',
        %s, (SELECT data_source_id FROM vault_market.data_source WHERE source_key = %s), 'vendor_derived',
        %s, 'USD', %s::uuid, %s::jsonb,
        %s, 'observed', %s, %s, 'unverified', %s,
        %s, false)
ON CONFLICT (holding_source_row_id, condition_key, source, snapshot_on) DO NOTHING
"""

# ComicBase condition codes → condition_key (raw copies; the export's default is NM, not a grade).
_CB_CONDITION = {"NM": "raw_nm", "VF": "raw_vf", "FN": "raw_fn", "VG": "raw_vg", "GD": "raw_gd", "FR": "raw_fr", "PR": "raw_pr"}


def condition_key_for_comicbase(code: str) -> str:
    code = (code or "").strip().upper()
    return _CB_CONDITION.get(code) or ("raw_" + re.sub(r"[^a-z0-9]+", "_", code.lower()).strip("_") if code else "raw_nm")


def price_of(value) -> float | None:
    try:
        n = float(str(value).replace("$", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def run_clz(conn, *, dry_run: bool) -> dict:
    cur = conn.cursor()
    cur.execute(
        """SELECT h.id::text, h.asset_id::text, h.source_row_id, h.current_price_snapshot::float,
                  h.raw_snapshot_id::text, rs.ingested_at, rs.content_hash
             FROM vault_collection.holding h
             JOIN vault_evidence.raw_snapshots rs ON rs.id = h.raw_snapshot_id
            WHERE h.source = 'clz_import' AND h.dropped_at IS NULL AND h.current_price_snapshot > 0
              AND h.source_row_id IS NOT NULL"""
    )
    rows = cur.fetchall()
    written = 0
    for hid, asset_id, row_id, price, snap_id, ingested_at, content_hash in rows:
        if dry_run:
            continue
        cur.execute(
            INSERT_SQL,
            (
                asset_id, hid, row_id, "raw_nm", ingested_at.date(), ingested_at,
                "clz", "clz", price, snap_id, json.dumps({"clz_hash": row_id}),
                "clz_export", RULE_VERSION, CONFIDENCE,
                f"CLZ value as catalogued in export {content_hash[:12]}; NM assumed · unverified. Vendor guide, not a sold comp.",
                f"clz:{content_hash[:12]}",
            ),
        )
        written += cur.rowcount
    if not dry_run:
        conn.commit()
    return {"job": "comics-guide-prices", "source": "clz", "dry_run": dry_run, "holdings_priced": len(rows), "rows_written": written}


def run_comicbase(conn, path: str, *, dry_run: bool, out_dir: str) -> dict:
    """Two passes. In-stock ComicBase items match CLZ holdings with comicbase-report-match (as the review
    list does). Catalogue items the export lists with no stock (the operator does not own them in
    ComicBase) price only CLZ holdings still unpriced, paired by cover description; they are never
    inventory. Both are vendor-guide rows, unverified."""
    from clz_reconcile_comicbase import read_comicbase
    from comicbase_report import SOURCE, VipHolding, match_by_cover_description, match_items
    from raw_snapshots import record_file_snapshot

    items, details = read_comicbase(path, include_unstocked=True)
    stocked = [i for i in items if i.quantity > 0]
    catalogue = [i for i in items if i.quantity <= 0]
    cur = conn.cursor()
    cur.execute(
        """SELECT h.id::text, s.title, s.publisher, s.year_began, i.issue_number, v.cover_label, v.printing, h.quantity,
                  h.asset_id::text, h.source_row_id
             FROM vault_collection.holding h
             JOIN vault_comic.variant v ON v.asset_id = h.asset_id
             JOIN vault_comic.issue i   ON i.id = v.issue_id
             JOIN vault_comic.series s  ON s.id = i.series_id
            WHERE h.dropped_at IS NULL AND h.source = 'clz_import'"""
    )
    rows = cur.fetchall()
    by_id = {r[0]: r for r in rows}
    vip = [VipHolding(*r[:8]) for r in rows]
    matches = match_items(stocked, vip)

    snap = None
    if not dry_run:
        html = path.lower().endswith((".htm", ".html"))
        snap = record_file_snapshot(
            conn, path=path, source=SOURCE, rule_version=RULE_VERSION, record_count=len(items),
            content_type="text/html" if html else "text/csv",
        )

    def label_of(it) -> str:
        issue = f"{it.issue_prefix} {it.issue_number}" if it.issue_prefix else it.issue_number
        return f"{it.series_title} #{issue}{'/' + it.variant_letter if it.variant_letter else ''}"

    def write(it, holding_id: str, reason: str, confidence: float, kind: str) -> int:
        d = details.get(it.item_key, {})
        h = by_id[holding_id]
        cur.execute(
            INSERT_SQL,
            (
                h[8], h[0], h[9], condition_key_for_comicbase(d.get("Condition", "")), snap.ingested_at.date(),
                snap.ingested_at, "comicbase", "comicbase", price_of(d.get("Price")), snap.id,
                json.dumps({"comicbase": it.item_key, "clz_hash": h[9]}),
                "comicbase_export", RULE_VERSION, confidence,
                f"ComicBase price (second opinion, {kind}) for {label_of(it)}, condition {d.get('Condition') or 'NM'} "
                f"as exported (ComicBase default, not a grade) · unverified. Matched: {reason}. Vendor guide, not a sold comp.",
                f"comicbase:{snap.short_hash}",
            ),
        )
        return cur.rowcount

    priced = priced_catalogue = written = 0
    priced_holdings: set[str] = set()
    not_priced: list[list] = []
    for m in matches:
        it = m.item
        price = price_of(details.get(it.item_key, {}).get("Price"))
        if price is None:
            not_priced.append([label_of(it), it.quantity, "", "ComicBase export has no price for this item"])
            continue
        if m.status != "matched" or not m.holding_id:
            not_priced.append([label_of(it), it.quantity, price, f"{m.status}: {m.reason}"])
            continue
        priced += 1
        priced_holdings.add(m.holding_id)
        if not dry_run:
            written += write(it, m.holding_id, m.reason, CONFIDENCE, "in stock in ComicBase")

    # Catalogue items: only for copies the in-stock pass left unpriced; never listed as not priced.
    priceable = [i for i in catalogue if price_of(details.get(i.item_key, {}).get("Price")) is not None]
    descriptions = {k: d.get("Item Description", "") for k, d in details.items()}
    for it, holding_id, reason in match_by_cover_description(priceable, descriptions, vip, priced_holdings):
        priced_catalogue += 1
        if not dry_run:
            written += write(it, holding_id, reason, CATALOGUE_CONFIDENCE, "ComicBase catalogue item, not owned there")
    if not dry_run:
        conn.commit()

    stem = re.sub(r"[^A-Za-z0-9]+", "-", os.path.splitext(os.path.basename(path))[0]).strip("-")
    out = os.path.join(out_dir, f"comicbase-prices-{stem}")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "not_priced.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["ComicBase item", "Quantity", "ComicBase price", "Why not priced"])
        w.writerows(not_priced)
    return {
        "job": "comics-guide-prices",
        "source": "comicbase",
        "dry_run": dry_run,
        "file": os.path.basename(path),
        "raw_snapshot": snap.short_hash if snap else None,
        "items": len(items),
        "items_in_stock": len(stocked),
        "catalogue_items": len(catalogue),
        "priced": priced,
        "priced_from_catalogue": priced_catalogue,
        "rows_written": written,
        "not_priced": len(not_priced),
        "not_priced_csv": os.path.join(out, "not_priced.csv"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", choices=["clz", "comicbase"])
    ap.add_argument("--file", help="ComicBase export (.txt/.csv item export or .htm report)")
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    import psycopg2

    conn = psycopg2.connect(args.dsn)
    try:
        if args.source == "clz":
            report = run_clz(conn, dry_run=args.dry_run)
        else:
            if not args.file:
                raise SystemExit("comicbase needs --file <ComicBase export>")
            report = run_comicbase(conn, args.file, dry_run=args.dry_run, out_dir=args.out)
    finally:
        conn.close()
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
