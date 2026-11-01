#!/usr/bin/env python3
"""Comics guide prices from CLZ, ComicBase (second opinion) and CovrPrice → vault_market.guide_price_observation.

Operator, 2026-10-25: CLZ uploads are the comics inventory and pricing; ComicBase stays connected for
pricing as a second opinion. Both are vendor guides (evidence class vendor_derived), never sold comps,
and every value is a dated row (one per holding, source, condition, day), never a scalar overwrite.
baseline_eligible is false on these rows, so the PriceCharting baseline is unchanged.

  clz        CLZ's value for each active CLZ holding, dated by the CLZ export it came from
             (import_clz.py runs this after every load). Condition: as catalogued, NM assumed · unverified.
  comicbase  ComicBase's price for each ComicBase item that matches exactly one CLZ holding
             (comicbase-report-match). The export file is kept as a raw snapshot. Items that do not
             match exactly are written to not_priced.csv in the exports folder, never guessed.
  covrprice  The "CovrPrice Value" column of the operator's CLZ Cloud CSV export (operator 2026-10-31, E4).
             Rows match CLZ holdings on series + issue + variant + storage box; a group of identical rows
             prices the same number of identical copies. Anything else goes to not_priced.csv. CLZ does
             not quote fields, so a title holding ';' splits one row: when there is exactly one extra
             column it is rejoined into Full Title, otherwise the row is listed, never guessed.

Usage:
  python scripts/comics_guide_prices.py clz [--dry-run]
  python scripts/comics_guide_prices.py comicbase --file "D:/VIP/imports/comicbase/Exported Comic Books.txt" [--dry-run]
  python scripts/comics_guide_prices.py covrprice --file "D:/VIP/imports/export_comics.csv" [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import io
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


# --- CovrPrice (values exported through CLZ Cloud) -------------------------------------------------

COVRPRICE_SOURCE = "covrprice_export"
COVRPRICE_REQUIRED = ("Series", "Issue", "Variant Description", "Storage Box", "CovrPrice Value")


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def read_covrprice_csv(path: str) -> tuple[list[dict], list[list]]:
    """Rows of a CLZ Cloud CSV export, plus the rows that could not be read: [line, text, why].

    CLZ separates with ';' and does not quote, so a title holding ';' gives one extra column. When the header
    has Full Title and a row has exactly one extra column, the two pieces are rejoined there (the title is the
    free-text field). Any other column count is reported, never guessed; a wrong rejoin would also fail to
    match, since Series and the other key columns would then be shifted."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        text = fh.read()
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") >= first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = [h.strip() for h in next(reader, [])]
    missing = [c for c in COVRPRICE_REQUIRED if c not in header]
    if missing:
        raise SystemExit(f"CLZ export is missing column(s) {', '.join(missing)}; re-export with them added")
    title_at = header.index("Full Title") if "Full Title" in header else None
    rows: list[dict] = []
    broken: list[list] = []
    for line, fields in enumerate(reader, start=2):
        if not any(f.strip() for f in fields):
            continue
        rejoined = False
        if len(fields) == len(header) + 1 and title_at is not None:
            fields = fields[:title_at] + [fields[title_at] + delimiter + fields[title_at + 1]] + fields[title_at + 2 :]
            rejoined = True
        if len(fields) != len(header):
            broken.append([line, delimiter.join(fields), f"{len(fields)} columns, header has {len(header)}"])
            continue
        row = dict(zip(header, fields))
        row["_line"] = line
        row["_rejoined"] = rejoined
        rows.append(row)
    return rows, broken


def covrprice_key(series, issue, variant, box) -> tuple:
    return (_norm(series), _norm(issue), _norm(variant), _norm(box))


def covrprice_label(row: dict) -> str:
    variant = row.get("Variant Description") or ""
    return f"{row.get('Series')} #{row.get('Issue')}{f' ({variant})' if variant else ''} · {row.get('Storage Box') or 'no box'}"


