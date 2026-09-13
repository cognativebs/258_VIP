"""PC-CORE-01 Phase A on live VIP schema (ADR 0011).

Set IQVAULT_TEST_DSN after `python scripts/migrate_db.py`.
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


@pytest.fixture()
def conn():
    psycopg2 = pytest.importorskip("psycopg2")
    connection = psycopg2.connect(DSN)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


def test_pricecharting_source_is_vendor_derived_and_not_redistributable(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT source_key, default_evidence_class, redistribution_allowed
          FROM vault_market.data_source
         WHERE source_key = 'pricecharting'
        """
    )
    row = cur.fetchone()
    assert row == ("pricecharting", "vendor_derived", False)
    cur.execute(
        """
        SELECT is_factual, confidence_ceiling
          FROM vault_core.evidence_class
         WHERE evidence_class = 'vendor_derived'
        """
    )
    factual, ceiling = cur.fetchone()
    assert factual is False
    assert float(ceiling) == 0.75


def test_confirmed_vendor_map_allows_last_seen_only(conn):
    psycopg2 = pytest.importorskip("psycopg2")
    cur = conn.cursor()
    cur.execute("SELECT data_source_id FROM vault_market.data_source WHERE source_key = 'pricecharting'")
    (source_id,) = cur.fetchone()
    cur.execute(
        """
        INSERT INTO vault_market.vendor_product_map (
            data_source_id, vendor_product_id, vendor_product_name,
            match_method, match_confidence, needs_review,
            confirmed_at, confirmed_by,
            prov_source, prov_rule_version, prov_confidence
        ) VALUES (
            %s, 'pc-test-confirmed', 'Test Book #1',
            'manual', 1.00, false,
            now(), 'test',
            'pricecharting', 'vendor-product-map@0.1.0', 0.900
        )
        RETURNING id, last_seen_at
        """,
        (source_id,),
    )
    map_id, last_seen = cur.fetchone()
    cur.execute(
        """
        UPDATE vault_market.vendor_product_map
           SET last_seen_at = now()
         WHERE id = %s
        RETURNING last_seen_at
        """,
        (map_id,),
    )
    (updated_seen,) = cur.fetchone()
    assert updated_seen >= last_seen
    with pytest.raises(psycopg2.errors.RaiseException):
        cur.execute(
            """
            UPDATE vault_market.vendor_product_map
               SET match_method = 'trgm'
             WHERE id = %s
            """,
            (map_id,),
        )
    conn.rollback()
