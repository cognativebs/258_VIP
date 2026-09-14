"""Daily guide snapshot table (20260914_01)."""
from __future__ import annotations

import os

import pytest

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


def test_guide_price_observation_is_one_row_per_holding_day(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'vault_market'
           AND table_name = 'guide_price_observation'
        """
    )
    assert cur.fetchone() is not None
    cur.execute(
        """
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'guide_price_observation_unique_day'
        """
    )
    assert cur.fetchone() is not None
