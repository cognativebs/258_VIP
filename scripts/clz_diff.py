#!/usr/bin/env python3
"""CLZ DIFF importer — not a reload.

Dry-run by default. Snapshots the XML. Classifies new/changed/unchanged/
disappeared. Never deletes disappeared (flags possibly_sold). Never touches
asset_id, vendor_product_map, or enrichment scores. Phase 2 stays off.

  python scripts/clz_diff.py
  python scripts/clz_diff.py --xml path/to/export.xml
  python scripts/clz_diff.py --apply --xml path/to/export.xml
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from clz_comic_parser import parse_clz_xml  # noqa: E402
from clz_delta import holding_row_id  # noqa: E402
from clz_diff_classify import (  # noqa: E402
    ExistingClzHolding,
    classify_clz_diff,
    incoming_user_fields,
)
from load_comics import parse_date, slugify, norm, parse_year  # noqa: E402

DEFAULT_DSN = os.environ.get(
    "IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost"
)
WATCH_DIR = ROOT / "data" / "imports" / "clz"
RAW_DIR = ROOT / "data" / "raw" / "clz"
REPORT_DIR = WATCH_DIR / "reports"
PROCESSED_DIR = WATCH_DIR / "processed"
RULE = "clz-diff-importer@0.1.0"
SNAPSHOT_SOURCE = "clz_xml"
CLZ_VALUE_FIELD = "vault_collection.holding.current_price_snapshot"
GUIDE_BASELINE_VIEW = "vault_market.v_guide_price_baseline"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_watch_xml(watch: Path) -> Path | None:
    if not watch.is_dir():
        return None
    files = sorted(p for p in watch.iterdir() if p.is_file() and p.suffix.lower() == ".xml")
    return files[0] if files else None


def snapshot_xml(xml_path: Path, content_hash: str, day: date) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    dest = RAW_DIR / f"{day.isoformat()}_{content_hash[:12]}.xml"
    if not dest.exists():
        shutil.copy2(xml_path, dest)
    return dest


def load_existing(conn) -> dict[str, ExistingClzHolding]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT h.source_row_id, h.current_price_snapshot, h.quantity, h.purchase_price,
               h.purchase_date::text, h.location, h.slab_status, h.assumed_grade, h.grade_rating,
               COALESCE(h.possibly_sold, false), a.canonical_name, a.id::text, a.slug,
               EXISTS (
                 SELECT 1 FROM vault_market.vendor_product_map m WHERE m.asset_id = a.id
               ) AS has_map
          FROM vault_collection.holding h
          JOIN vault_core.asset a ON a.id = h.asset_id
         WHERE h.source = 'clz_import'
           AND h.dropped_at IS NULL
        """
    )
    existing: dict[str, ExistingClzHolding] = {}
    for row in cur.fetchall():
        rid = str(row[0] or "")
        if not rid:
            continue
        existing[rid] = ExistingClzHolding(
            source_row_id=rid,
            current_price=float(row[1]) if row[1] is not None else None,
            quantity=int(row[2]) if row[2] is not None else None,
            purchase_price=float(row[3]) if row[3] is not None else None,
            purchase_date=row[4],
            location=row[5],
            slab_status=row[6],
            assumed_grade=row[7],
            grade_rating=float(row[8]) if row[8] is not None else None,
            possibly_sold=bool(row[9]),
            canonical_name=row[10],
            asset_id=row[11],
            slug=row[12],
            has_vendor_map=bool(row[13]),
        )
    cur.close()
    return existing


def load_asset_maps(conn) -> dict[str, bool]:
    """slug -> already has a vendor_product_map."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT a.slug,
               EXISTS (
                 SELECT 1 FROM vault_market.vendor_product_map m WHERE m.asset_id = a.id
               )
          FROM vault_core.asset a
         WHERE a.slug IS NOT NULL
        """
    )
    slugs = {str(row[0]): bool(row[1]) for row in cur.fetchall() if row[0]}
    cur.close()
    return slugs


def incoming_slug(row: dict[str, Any]) -> str:
    series_t = norm(row.get("Series"))
    publisher = norm(row.get("Publisher")) or "Unknown"
    year_began = parse_year(row.get("Release Date")) or parse_year(row.get("Cover Date"))
    issue_no = norm(row.get("Issue")) or norm(row.get("Issue Full")) or "1"
    cover_label = (norm(row.get("Edition / Variant")) or norm(row.get("Issue Ext")) or "A")[:120]
    issue_full = norm(row.get("Issue Full")) or issue_no
    return slugify(publisher, series_t, issue_full, cover_label, year_began)