def match_covrprice(rows: list[dict], holdings: list[tuple]) -> tuple[list[tuple[dict, tuple]], list[list]]:
    """Pair export rows with CLZ copies. holdings: (holding_id, asset_id, source_row_id, series, issue_full,
    variant, location). A key group prices only when the export and VIP hold the same number of copies, all
    ungraded and at one CovrPrice value; the copies are then the same book and each gets that value."""
    by_key: dict[tuple, list[tuple]] = {}
    for h in holdings:
        by_key.setdefault(covrprice_key(h[3], h[4], h[5], h[6]), []).append(h)
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault(covrprice_key(r["Series"], r["Issue"], r["Variant Description"], r["Storage Box"]), []).append(r)

    pairs: list[tuple[dict, tuple]] = []
    not_priced: list[list] = []
    for key, group in groups.items():
        prices = {price_of(r["CovrPrice Value"]) for r in group}
        copies = sorted(by_key.get(key, []), key=lambda h: h[2] or "")
        if prices == {None}:
            reason = "no CovrPrice value in the export"
        elif any((r.get("Grade") or "").strip() or (r.get("Grading Company") or "").strip() for r in group):
            reason = "graded copy: CovrPrice grade values are not mapped to a condition yet"
        elif not copies:
            reason = "no VIP copy with this series, issue, variant and storage box"
        elif len(copies) != len(group):
            reason = f"{len(group)} export row(s) vs {len(copies)} VIP copies"
        elif len(prices) != 1 or None in prices:
            reason = "identical copies carry different CovrPrice values"
        else:
            pairs.extend(zip(group, copies))
            continue
        shown = ", ".join(r["CovrPrice Value"] or "-" for r in group)
        not_priced.append([covrprice_label(group[0]), len(group), shown, reason])
    return pairs, not_priced


def run_covrprice(conn, path: str, *, dry_run: bool, out_dir: str) -> dict:
    from raw_snapshots import record_file_snapshot

    rows, broken = read_covrprice_csv(path)
    cur = conn.cursor()
    cur.execute(
        """SELECT h.id::text, h.asset_id::text, h.source_row_id, h.clz_metadata->>'Series',
                  h.clz_metadata->>'Issue Full', h.clz_metadata->>'Edition / Variant', h.clz_metadata->>'Location'
             FROM vault_collection.holding h
            WHERE h.dropped_at IS NULL AND h.source = 'clz_import' AND h.source_row_id IS NOT NULL"""
    )
    pairs, not_priced = match_covrprice(rows, cur.fetchall())

    written = 0
    snap = None
    if not dry_run:
        snap = record_file_snapshot(
            conn, path=path, source=COVRPRICE_SOURCE, rule_version=RULE_VERSION, record_count=len(rows),
            content_type="text/csv",
        )
        for row, h in pairs:
            how = "series, issue, variant and storage box"
            if row["_rejoined"]:
                how += "; title rejoined where an unquoted ';' split the row"
            cur.execute(
                INSERT_SQL,
                (
                    h[1], h[0], h[2], "raw_nm", snap.ingested_at.date(), snap.ingested_at,
                    "covrprice", "covrprice", price_of(row["CovrPrice Value"]), snap.id,
                    json.dumps({"clz_hash": h[2], "clz_cloud_line": row["_line"]}),
                    COVRPRICE_SOURCE, RULE_VERSION, CONFIDENCE,
                    f"CovrPrice value for {covrprice_label(row)} from CLZ Cloud export {snap.short_hash}. No grade set "
                    f"in CLZ, so this is CovrPrice's ungraded value (shown as NM) · NM assumed, unverified. "
                    f"Matched: {how}. Vendor guide built from sales, not a sold comp.",
                    f"covrprice:{snap.short_hash}",
                ),
            )
            written += cur.rowcount
        conn.commit()

    stem = re.sub(r"[^A-Za-z0-9]+", "-", os.path.splitext(os.path.basename(path))[0]).strip("-")
    out = os.path.join(out_dir, f"covrprice-prices-{stem}")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "not_priced.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["Export row", "Rows", "CovrPrice value", "Why not priced"])
        w.writerows(not_priced)
        w.writerows([[f"line {line}: {text[:160]}", 1, "", f"unreadable row: {why}"] for line, text, why in broken])
    return {
        "job": "comics-guide-prices",
        "source": "covrprice",
        "dry_run": dry_run,
        "file": os.path.basename(path),
        "raw_snapshot": snap.short_hash if snap else None,
        "rows": len(rows),
        "rows_rejoined": sum(1 for r in rows if r["_rejoined"]),
        "rows_unreadable": len(broken),
        "copies_priced": len(pairs),
        "rows_written": written,
        "not_priced": len(not_priced) + len(broken),
        "not_priced_csv": os.path.join(out, "not_priced.csv"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", choices=["clz", "comicbase", "covrprice"])
    ap.add_argument("--file", help="ComicBase export (.txt/.csv/.htm), or CLZ Cloud CSV for covrprice")
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    import psycopg2

    conn = psycopg2.connect(args.dsn)
    try:
        if args.source == "clz":
            report = run_clz(conn, dry_run=args.dry_run)
        elif args.source == "covrprice":
            if not args.file:
                raise SystemExit("covrprice needs --file <CLZ Cloud CSV export with a CovrPrice Value column>")
            report = run_covrprice(conn, args.file, dry_run=args.dry_run, out_dir=args.out)
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
