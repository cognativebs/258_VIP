#!/usr/bin/env python3
"""CLZ inbox sync — drop XML exports, IQVault archives + reloads holdings.

Env:
  CLZ_INBOX_DIR      default E:\\ComicArchive\\inbox or <repo>/clz-inbox
  CLZ_ARCHIVE_DIR    default E:\\ComicArchive or <repo>/clz-inbox/archive
  IQVAULT_DATABASE_DSN / DATABASE_URL
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from clz_delta import ClzDelta  # noqa: E402
from sync_comics_data import normalize  # noqa: E402

DEFAULT_DSN = "dbname=iqvault user=postgres password=vault host=localhost"
PAYLOAD_INLINE_MAX = 512 * 1024
MAX_INBOX_BYTES = 40 * 1024 * 1024
ADAPTER_VERSION = "clz-adapter@0.1.0"
CLZ_CLOUD_URL_DEFAULT = "https://cloud.clz.com/"
CLZ_COLLECTOR_URL_DEFAULT = "https://www.clz.com/comic-collector/"


def default_inbox() -> Path:
    override = os.environ.get("CLZ_INBOX_DIR")
    if override:
        return Path(override)
    e = Path("E:/ComicArchive/inbox")
    if Path("E:/").exists():
        return e
    return ROOT / "clz-inbox"


def default_archive() -> Path:
    override = os.environ.get("CLZ_ARCHIVE_DIR")
    if override:
        return Path(override)
    e = Path("E:/ComicArchive")
    if Path("E:/").exists():
        return e
    return ROOT / "clz-inbox" / "archive"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dsn() -> str:
    return os.environ.get("IQVAULT_DATABASE_DSN") or os.environ.get("DATABASE_URL") or DEFAULT_DSN


def ensure_dirs(inbox: Path, archive: Path) -> Path:
    inbox.mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    processed = inbox / "processed"
    processed.mkdir(parents=True, exist_ok=True)
    return processed


def sanitize_inbox_filename(name: str) -> str:
    raw = (name or "clz-export.xml").replace("\\", "/")
    base = Path(raw).name
    base = re.sub(r"[^\w.\- ()]+", "_", base).strip()
    if not base or base.startswith("."):
        raise ValueError("Invalid filename")
    if not base.lower().endswith(".xml"):
        raise ValueError("Only .xml CLZ exports are accepted")
    return base[:180]


def save_inbox_export(
    filename: str,
    data: bytes,
    inbox: Path | None = None,
) -> Path:
    """Write a dropped CLZ XML into the inbox folder (same path the job watches)."""
    if not data:
        raise ValueError("Empty file")
    if len(data) > MAX_INBOX_BYTES:
        raise ValueError(f"File too large (max {MAX_INBOX_BYTES} bytes)")
    head = data.lstrip()[:400].lower()
    if b"<?xml" not in head and b"<datafile" not in head and b"<comic" not in head:
        raise ValueError("Not a CLZ XML export")
    inbox_dir = inbox or default_inbox()
    inbox_dir.mkdir(parents=True, exist_ok=True)
    safe = sanitize_inbox_filename(filename)
    dest = inbox_dir / safe
    if dest.exists():
        stamp = datetime.now().strftime("%H%M%S")
        dest = inbox_dir / f"{dest.stem}_{stamp}{dest.suffix}"
    dest.write_bytes(data)
    return dest


def accept_inbox_drop(
    filename: str,
    data: bytes,
    inbox: Path | None = None,
) -> dict[str, Any]:
    """Save a browser-dropped XML into the inbox the job already watches."""
    dest = save_inbox_export(filename, data, inbox=inbox)
    return {
        "ok": True,
        "savedAs": dest.name,
        "path": str(dest),
        "inbox": str(dest.parent),
        "bytes": dest.stat().st_size,
        "syncStarted": True,
    }


def inbox_status() -> dict[str, Any]:
    inbox = default_inbox()
    archive = default_archive()
    pending = list_inbox_xml(inbox)
    return {
        "ok": True,
        "inbox": str(inbox),
        "archive": str(archive),
        "exists": inbox.is_dir(),
        "pendingCount": len(pending),
        "pendingFiles": [p.name for p in pending],
        "clzCloudUrl": os.environ.get("CLZ_CLOUD_URL", CLZ_CLOUD_URL_DEFAULT),
        "clzCollectorUrl": os.environ.get("CLZ_COLLECTOR_URL", CLZ_COLLECTOR_URL_DEFAULT),
    }


class HashStore:
    """Postgres raw_snapshots when available; JSON file fallback for --offline tests."""

    def has(self, content_hash: str) -> bool:
        raise NotImplementedError

    def add(self, content_hash: str, **meta: Any) -> None:
        raise NotImplementedError


class MemoryHashStore(HashStore):
    def __init__(self) -> None:
        self.hashes: set[str] = set()

    def has(self, content_hash: str) -> bool:
        return content_hash in self.hashes

    def add(self, content_hash: str, **meta: Any) -> None:
        self.hashes.add(content_hash)


class FileHashStore(HashStore):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.hashes: set[str] = set()
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            self.hashes = set(data.get("hashes") or [])

    def has(self, content_hash: str) -> bool:
        return content_hash in self.hashes

    def add(self, content_hash: str, **meta: Any) -> None:
        self.hashes.add(content_hash)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"hashes": sorted(self.hashes)}, indent=2),
            encoding="utf-8",
        )


class PostgresHashStore(HashStore):
    def __init__(self, conn) -> None:
        self.conn = conn

    def has(self, content_hash: str) -> bool:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT 1 FROM vault_evidence.raw_snapshots WHERE content_hash = %s",
            (content_hash,),
        )
        found = cur.fetchone() is not None
        cur.close()
        return found

    def add(self, content_hash: str, **meta: Any) -> None:
        payload = meta.get("payload")
        storage_ref = meta.get("storage_ref")
        byte_length = int(meta.get("byte_length") or 0)
        record_count = meta.get("record_count")
        cur = self.conn.cursor()
        cur.execute(
            """
            INSERT INTO vault_evidence.raw_snapshots
                (source, content_hash, content_type, payload, storage_ref,
                 byte_length, record_count, prov_source, prov_rule_version)
            VALUES
                ('clz_xml', %s, 'application/xml', %s, %s,
                 %s, %s, 'clz_import', %s)
            ON CONFLICT (content_hash) DO NOTHING
            """,
            (
                content_hash,
                payload,
                storage_ref,
                byte_length,
                record_count,
                ADAPTER_VERSION,
            ),
        )
        self.conn.commit()
        cur.close()


def archive_copy(src: Path, archive: Path, content_hash: str, when: date | None = None) -> Path:
    day = (when or date.today()).isoformat()
    dest = archive / f"{day}_{content_hash[:8]}.xml"
    if dest.exists():
        return dest
    shutil.copy2(src, dest)
    return dest


def parse_export_to_rows(xml_path: Path) -> list[dict]:
    from clz_comic_parser import parse_clz_xml  # repo-root module

    raw_rows = parse_clz_xml(str(xml_path))
    return [normalize(r) for r in raw_rows]


def ensure_postgres_schema(conn) -> None:
    """Idempotent: dropped_at column + raw_snapshots table."""
    cur = conn.cursor()
    cur.execute(
        """
        ALTER TABLE vault_collection.holding
            ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ
        """
    )
    conn.commit()
    snap_sql = ROOT / "infra" / "db" / "migrations" / "20260720_01_raw_snapshots.sql"
    if snap_sql.is_file():
        prev = conn.autocommit
        conn.autocommit = True
        try:
            cur.execute(snap_sql.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"raw_snapshots migration note: {exc}", file=sys.stderr)
        conn.autocommit = prev
    cur.close()


def process_file(
    xml_path: Path,
    *,
    inbox: Path,
    archive: Path,
    processed: Path,
    store: HashStore,
    load: bool,
    conn=None,
) -> dict[str, Any]:
    data = xml_path.read_bytes()
    content_hash = sha256_bytes(data)
    result: dict[str, Any] = {
        "file": str(xml_path),
        "contentHash": content_hash,
        "skipped": False,
        "already_current": False,
    }

    if store.has(content_hash):
        dest = processed / xml_path.name
        if xml_path.resolve() != dest.resolve() and xml_path.exists():
            shutil.move(str(xml_path), str(dest))
        result["skipped"] = True
        result["already_current"] = True
        result["reason"] = "duplicate_hash"
        result["delta"] = ClzDelta(skipped_duplicate_hash=True, already_current=True).as_dict()
        return result

    archived = archive_copy(xml_path, archive, content_hash)
    result["archive"] = str(archived)
    result["recordCount"] = data.decode("utf-8", errors="replace").count("<comic>")

    payload = None
    if len(data) <= PAYLOAD_INLINE_MAX:
        payload = data.decode("utf-8", errors="replace")

    if load and conn is not None:
        from load_comics import load_inventory

        rows = parse_export_to_rows(xml_path)
        result["recordCount"] = len(rows)
        loaded = load_inventory(conn, rows)
        result["stats"] = loaded["stats"]
        result["delta"] = loaded["delta"]
    else:
        result["delta"] = ClzDelta().as_dict()

    store.add(
        content_hash,
        payload=payload,
        storage_ref=str(archived),
        byte_length=len(data),
        record_count=result.get("recordCount"),
    )

    dest = processed / xml_path.name
    if xml_path.exists() and xml_path.resolve() != dest.resolve():
        shutil.move(str(xml_path), str(dest))
    result["processed"] = str(dest)
    return result


def list_inbox_xml(inbox: Path) -> list[Path]:
    if not inbox.is_dir():
        return []
    return sorted(p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() == ".xml")


def run_sync(
    *,
    inbox: Path | None = None,
    archive: Path | None = None,
    store: HashStore | None = None,
    load: bool = True,
    conn=None,
) -> dict[str, Any]:
    inbox = inbox or default_inbox()
    archive = archive or default_archive()
    processed = ensure_dirs(inbox, archive)
    files = list_inbox_xml(inbox)
    summary: dict[str, Any] = {
        "job": "clz-sync",
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "inbox": str(inbox),
        "archive": str(archive),
        "empty": len(files) == 0,
        "files": [],
    }
    if not files:
        summary["reason"] = "empty_inbox"
        print(f"CLZ inbox empty: {inbox}", file=sys.stderr)
        return summary

    own_conn = False
    if load and conn is None and store is None:
        import psycopg2

        conn = psycopg2.connect(dsn())
        conn.autocommit = False
        own_conn = True
        ensure_postgres_schema(conn)
        store = PostgresHashStore(conn)

    if store is None:
        store = FileHashStore(archive / ".hashes.json")

    try:
        for xml_path in files:
            print(f"Processing {xml_path.name} ...", file=sys.stderr)
            item = process_file(
                xml_path,
                inbox=inbox,
                archive=archive,
                processed=processed,
                store=store,
                load=load and conn is not None,
                conn=conn,
            )
            summary["files"].append(item)
            if item.get("skipped"):
                print(f"  already current (hash {item['contentHash'][:12]}...)", file=sys.stderr)
            elif item.get("stats"):
                delta = item.get("delta") or {}
                print(
                    f"  archived + loaded  added={len(delta.get('added') or [])} "
                    f"dropped={len(delta.get('dropped') or [])} "
                    f"price_changed={len(delta.get('price_changed') or [])}",
                    file=sys.stderr,
                )
            else:
                print(f"  archived hash={item.get('contentHash', '')[:12]}...", file=sys.stderr)
    finally:
        if own_conn and conn is not None:
            conn.close()

    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest CLZ XML dropped into the inbox folder")
    ap.add_argument("--inbox", type=Path, default=None)
    ap.add_argument("--archive", type=Path, default=None)
    ap.add_argument("--offline", action="store_true", help="Hash/archive only; no Postgres")
    ap.add_argument("--hash-file", type=Path, default=None)
    args = ap.parse_args()

    store: HashStore | None = None
    load = not args.offline
    if args.offline:
        archive = args.archive or default_archive()
        store = FileHashStore(args.hash_file or archive / ".hashes.json")
        load = False

    summary = run_sync(
        inbox=args.inbox,
        archive=args.archive,
        store=store,
        load=load,
    )
    print(json.dumps(summary, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
