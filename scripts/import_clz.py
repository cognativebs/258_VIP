#!/usr/bin/env python3
"""One-command CLZ refresh: snapshot → parse → derive → load.

This is the only supported way to get a CLZ export into the platform. It runs
the whole path in the order AGENTS.md rule 3 requires:

  1. record the export bytes as an immutable raw snapshot (reused if unchanged)
  2. parse + score the records
  3. write the derived CSV / JSON artifacts
  4. upsert catalog + holdings in Postgres, each holding linked to the snapshot

Re-running with the same export is a no-op on the source of record and an
idempotent upsert on derived rows.

Usage:
  python scripts/import_clz.py --xml comic_2026-07-04_19-11-11-export.xml
  python scripts/import_clz.py --xml export.xml --derive-only
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from clz_comic_parser import parse_clz_xml  # noqa: E402

DEFAULT_DSN = os.environ.get(
    "IQVAULT_DATABASE_DSN", "dbname=iqvault user=postgres password=vault host=localhost"
)
DEFAULT_OUTDIR = os.path.join(ROOT, "iqvault_comics_parser_package", "ComicArchive_processed")

# Bump when the parser's scoring or field mapping changes, so snapshots record
# which version of the rules produced the derived rows.
INGEST_RULE_VERSION = "clz-python-ingest@0.2.0"
SNAPSHOT_SOURCE = "clz_xml"


def snapshot_label(xml_path: str, content_hash: str | None) -> str:
    """Human-readable identity of the import — the file, not today's date."""
    name = os.path.basename(xml_path)
    if content_hash:
        return f"CLZ export {name} · sha256 {content_hash[:12]}"
    return f"CLZ export {name}"


def run(cmd: list[str]) -> None:
    # Keep our own output interleaved correctly with the child processes'.
    sys.stdout.flush()
    print(f"\n$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"step failed: {' '.join(cmd)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xml", required=True, help="CLZ Comics XML export")
    ap.add_argument("--dsn", default=DEFAULT_DSN)
    ap.add_argument("--outdir", default=DEFAULT_OUTDIR)
    ap.add_argument(
        "--derive-only",
        action="store_true",
        help="Parse and write derived artifacts without touching Postgres.",
    )
    args = ap.parse_args()

    sys.stdout.reconfigure(line_buffering=True)

    xml_path = os.path.abspath(args.xml)
    if not os.path.isfile(xml_path):
        raise SystemExit(f"No such export: {xml_path}")

    record_count = len(parse_clz_xml(xml_path))
    print(f"Export: {xml_path}")
    print(f"Records in export: {record_count}")

    snapshot_id = None
    snapshot_hash = None
    if not args.derive_only:
        import psycopg2

        from raw_snapshots import record_file_snapshot

        conn = psycopg2.connect(args.dsn)
        conn.autocommit = False
        try:
            snapshot = record_file_snapshot(
                conn,
                path=xml_path,
                source=SNAPSHOT_SOURCE,
                rule_version=INGEST_RULE_VERSION,
                record_count=record_count,
            )
            conn.commit()
        finally:
            conn.close()

        snapshot_id = snapshot.id
        snapshot_hash = snapshot.content_hash
        state = "reused (identical export already on record)" if snapshot.reused else "recorded"
        print(f"Raw snapshot {state}: {snapshot.id}")
        print(f"  sha256 {snapshot.short_hash}… · {snapshot.byte_length:,} bytes")

    run([sys.executable, "clz_comic_parser.py", xml_path, "--outdir", args.outdir])

    sync_cmd = [sys.executable, os.path.join("scripts", "sync_comics_data.py")]
    sync_cmd += ["--snapshot-label", snapshot_label(xml_path, snapshot_hash)]
    if snapshot_id:
        sync_cmd += ["--snapshot-id", str(snapshot_id), "--snapshot-hash", str(snapshot_hash)]
    run(sync_cmd)

    if args.derive_only:
        print("\nDerive-only run: Postgres untouched.")
        return 0

    inventory_json = os.path.join(ROOT, "iqvault", "public", "comics", "inventory.json")
    run(
        [
            sys.executable,
            "load_comics.py",
            "--json",
            inventory_json,
            "--dsn",
            args.dsn,
            "--raw-snapshot-id",
            str(snapshot_id),
        ]
    )

    meta_path = os.path.join(ROOT, "iqvault", "public", "comics", "meta.json")
    with open(meta_path, encoding="utf-8") as handle:
        meta = json.load(handle)

    print("\nImport complete.")
    print(f"  snapshot        {snapshot_id}")
    print(f"  holdings        {meta['recordCount']}")
    print(f"  CLZ snapshot $  {meta['totalValue']:,.2f} (point prices, unverified)")
    print(f"  needs verify    {meta['needsVerification']}")
    print(f"  imported at     {datetime.now(timezone.utc).isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
