#!/usr/bin/env python3
"""ComicBase export → VIP (ADR 0016): snapshot → parse → match → review list.

Each new ComicBase Collection Report (.htm) in the watched folder is stored as
an immutable raw snapshot (source 'comicbase_export'), parsed into items, and
matched to comics holdings. Matches add the ComicBase item key to the
holding's provider_ids; nothing else on a holding changes. Doubtful and
unmatched items go to the review list (vault_collection.comicbase_item,
needs_review), which only an operator confirm clears. A confirmed match is
never overwritten by a later import. While ComicBase is still being filled in,
holdings missing from ComicBase are not flagged, and unmatched ComicBase items
do not become new holdings.

Usage:
  python scripts/import_comicbase.py                  # every new file in the watched folder
  python scripts/import_comicbase.py --file report.htm [--dry-run] [--force]
  python scripts/import_comicbase.py --review [--unmatched]
  python scripts/import_comicbase.py --confirm <item_key> <holding_id> --confirm-operator
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from comicbase_report import RULE_VERSION, SOURCE, VipHolding, match_items, parse_report  # noqa: E402

DEFAULT_DSN = os.environ.get("IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost")
DEFAULT_INBOX = os.path.join(ROOT, "data", "imports", "comicbase")

HOLDINGS_SQL = """
SELECT h.id::text, s.title, s.publisher, s.year_began, i.issue_number, v.cover_label, v.printing, h.quantity
  FROM vault_collection.holding h
  JOIN vault_comic.variant v ON v.asset_id = h.asset_id
  JOIN vault_comic.issue i   ON i.id = v.issue_id
  JOIN vault_comic.series s  ON s.id = i.series_id
 WHERE h.dropped_at IS NULL
