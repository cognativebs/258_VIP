"""Rule 3 gate: immutable imports, and derived data regenerable from them.

These are the guarantees the unused TypeScript `packages/ingest` round-trip test
used to assert against an in-memory store. ADR 0006 moved ingest to Python, so
they now run against a real Postgres with the real triggers.

Set IQVAULT_TEST_DSN to a scratch database to run them:

    IQVAULT_TEST_DSN="dbname=iqvault user=postgres password=vault host=localhost" pytest
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

DSN = os.environ.get("IQVAULT_TEST_DSN")

pytestmark = pytest.mark.skipif(
    not DSN, reason="IQVAULT_TEST_DSN not set — needs a scratch Postgres"
)

EXPORT_XML = os.path.join(REPO_ROOT, "comic_2026-07-04_19-11-11-export.xml")


@pytest.fixture()
def conn():
    psycopg2 = pytest.importorskip("psycopg2")
    connection = psycopg2.connect(DSN)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


def _snapshot_table_exists(connection) -> bool:
    cur = connection.cursor()
    cur.execute(
        """SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'vault_evidence' AND table_name = 'raw_snapshots'"""
    )
    found = cur.fetchone() is not None
    cur.close()
    return found


def test_snapshot_schema_is_applied(conn):
    assert _snapshot_table_exists(conn), (
        "vault_evidence.raw_snapshots missing — apply "
        "infra/db/migrations/20260720_01_raw_snapshots.sql"
    )


def test_identical_export_is_recorded_once(conn, tmp_path):
    from raw_snapshots import record_file_snapshot

    export = tmp_path / "tiny-export.xml"
    export.write_text("<comiclist><comic><issuenr>1</issuenr></comic></comiclist>", "utf-8")

    first = record_file_snapshot(
        conn, path=str(export), source="clz_xml_test", rule_version="test@0", record_count=1
    )
    second = record_file_snapshot(
        conn, path=str(export), source="clz_xml_test", rule_version="test@0", record_count=1
    )

    assert first.reused is False
    assert second.reused is True
    assert second.id == first.id
    assert len(first.content_hash) == 64


def test_snapshots_cannot_be_updated_or_deleted(conn, tmp_path):
    import psycopg2

    from raw_snapshots import record_file_snapshot

    export = tmp_path / "immutable.xml"
    export.write_text("<comiclist><comic><issuenr>7</issuenr></comic></comiclist>", "utf-8")
    snapshot = record_file_snapshot(
        conn, path=str(export), source="clz_xml_test", rule_version="test@0", record_count=1
    )

    # Savepoints so the failed statements do not roll back the insert itself —
    # a DELETE that matches no row would never reach the trigger.
    for statement in (
        "UPDATE vault_evidence.raw_snapshots SET record_count = 0 WHERE id = %s",
        "DELETE FROM vault_evidence.raw_snapshots WHERE id = %s",
    ):
        cur = conn.cursor()
        cur.execute("SAVEPOINT mutation_attempt")
        with pytest.raises(psycopg2.errors.RaiseException, match="immutable"):
            cur.execute(statement, (snapshot.id,))
        cur.execute("ROLLBACK TO SAVEPOINT mutation_attempt")
        cur.close()

    cur = conn.cursor()
    cur.execute(
        "SELECT record_count FROM vault_evidence.raw_snapshots WHERE id = %s", (snapshot.id,)
    )
    assert cur.fetchone()[0] == 1, "snapshot survived both mutation attempts unchanged"
    cur.close()


def test_snapshot_payload_round_trips_to_identical_derived_rows(conn, tmp_path):
    """Delete derived data, regenerate from the snapshot payload, get the same rows."""
    from clz_comic_parser import parse_clz_xml
    from raw_snapshots import read_snapshot_payload, record_file_snapshot

    with open(EXPORT_XML, encoding="utf-8") as handle:
        original_xml = handle.read()

    export = tmp_path / "round-trip.xml"
    export.write_text(original_xml, "utf-8")
    from_disk = parse_clz_xml(str(export))

    snapshot = record_file_snapshot(
        conn,
        path=str(export),
        source="clz_xml_test",
        rule_version="test@0",
        record_count=len(from_disk),
    )

    # Derived artifacts are disposable; the snapshot is not.
    export.unlink()
    assert not export.exists()

    payload = read_snapshot_payload(conn, snapshot.id)
    assert payload, "snapshot must retain its payload to be regenerable"

    regenerated_path = tmp_path / "regenerated.xml"
    regenerated_path.write_text(payload, "utf-8")
    from_snapshot = parse_clz_xml(str(regenerated_path))

    assert from_snapshot == from_disk


def test_holdings_are_attributable_to_a_snapshot(conn):
    """Every loaded holding must point at the import it came from."""
    if not _snapshot_table_exists(conn):
        pytest.skip("snapshot migration not applied")

    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM vault_collection.holding WHERE source = 'clz_import'")
    total = cur.fetchone()[0]
    if total == 0:
        pytest.skip("no CLZ holdings loaded in this database")

    cur.execute(
        """SELECT count(*) FROM vault_collection.holding
            WHERE source = 'clz_import' AND raw_snapshot_id IS NULL"""
    )
    orphaned = cur.fetchone()[0]
    cur.close()

    assert orphaned == 0, f"{orphaned} of {total} CLZ holdings have no source snapshot"
