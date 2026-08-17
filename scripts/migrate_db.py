#!/usr/bin/env python3
"""Apply every SQL file in infra/db/migrations, oldest first.

Catalog spine (20260701–20260708) and later trust-layer files live in one
folder. Duplicate-object errors are treated as already-applied so a second
run on an existing database still applies newer files.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "infra" / "db" / "migrations"


def migration_paths() -> list[Path]:
    return sorted(
        p for p in MIGRATIONS_DIR.glob("*.sql") if not p.name.startswith("_")
    )


def reset_transaction(cur) -> None:
    """Clear an aborted transaction left by a failed migration.

    Migration files open their own `BEGIN`, which psycopg2 does not track under
    autocommit — so `conn.rollback()` is a no-op and every later file dies with
    "current transaction is aborted". Roll back server-side instead.
    """
    try:
        cur.execute("ROLLBACK")
    except Exception:  # noqa: BLE001 - nothing to roll back is fine
        pass


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

    from psycopg2 import errors as pg_errors

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = True
    cur = conn.cursor()

    # A database migrated by an earlier run already owns the enums and tables
    # the spine creates. Aborting on the first "already exists" left the later
    # dated migrations unapplied, which then failed at runtime instead.
    already_applied = (
        pg_errors.DuplicateObject,
        pg_errors.DuplicateTable,
        pg_errors.DuplicateColumn,
        pg_errors.DuplicateSchema,
        pg_errors.DuplicateFunction,
    )
    failures: list[tuple[str, str]] = []

    paths = migration_paths()
    if not paths:
        print(f"No migrations in {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    for path in paths:
        if not path.exists():
            print(f"Missing: {path}", file=sys.stderr)
            return 1
        sql = path.read_text(encoding="utf-8")
        print(f"Applying {path.name} ...")
        try:
            cur.execute(sql)
            print("  OK")
        except already_applied as exc:
            reset_transaction(cur)
            print(f"  already applied ({str(exc).strip().splitlines()[0]})")
        except Exception as exc:  # noqa: BLE001 - report every failure, not just the first
            reset_transaction(cur)
            message = str(exc).strip().splitlines()[0]
            print(f"  FAILED: {message}", file=sys.stderr)
            failures.append((path.name, message))

    if failures:
        print("\nMigrations that failed:", file=sys.stderr)
        for name, message in failures:
            print(f"  {name}: {message}", file=sys.stderr)
        cur.close()
        conn.close()
        return 1

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
