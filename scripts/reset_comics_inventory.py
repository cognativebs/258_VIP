#!/usr/bin/env python3
"""Delete the old CLZ comics inventory before a fresh CLZ import (operator, 2026-10-25).

Operator: "i don't want to keep the previous inventory list for comicbooks … delete these old entries
this time explicitly". A destructive, one-off operator action: dry run by default; deletes only with
--confirm-operator, after a full pg_dump backup, in one transaction (all or nothing).

Deleted:
  - every comics holding imported from CLZ (vault_collection.holding, source = 'clz_import')
  - the eBay ask observations tied to them (vault_market.listing_observation)
  - the guide-price rows keyed to their CLZ ids (vault_market.guide_price_observation)
  - the ComicBase review list (vault_collection.comicbase_item): it linked ComicBase items to these
    holdings; ComicBase prices are re-matched to the new holdings by comics_guide_prices.py
Unlinked, not deleted (the foreign key sets holding_id to NULL):
  - eBay listings that pointed at one of these holdings (vault_collection.marketplace_listing)
Kept:
  - the comics catalog (vault_core.asset, vault_comic.*) and its PriceCharting product matches: a fresh
    import reuses the same catalog rows, so those matches carry over
  - raw CLZ export snapshots (raw imports are immutable, AGENTS rule 3)

Usage:
  python scripts/reset_comics_inventory.py                       # dry run: counts only
  python scripts/reset_comics_inventory.py --confirm-operator    # backup, then delete
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

DEFAULT_DSN = os.environ.get("IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost")
DEFAULT_BACKUP_DIR = os.environ.get("VIP_BACKUP_DIR", r"D:\VIP\backups")
CONTAINER = os.environ.get("VIP_PG_CONTAINER", "iqvault-postgres")

OLD = "SELECT id, source_row_id FROM vault_collection.holding WHERE source = 'clz_import'"

COUNTS = {
    "holdings": f"SELECT count(*) FROM ({OLD}) o",
    "listing_observation": f"""SELECT count(*) FROM vault_market.listing_observation
        WHERE holding_id IN (SELECT id FROM ({OLD}) o) OR holding_source_row_id IN (SELECT source_row_id FROM ({OLD}) o)""",
    "guide_price_observation": f"""SELECT count(*) FROM vault_market.guide_price_observation
        WHERE holding_source_row_id IN (SELECT source_row_id FROM ({OLD}) o)""",
    "comicbase_item": "SELECT count(*) FROM vault_collection.comicbase_item",
    "marketplace_listing_unlinked": f"""SELECT count(*) FROM vault_collection.marketplace_listing
        WHERE holding_id IN (SELECT id FROM ({OLD}) o)""",
}

DELETES = [
    ("comicbase_item", "DELETE FROM vault_collection.comicbase_item"),
    (
        "listing_observation",
        f"""DELETE FROM vault_market.listing_observation
             WHERE holding_id IN (SELECT id FROM ({OLD}) o) OR holding_source_row_id IN (SELECT source_row_id FROM ({OLD}) o)""",
    ),
    (
        "guide_price_observation",
        f"""DELETE FROM vault_market.guide_price_observation
             WHERE holding_source_row_id IN (SELECT source_row_id FROM ({OLD}) o)""",
    ),
    ("holdings", "DELETE FROM vault_collection.holding WHERE source = 'clz_import'"),
]


def counts(cur) -> dict:
    out = {}
    for name, sql in COUNTS.items():
        cur.execute(sql)
        out[name] = cur.fetchone()[0]
    return out


def backup(dbname: str, backup_dir: str) -> str:
    os.makedirs(backup_dir, exist_ok=True)
    path = os.path.join(backup_dir, f"{dbname}-before-comics-reset-{datetime.now():%Y%m%d-%H%M%S}.dump")
    with open(path, "wb") as fh:
        proc = subprocess.run(["docker", "exec", CONTAINER, "pg_dump", "-U", "postgres", "-Fc", dbname], stdout=fh)
    if proc.returncode != 0 or os.path.getsize(path) < 1024:
        raise SystemExit(f"backup failed ({path}); nothing deleted")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--backup-dir", default=DEFAULT_BACKUP_DIR)
    ap.add_argument("--confirm-operator", action="store_true", help="really delete (after a backup)")
    args = ap.parse_args(argv)

    import psycopg2

    conn = psycopg2.connect(args.dsn)
    try:
        cur = conn.cursor()
        before = counts(cur)
        if not args.confirm_operator:
            print(json.dumps({"job": "reset-comics-inventory", "dry_run": True, "would_delete": before}))
            return 0
        dbname = conn.get_dsn_parameters().get("dbname", "iqvault")
        report = {"job": "reset-comics-inventory", "dry_run": False, "backup": backup(dbname, args.backup_dir)}
        deleted = {}
        for name, sql in DELETES:
            cur.execute(sql)
            deleted[name] = cur.rowcount
        cur.execute(f"SELECT count(*) FROM ({OLD}) o")
        if cur.fetchone()[0] != 0:
            conn.rollback()
            raise SystemExit("holdings still present after delete; rolled back, nothing deleted")
        conn.commit()
        report["deleted"] = deleted
        report["marketplace_listing_unlinked"] = before["marketplace_listing_unlinked"]
        print(json.dumps(report))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
