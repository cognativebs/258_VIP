"""SIGNALS thesis table (20261017_01) guards. Fixtures only, rolled back. No network.

IQVAULT_TEST_DSN="dbname=iqvault user=postgres password=vault host=localhost" pytest tests/test_signals_thesis.py
"""
from __future__ import annotations

import os

import pytest

DSN = os.environ.get("IQVAULT_TEST_DSN")

pytestmark = pytest.mark.skipif(
    not DSN, reason="IQVAULT_TEST_DSN not set — needs a scratch Postgres"
)

INSERT = """
    INSERT INTO vault_signals.thesis (
      created_by, claim, claim_key, domain, horizon_days, action, confidence, reasons,
      prov_source, prov_rule_version, prov_confidence {extra_cols}
    ) VALUES (
      'orchestr8:signals-brief', %s, %s, 'collectibles', 30, %s, 0.5, ARRAY['two outlets'],
      'orchestr8:signals-brief', 'signals-brief@0.1.0', 0.5 {extra_vals}
    ) RETURNING id, status, prov_method::text, prov_verification::text
"""


@pytest.fixture()
def conn():
    psycopg2 = pytest.importorskip("psycopg2")
    connection = psycopg2.connect(DSN)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


def _insert(cur, claim: str, action: str = "Watch", extra_cols: str = "", extra_vals: str = "", params: tuple = ()):
    cur.execute(INSERT.format(extra_cols=extra_cols, extra_vals=extra_vals), (claim, claim.lower(), action, *params))
    return cur.fetchone()


def test_thesis_defaults_to_draft_inferred_unverified(conn):
    cur = conn.cursor()
    _id, status, method, verification = _insert(cur, "Fixture set sells out within 30 days")
    assert (status, method, verification) == ("draft", "inferred", "unverified")


def test_one_open_thesis_per_claim_and_a_closed_one_frees_the_claim(conn):
    psycopg2 = pytest.importorskip("psycopg2")
    cur = conn.cursor()
    first, *_ = _insert(cur, "Fixture claim repeated")
    cur.execute("SAVEPOINT dup")
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _insert(cur, "Fixture claim repeated")
    cur.execute("ROLLBACK TO SAVEPOINT dup")
    cur.execute(
        """UPDATE vault_signals.thesis SET status = 'retired', status_changed_at = now(), status_changed_by = 'operator'
            WHERE id = %s""",
        (first,),
    )
    _insert(cur, "Fixture claim repeated")


def test_status_change_must_name_who_and_when(conn):
    psycopg2 = pytest.importorskip("psycopg2")
    cur = conn.cursor()
    thesis_id, *_ = _insert(cur, "Fixture status guard")
    with pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute("UPDATE vault_signals.thesis SET status = 'active' WHERE id = %s", (thesis_id,))


def test_action_vocabulary_and_evidence_link_guards(conn):
    psycopg2 = pytest.importorskip("psycopg2")
    cur = conn.cursor()
    cur.execute("SAVEPOINT bad_action")
    with pytest.raises(psycopg2.errors.CheckViolation):
        _insert(cur, "Fixture bad action", action="Strong Buy")
    cur.execute("ROLLBACK TO SAVEPOINT bad_action")
    thesis_id, *_ = _insert(cur, "Fixture link guard")
    with pytest.raises(psycopg2.errors.ForeignKeyViolation):
        cur.execute(
            """INSERT INTO vault_signals.thesis_signal (thesis_id, signal_id, linked_by)
               VALUES (%s, public.uuid_generate_v4(), 'orchestr8:run_fixture')""",
            (thesis_id,),
        )
