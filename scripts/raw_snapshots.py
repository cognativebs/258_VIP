"""Immutable raw-import snapshots (AGENTS.md rule 3).

Every import must land its source bytes in `vault_evidence.raw_snapshots` before
any derived row is written, so processed data is always regenerable and the
source of record can never be edited. The table blocks UPDATE and DELETE with
triggers; this module only ever SELECTs or INSERTs.

Snapshots are keyed by content hash, so re-importing the same export reuses the
existing snapshot instead of creating a second source of record for it.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

# The CLZ export is ~8 MB. Storing it inline keeps a snapshot regenerable from
# the database alone, with no dependency on a file that may move or be deleted.
INLINE_MAX_BYTES = 32 * 1024 * 1024


@dataclass(frozen=True)
class SnapshotRef:
    """A row in vault_evidence.raw_snapshots."""

    id: str
    source: str
    content_hash: str
    byte_length: int
    record_count: Optional[int]
    ingested_at: datetime
    reused: bool
    """True when an identical import was already on record."""

    @property
    def short_hash(self) -> str:
        return self.content_hash[:12]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _row_to_ref(row: tuple[Any, ...], *, reused: bool) -> SnapshotRef:
    return SnapshotRef(
        id=str(row[0]),
        source=row[1],
        content_hash=row[2],
        byte_length=int(row[3]),
        record_count=row[4],
        ingested_at=row[5],
        reused=reused,
    )


def find_snapshot_by_hash(conn, content_hash: str) -> Optional[SnapshotRef]:
    cur = conn.cursor()
    cur.execute(
        """SELECT id, source, content_hash, byte_length, record_count, ingested_at
             FROM vault_evidence.raw_snapshots
            WHERE content_hash = %s""",
        (content_hash,),
    )
    row = cur.fetchone()
    cur.close()
    return _row_to_ref(row, reused=True) if row else None


def record_file_snapshot(
    conn,
    *,
    path: str,
    source: str,
    rule_version: str,
    record_count: Optional[int] = None,
    content_type: str = "application/xml",
    inline_max_bytes: int = INLINE_MAX_BYTES,
) -> SnapshotRef:
    """Put an import file on record, or return the existing row for those bytes.

    The snapshot's own provenance is always `observed` / `verified`: we are
    asserting that we received exactly these bytes, not that their contents are
    true. Trust in the *values* is carried per-field on the derived rows.
    """
    with open(path, "rb") as handle:
        data = handle.read()

    content_hash = sha256_bytes(data)
    existing = find_snapshot_by_hash(conn, content_hash)
    if existing:
        return existing

    payload = data.decode("utf-8", errors="replace") if len(data) <= inline_max_bytes else None
    storage_ref = os.path.abspath(path)

    cur = conn.cursor()
    cur.execute(
        """INSERT INTO vault_evidence.raw_snapshots
               (source, content_hash, content_type, payload, storage_ref,
                byte_length, record_count,
                prov_source, prov_method, prov_rule_version,
                prov_confidence, prov_verification)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'observed',%s,1.000,'verified')
        RETURNING id, source, content_hash, byte_length, record_count, ingested_at""",
        (
            source,
            content_hash,
            content_type,
            payload,
            storage_ref,
            len(data),
            record_count,
            os.path.basename(path),
            rule_version,
        ),
    )
    row = cur.fetchone()
    cur.close()
    return _row_to_ref(row, reused=False)


def read_snapshot_payload(conn, snapshot_id: str) -> Optional[str]:
    """Source bytes for a snapshot, for regenerating derived data."""
    cur = conn.cursor()
    cur.execute(
        "SELECT payload FROM vault_evidence.raw_snapshots WHERE id = %s",
        (snapshot_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def latest_snapshot(conn, source: str) -> Optional[SnapshotRef]:
    cur = conn.cursor()
    cur.execute(
        """SELECT id, source, content_hash, byte_length, record_count, ingested_at
             FROM vault_evidence.raw_snapshots
            WHERE source = %s
         ORDER BY ingested_at DESC
            LIMIT 1""",
        (source,),
    )
    row = cur.fetchone()
    cur.close()
    return _row_to_ref(row, reused=True) if row else None