def incoming_by_id(xml_path: Path) -> dict[str, dict[str, Any]]:
    incoming: dict[str, dict[str, Any]] = {}
    for row in parse_clz_xml(str(xml_path)):
        rid = holding_row_id(row)
        if rid:
            incoming[rid] = row
    return incoming


def build_report(
    *,
    xml_path: Path,
    snapshot_path: Path | None,
    content_hash: str,
    existing: dict[str, ExistingClzHolding],
    incoming: dict[str, dict[str, Any]],
    asset_maps: dict[str, bool],
    dry_run: bool,
    applied: bool,
) -> dict[str, Any]:
    counts = classify_clz_diff(existing, incoming)
    need_map = 0
    reuse_map = 0
    for row in counts.new:
        slug = incoming_slug(incoming[row.source_row_id])
        if asset_maps.get(slug):
            row.needs_fresh_vendor_map = False
            reuse_map += 1
        else:
            row.needs_fresh_vendor_map = True
            need_map += 1
    rows = [
        {
            "sourceRowId": row.source_row_id,
            "classification": row.classification,
            "changeTypes": row.change_types,
            "changedFields": row.changed_fields,
            "possiblySold": False if dry_run else row.possibly_sold,
            "canonicalName": row.canonical_name,
            "clzValue": row.clz_value,
            "quantity": row.quantity,
            "needsFreshVendorMap": row.needs_fresh_vendor_map,
        }
        for row in counts.all_rows()
        if row.classification != "unchanged"
    ]

    def typed(*labels: str) -> int:
        return sum(1 for row in counts.all_rows() if any(t in row.change_types for t in labels))

    return {
        "ruleOrModelVersion": RULE,
        "dryRun": dry_run,
        "applied": applied,
        "phase2Enabled": False,
        "exportPath": str(xml_path),
        "snapshotPath": str(snapshot_path) if snapshot_path else None,
        "contentHash": content_hash,
        "incomingCount": len(incoming),
        "existingCount": len(existing),
        "newCount": len(counts.new),
        "changedCount": len(counts.changed),
        "unchangedCount": len(counts.unchanged),
        "disappearedCount": len(counts.disappeared),
        "possiblySoldFlagged": 0 if dry_run else len(counts.disappeared),
        "byType": {
            "ownershipNew": typed("ownership_new"),
            "ownershipSold": typed("ownership_sold"),
            "ownershipQuantity": typed("ownership_quantity"),
            "conditionGrade": typed("condition_grade"),
            "clzValueDrift": typed("clz_value_drift"),
            "metadataOnly": typed("metadata_only"),
        },
        "newNeedFreshVendorMap": need_map,
        "newReuseExistingMap": reuse_map,
        "clzValueLanding": {
            "clzValueField": CLZ_VALUE_FIELD,
            "guideBaseline": GUIDE_BASELINE_VIEW,
            "writesGuideBaseline": False,
            "notes": (
                "CLZ Current Price writes only holding.current_price_snapshot. "
                "Never guide_price_observation / v_guide_price_baseline."
            ),
        },
        "possiblySoldCandidates": [
            {
                "sourceRowId": row.source_row_id,
                "canonicalName": row.canonical_name,
                "clzValue": row.clz_value,
                "quantity": row.quantity,
            }
            for row in counts.disappeared
        ],
        "rows": rows,
        "notes": (
            "DIFF importer. Dry-run never flags possibly_sold. "
            "CLZ value ≠ PriceCharting baseline. "
            "asset_id / vendor_product_map / enrichment scores / guide baseline not written. "
            "Not signals_normalized. Phase 2 off. Apply only after confirmation."
        ),
        "newIds": [r.source_row_id for r in counts.new],
        "changedIds": [r.source_row_id for r in counts.changed],
        "disappearedIds": [r.source_row_id for r in counts.disappeared],
    }


