#!/usr/bin/env python3
"""Run IQVault SQL migrations (legacy 01–08 plus infra/db/migrations)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = [
    "01_core_spine.sql",
    "02_tcg.sql",
    "03_sports_comics.sql",
    "04_market_sealed_id.sql",
    "05_collection_hunts.sql",
    "06_platform_auth.sql",
    "07_collection_holdings.sql",
    "08_holding_clz_metadata.sql",
    "infra/db/migrations/20260720_01_raw_snapshots.sql",
    "infra/db/migrations/20260814_01_holding_dropped_at.sql",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dsn",
        default="dbname=iqvault user=postgres password=vault host=localhost",
    )
    args = ap.parse_args()

    try:
        import psycopg2
    except ImportError:
        print("pip install psycopg2-binary", file=sys.stderr)
        return 1

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = True
    cur = conn.cursor()

    for name in MIGRATIONS:
        path = ROOT / name
        if not path.exists():
            print(f"Missing: {path}", file=sys.stderr)
            return 1
        sql = path.read_text(encoding="utf-8")
        print(f"Applying {name} ...")
        cur.execute(sql)
        print(f"  OK")

    cur.execute(
        """
        SELECT extname, n.nspname
        FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE extname IN ('uuid-ossp','pg_trgm','vector')
        ORDER BY 1
        """
    )
    print("\nExtensions:")
    for row in cur.fetchall():
        print(f"  {row[0]} -> {row[1]}")

    cur.close()
    conn.close()
    print("\nAll migrations applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
