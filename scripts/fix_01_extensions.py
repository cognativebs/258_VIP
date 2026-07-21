#!/usr/bin/env python3
"""Apply fix_01_extensions.sql (Option B) to an existing IQVault database."""
from __future__ import annotations

import argparse
import sys

STATEMENTS = [
    'ALTER EXTENSION "uuid-ossp" SET SCHEMA public;',
    "ALTER EXTENSION pg_trgm SET SCHEMA public;",
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Relocate uuid-ossp and pg_trgm to public schema")
    ap.add_argument(
        "--dsn",
        default="dbname=iqvault user=postgres host=localhost",
        help='psycopg2 DSN (default: "dbname=iqvault user=postgres host=localhost")',
    )
    args = ap.parse_args()

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
        return 1

    try:
        conn = psycopg2.connect(args.dsn)
    except Exception as e:
        print(f"Connection failed: {e}", file=sys.stderr)
        return 1

    cur = conn.cursor()
    for sql in STATEMENTS:
        print(f"Running: {sql}")
        try:
            cur.execute(sql)
            conn.commit()
            print("  OK")
        except Exception as e:
            conn.rollback()
            print(f"  SKIP or ERROR: {e}")

    cur.execute(
        """
        SELECT extname, n.nspname AS schema
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE extname IN ('uuid-ossp', 'pg_trgm', 'vector')
        ORDER BY extname
        """
    )
    print("\nExtension locations:")
    for name, schema in cur.fetchall():
        print(f"  {name}: {schema}")

    cur.execute("SELECT uuid_generate_v4()")
    print(f"\nuuid_generate_v4() smoke test: {cur.fetchone()[0]}")
    cur.execute("SELECT similarity('amazing spidermann', 'amazing spiderman')")
    print(f"pg_trgm similarity smoke test: {cur.fetchone()[0]:.3f}")

    cur.close()
    conn.close()
    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