def apply_diff(conn, incoming: dict[str, dict[str, Any]], report: dict[str, Any], snapshot_id: str | None) -> dict[str, int]:
    """Write CLZ user fields + possibly_sold.

    Never writes asset_id, vendor_product_map, enrichment scores,
    guide_price_observation, or v_guide_price_baseline. CLZ dollars stay on
    holding.current_price_snapshot only.
    """
    cur = conn.cursor()
    changed = 0
    for rid in report["changedIds"]:
        row = incoming[rid]
        fields = incoming_user_fields(row)
        cur.execute(
            """
            UPDATE vault_collection.holding
               SET quantity = %s,
                   purchase_price = %s,
                   purchase_date = %s,
                   location = %s,
                   slab_status = %s,
                   assumed_grade = %s,
                   grade_rating = %s,
                   current_price_snapshot = %s,
                   possibly_sold = false,
                   updated_at = now()
             WHERE source = 'clz_import'
               AND source_row_id = %s
            """,
            (
                fields["Quantity"] if fields["Quantity"] is not None else 1,
                fields["Purchase Price"],
                parse_date(fields["Purchase Date"]),
                fields["Location"],
                fields["Slab Status"],
                fields["Assumed Grade"],
                fields["Grade Rating"],
                fields["Current Price"],
                rid,
            ),
        )
        changed += cur.rowcount or 0
    flagged = 0
    if report["disappearedIds"]:
        cur.execute(
            """
            UPDATE vault_collection.holding
               SET possibly_sold = true,
                   updated_at = now()
             WHERE source = 'clz_import'
               AND dropped_at IS NULL
               AND source_row_id = ANY(%s)
            """,
            (report["disappearedIds"],),
        )
        flagged = cur.rowcount or 0
    inserted = 0
    for rid in report["newIds"]:
        inserted += insert_new_holding(cur, incoming[rid], rid, snapshot_id)
    cur.close()
    return {"changed": changed, "possiblySold": flagged, "inserted": inserted}


def insert_new_holding(cur, row: dict[str, Any], rid: str, snapshot_id: str | None) -> int:
    """Catalog + holding for a new CLZ id only. Does not update existing asset_id."""
    series_t = norm(row.get("Series"))
    publisher = norm(row.get("Publisher")) or "Unknown"
    if not series_t:
        return 0
    year_began = parse_year(row.get("Release Date")) or parse_year(row.get("Cover Date"))
    cur.execute(
        """INSERT INTO vault_comic.series (title, publisher, volume, year_began)
           VALUES (%s,%s,1,%s)
           ON CONFLICT (title, publisher, volume, year_began) DO UPDATE SET title=EXCLUDED.title
           RETURNING id""",
        (series_t, publisher, year_began),
    )
    series_id = cur.fetchone()[0]
    issue_no = norm(row.get("Issue")) or norm(row.get("Issue Full")) or "1"
    cur.execute(
        """INSERT INTO vault_comic.issue
               (series_id, issue_number, cover_date, is_key_issue, key_reason)
           VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (series_id, issue_number) DO UPDATE SET issue_number=EXCLUDED.issue_number
           RETURNING id""",
        (
            series_id,
            issue_no,
            parse_date(row.get("Cover Date")),
            norm(row.get("Is Key Comic")).lower() in ("minor", "major", "yes"),
            None,
        ),
    )
    issue_id = cur.fetchone()[0]
    cover_label = (norm(row.get("Edition / Variant")) or norm(row.get("Issue Ext")) or "A")[:120]
    issue_full = norm(row.get("Issue Full")) or issue_no
    canonical = f"{series_t} #{issue_full}"
    if cover_label not in ("A", ""):
        canonical += f" ({cover_label})"
    slug = slugify(publisher, series_t, issue_full, cover_label, year_began)
    cur.execute(
        """INSERT INTO vault_core.asset
               (category_id, format, canonical_name, slug, release_year, tags, primary_image_url)
           VALUES (4,'single',%s,%s,%s,%s,%s)
           ON CONFLICT (slug) DO UPDATE SET canonical_name = vault_core.asset.canonical_name
           RETURNING id""",
        (canonical, slug, parse_year(row.get("Release Date")), [], norm(row.get("Cover Image URL")) or None),
    )
    asset_id = cur.fetchone()[0]
    cur.execute(
        """INSERT INTO vault_comic.variant
               (asset_id, issue_id, printing, cover_label, is_variant_cover)
           VALUES (%s,%s,1,%s,%s)
           ON CONFLICT DO NOTHING""",
        (asset_id, issue_id, cover_label, cover_label not in ("A", "Regular")),
    )
    fields = incoming_user_fields(row)
    cur.execute(
        """INSERT INTO vault_collection.holding
               (asset_id, quantity, purchase_price, purchase_date, location,
                slab_status, assumed_grade, grade_rating,
                current_price_snapshot, source, source_row_id, clz_metadata,
                raw_snapshot_id, possibly_sold)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'clz_import',%s,%s::jsonb,%s,false)
           ON CONFLICT (source, source_row_id) DO NOTHING""",
        (
            asset_id,
            fields["Quantity"] if fields["Quantity"] is not None else 1,
            fields["Purchase Price"],
            parse_date(fields["Purchase Date"]),
            fields["Location"],
            fields["Slab Status"],
            fields["Assumed Grade"],
            fields["Grade Rating"],
            fields["Current Price"],
            rid,
            json.dumps(row, default=str),
            snapshot_id,
        ),
    )
    return cur.rowcount or 0