"""


def inbox_dir() -> str:
    return os.environ.get("VIP_COMICBASE_INBOX") or DEFAULT_INBOX


def add_provider_id(cur, holding_id: str, item_key: str) -> None:
    cur.execute(
        """UPDATE vault_collection.holding
              SET provider_ids = jsonb_set(provider_ids, '{comicbase}',
                    COALESCE(provider_ids->'comicbase', '[]'::jsonb) || to_jsonb(%s::text), true)
            WHERE id = %s::uuid AND NOT COALESCE(provider_ids->'comicbase', '[]'::jsonb) ? %s""",
        (item_key, holding_id, item_key),
    )


def upsert_items(cur, matches, snapshot_id: str) -> Counter:
    stats: Counter = Counter()
    for m in matches:
        it = m.item
        key = it.item_key
        cur.execute(
            """SELECT match_status, matched_holding_id::text, quantity, needs_review, confirmed_at IS NOT NULL
                 FROM vault_collection.comicbase_item WHERE item_key = %s""",
            (key,),
        )
        row = cur.fetchone()
        status, method, holding, reason, needs_review = m.status, m.method, m.holding_id, m.reason, m.status != "matched"
        if row:
            prev_status, prev_holding, prev_qty, prev_review, confirmed = row
            if confirmed:
                # Operator's match stands; a changed quantity reopens review, nothing else moves.
                status, method, holding = prev_status, "manual", prev_holding
                needs_review = prev_review or it.quantity != prev_qty
                reason = f"confirmed by operator; ComicBase quantity now {it.quantity}" if it.quantity != prev_qty else "confirmed by operator"
            elif prev_review:
                # needs_review is permanent until a person clears it: keep reviewing, carry the new suggestion.
                needs_review, status = True, "needs_review" if m.status != "unmatched" else prev_status
                if m.status == "matched":
                    method, reason = "review", f"now suggests one holding: {m.reason}"
            elif prev_status == "matched" and (m.status != "matched" or m.holding_id != prev_holding):
                status, method, holding, needs_review = "needs_review", "review", prev_holding, True
                reason = f"earlier match no longer holds: {m.reason}"
        cur.execute(
            """INSERT INTO vault_collection.comicbase_item
                   (item_key, series_title, publisher, year_label, start_year, issue_number, variant_letter, quantity,
                    first_raw_snapshot_id, last_raw_snapshot_id, match_status, matched_holding_id, candidate_holding_ids,
                    match_method, match_confidence, match_reason, needs_review, prov_rule_version)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::uuid[],%s,%s,%s,%s,%s)
               ON CONFLICT (item_key) DO UPDATE SET
                   quantity = EXCLUDED.quantity,
                   last_raw_snapshot_id = EXCLUDED.last_raw_snapshot_id,
                   last_seen_at = now(),
                   match_status = EXCLUDED.match_status,
                   matched_holding_id = EXCLUDED.matched_holding_id,
                   candidate_holding_ids = EXCLUDED.candidate_holding_ids,
                   match_method = EXCLUDED.match_method,
                   match_confidence = CASE WHEN vault_collection.comicbase_item.confirmed_at IS NULL
                                           THEN EXCLUDED.match_confidence ELSE vault_collection.comicbase_item.match_confidence END,
                   match_reason = EXCLUDED.match_reason,
                   needs_review = EXCLUDED.needs_review,
                   prov_rule_version = EXCLUDED.prov_rule_version""",
            (
                key, it.series_title, it.publisher, it.year_label, it.start_year,
                f"{it.issue_prefix} {it.issue_number}" if it.issue_prefix else it.issue_number,
                it.variant_letter, it.quantity, snapshot_id, snapshot_id, status, holding,
                m.candidates, method, 1.0 if method == "manual" else m.confidence, reason, needs_review, RULE_VERSION,
            ),
        )
        if status == "matched" and holding:
            add_provider_id(cur, holding, key)
        stats[status] += 1
        stats["copies_" + status] += it.quantity
    return stats


def import_file(conn, path: str, *, dry_run: bool, force: bool) -> dict:
    from raw_snapshots import record_file_snapshot, sha256_file

    with open(path, encoding="utf-8-sig") as handle:
        items = parse_report(handle.read())
    cur = conn.cursor()
    cur.execute(HOLDINGS_SQL)
    holdings = [VipHolding(*r) for r in cur.fetchall()]
    matches = match_items(items, holdings)
    report = {
        "file": os.path.basename(path),
        "sha256": sha256_file(path)[:12],
        "items": len(items),
        "copies": sum(i.quantity for i in items),
        "dry_run": dry_run,
    }
    if dry_run:
        report["would"] = dict(Counter(m.status for m in matches))
        return report
    snap = record_file_snapshot(
        conn, path=path, source=SOURCE, rule_version=RULE_VERSION, record_count=len(items), content_type="text/html"
    )
    cur.execute("SELECT 1 FROM vault_collection.comicbase_item WHERE last_raw_snapshot_id = %s LIMIT 1", (snap.id,))
    if cur.fetchone() and not force:
        conn.rollback()
        report["skipped"] = "already imported (same bytes)"
        return report
    report["snapshot"] = snap.short_hash
    report["result"] = dict(upsert_items(cur, matches, snap.id))
    conn.commit()
    return report


def list_review(conn, unmatched: bool) -> None:
    cur = conn.cursor()
    cur.execute(
        """SELECT item_key, series_title, issue_number, variant_letter, quantity, match_status, match_reason,
                  candidate_holding_ids::text[]
             FROM vault_collection.comicbase_item
            WHERE needs_review AND (match_status = 'unmatched') = %s
            ORDER BY series_title, issue_number, variant_letter NULLS FIRST""",
        (unmatched,),
    )
    rows = cur.fetchall()
    print(f"{len(rows)} {'unmatched' if unmatched else 'to review'}")
    for key, title, issue, letter, qty, status, reason, cands in rows:
        print(f"- {title} #{issue}{'/' + letter if letter else ''} ×{qty} — {reason}")
        print(f"    key: {key}")
        for c in cands or []:
            print(f"    candidate holding: {c}")


def confirm(conn, item_key: str, holding_id: str) -> None:
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM vault_collection.holding WHERE id = %s::uuid AND dropped_at IS NULL", (holding_id,))
    if not cur.fetchone():
        raise SystemExit(f"no active holding {holding_id}")
    cur.execute(
        """UPDATE vault_collection.comicbase_item
              SET match_status = 'matched', match_method = 'manual', matched_holding_id = %s::uuid,
                  match_confidence = 1.0, needs_review = false, confirmed_at = now(), confirmed_by = 'operator',
                  prov_method = 'manual', prov_verification = 'verified',
                  match_reason = 'confirmed by operator'
            WHERE item_key = %s
        RETURNING item_key""",
        (holding_id, item_key),
    )
    if not cur.fetchone():
        raise SystemExit(f"no ComicBase item {item_key!r}")
    add_provider_id(cur, holding_id, item_key)
    conn.commit()
    print(f"confirmed {item_key} → holding {holding_id}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--dir", default=None, help="watched folder (default VIP_COMICBASE_INBOX or data/imports/comicbase)")
    ap.add_argument("--file")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="re-match a file that was already imported")
    ap.add_argument("--review", action="store_true")
    ap.add_argument("--unmatched", action="store_true")
    ap.add_argument("--confirm", nargs=2, metavar=("ITEM_KEY", "HOLDING_ID"))
    ap.add_argument("--confirm-operator", action="store_true")
    args = ap.parse_args(argv)

    import psycopg2

    conn = psycopg2.connect(args.dsn)
    try:
        if args.review:
            list_review(conn, args.unmatched)
            return 0
        if args.confirm:
            if not args.confirm_operator:
                raise SystemExit("confirming a match is an operator action: add --confirm-operator")
            confirm(conn, *args.confirm)
            return 0
        folder = args.dir or inbox_dir()
        files = [args.file] if args.file else sorted(
            glob.glob(os.path.join(folder, "*.htm")) + glob.glob(os.path.join(folder, "*.html")), key=os.path.getmtime
        )
        if not files:
            print(json.dumps({"job": "comicbase-import", "inbox": folder, "files": 0}))
            return 0
        for path in files:
            print(json.dumps({"job": "comicbase-import", **import_file(conn, path, dry_run=args.dry_run, force=args.force)}))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