def write_report(report: dict[str, Any], content_hash: str, day: date) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{day.isoformat()}_{content_hash[:12]}_diff.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    return path


def format_report(report: dict[str, Any]) -> str:
    by_type = report.get("byType") or {}
    landing = report.get("clzValueLanding") or {}
    sold = report.get("possiblySoldCandidates") or []
    sold_lines = [
        f"  {row.get('canonicalName') or row.get('sourceRowId')} id={row.get('sourceRowId')} clz=${row.get('clzValue') if row.get('clzValue') is not None else '?'} qty={row.get('quantity')}"
        for row in sold[:40]
    ]
    if len(sold) > 40:
        sold_lines.append(f"  … {len(sold) - 40} more")
    return "\n".join(
        [
            f"{report['ruleOrModelVersion']} dryRun={report['dryRun']} applied={report['applied']} phase2Enabled={report['phase2Enabled']}",
            f"export={report['exportPath']}",
            f"snapshot={report['snapshotPath']}",
            f"incoming={report['incomingCount']} existing={report['existingCount']}",
            f"ownership new={by_type.get('ownershipNew', 0)} sold_candidates={by_type.get('ownershipSold', 0)} quantity={by_type.get('ownershipQuantity', 0)}",
            f"condition/grade={by_type.get('conditionGrade', 0)} clzValueDrift={by_type.get('clzValueDrift', 0)} metadataOnly={by_type.get('metadataOnly', 0)}",
            f"unchanged={report['unchangedCount']} possiblySoldFlagged={report['possiblySoldFlagged']}",
            f"newNeedFreshVendorMap={report.get('newNeedFreshVendorMap', 0)} newReuseExistingMap={report.get('newReuseExistingMap', 0)}",
            f"clzValueField={landing.get('clzValueField')} guideBaseline={landing.get('guideBaseline')} writesGuideBaseline={landing.get('writesGuideBaseline')}",
            "possibly_sold candidates (not flagged):",
            *(sold_lines or ["  none"]),
            report["notes"],
        ]
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xml", help="CLZ XML export. Default: first file in data/imports/clz/")
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--apply", action="store_true", help="Write holding user-field + possibly_sold. Default is dry-run.")
    ap.add_argument("--keep-inbox", action="store_true", help="Do not move the watch file to processed/")
    args = ap.parse_args()

    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    xml_path = Path(args.xml) if args.xml else find_watch_xml(WATCH_DIR)
    summary: dict[str, Any] = {
        "job": "clz-diff",
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "watch": str(WATCH_DIR),
        "empty": xml_path is None,
        "phase2Enabled": False,
    }
    if xml_path is None:
        summary["reason"] = "empty_watch"
        print(json.dumps(summary), flush=True)
        print(f"CLZ watch empty: {WATCH_DIR}", file=sys.stderr)
        return 0

    content_hash = sha256_file(xml_path)
    day = date.today()
    snapshot_path = snapshot_xml(xml_path, content_hash, day)
    incoming = incoming_by_id(xml_path)

    import psycopg2

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    try:
        existing = load_existing(conn)
        asset_maps = load_asset_maps(conn)
        report = build_report(
            xml_path=xml_path,
            snapshot_path=snapshot_path,
            content_hash=content_hash,
            existing=existing,
            incoming=incoming,
            asset_maps=asset_maps,
            dry_run=not args.apply,
            applied=False,
        )
        snapshot_id = None
        if args.apply:
            from raw_snapshots import record_file_snapshot

            snap = record_file_snapshot(
                conn,
                path=str(xml_path),
                source=SNAPSHOT_SOURCE,
                rule_version=RULE,
                record_count=len(incoming),
            )
            snapshot_id = snap.id
            stats = apply_diff(conn, incoming, report, snapshot_id)
            report["applied"] = True
            report["dryRun"] = False
            report["applyStats"] = stats
            conn.commit()
        else:
            conn.rollback()
        report_path = write_report(report, content_hash, day)
        report["reportPath"] = str(report_path)
        if not args.keep_inbox and xml_path.parent.resolve() == WATCH_DIR.resolve():
            dest = PROCESSED_DIR / xml_path.name
            if xml_path.resolve() != dest.resolve():
                shutil.move(str(xml_path), str(dest))
        print(format_report(report), file=sys.stderr)
        summary["report"] = report
        print(json.dumps(summary), flush=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
