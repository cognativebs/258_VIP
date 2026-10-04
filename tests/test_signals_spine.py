"""SIGNALS v1 spine acceptance tests. Fixtures only. No network.

IQVAULT_TEST_DSN="dbname=iqvault user=postgres password=vault host=localhost" pytest tests/test_signals_spine.py
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

DSN = os.environ.get("IQVAULT_TEST_DSN")

pytestmark = pytest.mark.skipif(
    not DSN, reason="IQVAULT_TEST_DSN not set — needs a scratch Postgres"
)

NEWSLETTER_URL = (
    "https://example.com/brief/2026-09-20"
    "?utm_source=newsletter&utm_medium=email&recipient=reader@example.com&id=42"
)
RULE = "signals-spine@0.1.0"


@pytest.fixture()
def conn():
    psycopg2 = pytest.importorskip("psycopg2")
    connection = psycopg2.connect(DSN)
    connection.autocommit = False
    yield connection
    connection.rollback()
    connection.close()


def _require_spine(cur) -> None:
    cur.execute(
        """
        SELECT to_regclass('vault_signals.raw_document'),
               to_regclass('vault_signals.signal'),
               to_regclass('vault_signals.prediction')
        """
    )
    row = cur.fetchone()
    assert all(row), (
        "vault_signals spine is missing — apply infra/db/migrations/"
        "20260920_10 through 20260920_14"
    )


def _insert_run(cur, source_key: str) -> str:
    run_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO vault_signals.ingest_run (id, source_id, status)
        VALUES (%s, %s, 'succeeded')
        """,
        (run_id, source_key),
    )
    return run_id


def _insert_document(cur, run_id: str, source_key: str, url: str, content_hash: str) -> str:
    doc_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO vault_signals.raw_document (
          id, source_id, source_url, content_hash, raw_payload_ref, ingest_run_id
        ) VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (doc_id, source_key, url, content_hash, f"object://signals/fixtures/{content_hash}", run_id),
    )
    return doc_id


def test_spine_schema_guards(conn):
    cur = conn.cursor()
    _require_spine(cur)

    cur.execute(
        """
        SELECT count(*) FILTER (WHERE adapter_enabled),
               count(*) FILTER (WHERE is_active),
               count(*) FILTER (WHERE may_raise_valuation_ceiling),
               count(*)
          FROM vault_core.signals_news_source
        """
    )
    enabled, active, ceiling, total = cur.fetchone()
    # Every seeded source ships disabled (HS-5). 14 from 20260920_06, plus pokebeach_rss, psa_news,
    # tag_news, alpha_investments_youtube (20261001_03) and pokebeach_official,
    # pokebeach_frontpage_feed, pokebeach_members (20261003_01).
    assert (enabled, active, ceiling, total) == (0, 0, 0, 21)

    cur.execute(
        """
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'vault_signals'
           AND (
             position('priced_unit' in column_name) > 0
             OR column_name = 'condition_key'
             OR udt_name = 'vector'
           )
        """
    )
    assert cur.fetchall() == []

    cur.execute(
        """
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'vault_signals'
           AND table_name = 'signal'
           AND column_name = ANY (%s)
        """,
        (["relevance", "novelty", "magnitude", "actionability", "source_quality"],),
    )
    assert cur.fetchall() == []

    cur.execute(
        """
        SELECT count(*)
          FROM information_schema.columns
         WHERE table_schema = 'vault_signals'
           AND table_name = 'signal'
           AND column_name = 'priority_score'
        """
    )
    assert cur.fetchone()[0] == 0, "priority is read-time (G-5 option C); no stored column"

    cur.execute(
        """
        SELECT bool_and(NOT half_life_verified), count(*)
          FROM vault_signals.signal_type
        """
    )
    all_unverified, type_count = cur.fetchone()
    # 9 from 20260920_12, + 6 sports (20261001_01), + 2 collectibles (20261001_03), + 5 macro (20261001_04).
    assert type_count == 22
    assert all_unverified is True

    cur.execute(
        """
        SELECT name, version, verified, weights_json->>'formula'
          FROM vault_signals.score_weight_set
         WHERE is_current
        """
    )
    current = cur.fetchall()
    assert len(current) == 1
    name, version, verified, formula = current[0]
    assert (name, version) == ("spine-v0-product", "0.1.0")
    assert verified is False
    assert formula == "weighted_product_v1"

    cur.execute(
        "SELECT pg_get_functiondef('vault_signals.signal_influence(uuid, timestamptz)'::regprocedure)"
    )
    influence = cur.fetchone()[0]
    assert "attention_observation" not in influence
    assert "priced_unit" not in influence
    assert "v_guide_price_baseline" not in influence
    assert "default_half_life_hours" in influence
    assert "signal_priority" in influence

    cur.execute(
        "SELECT pg_get_functiondef('vault_signals.signal_priority(uuid, uuid)'::regprocedure)"
    )
    priority_fn = cur.fetchone()[0]
    assert "is_current" in priority_fn
    assert "attention_observation" not in priority_fn

    cur.execute(
        """
        SELECT col_description(attrelid, attnum)
          FROM pg_attribute
         WHERE attrelid = 'vault_signals.raw_document'::regclass
           AND attname = 'id'
           AND NOT attisdropped
        """
    )
    assert "G-1" in cur.fetchone()[0]
    cur.close()


def test_lineage_decay_firewall_and_prediction_clock(conn):
    import psycopg2

    cur = conn.cursor()
    _require_spine(cur)

    press_run = _insert_run(cur, "comicsbeat_rss")
    press_id = _insert_document(
        cur, press_run, "comicsbeat_rss", "https://example.com/press/license-2026", "hash-press"
    )
    derivatives = []
    for source, digest in (
        ("polygon_rss", "hash-d1"),
        ("exec_sum", "hash-d2"),
        ("gdelt_doc_v2", "hash-d3"),
        ("sherwood_news", "hash-d4"),
    ):
        run_id = _insert_run(cur, source)
        derivatives.append(
            _insert_document(cur, run_id, source, f"https://example.com/echo/{digest}", digest)
        )

    cur.execute("SAVEPOINT duplicate_document")
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _insert_document(
            cur,
            press_run,
            "comicsbeat_rss",
            "https://example.com/press/license-2026?utm_source=copy",
            "hash-press",
        )
    cur.execute("ROLLBACK TO SAVEPOINT duplicate_document")

    letter_run = _insert_run(cur, "stratechery")
    letter_id = _insert_document(cur, letter_run, "stratechery", NEWSLETTER_URL, "hash-letter")
    cur.execute(
        "SELECT source_url, url_canonical FROM vault_signals.raw_document WHERE id = %s",
        (letter_id,),
    )
    source_url, canonical = cur.fetchone()
    assert "reader@example.com" not in source_url
    assert "reader@example.com" not in canonical
    assert "utm_" not in canonical
    assert canonical == "https://example.com/brief/2026-09-20?id=42"

    cur.execute(
        """
        INSERT INTO vault_signals.document_snapshot (
          raw_document_id, storage_backend, storage_key, byte_size, media_type
        ) VALUES (%s, 'fixture', %s, 12, 'text/plain')
        RETURNING id
        """,
        (press_id, "object://signals/fixtures/hash-press"),
    )
    snapshot_id = cur.fetchone()[0]
    for statement in (
        "UPDATE vault_signals.document_snapshot SET byte_size = 0 WHERE id = %s",
        "DELETE FROM vault_signals.document_snapshot WHERE id = %s",
    ):
        cur.execute("SAVEPOINT snapshot_mutation")
        with pytest.raises(psycopg2.Error, match="immutable"):
            cur.execute(statement, (snapshot_id,))
        cur.execute("ROLLBACK TO SAVEPOINT snapshot_mutation")

    press_event = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO vault_signals.event (
          id, event_key, title, event_type, primary_origin_document_id,
          prov_source, prov_rule_version, prov_confidence, prov_notes
        ) VALUES (
          %s, 'evt-press', 'License announcement', 'license', %s,
          'fixture', %s, 0.400, 'inferred · unverified grouping'
        )
        """,
        (press_event, press_id, RULE),
    )
    cur.execute(
        """
        INSERT INTO vault_signals.event_evidence (
          event_id, raw_document_id, role, independence_group
        ) VALUES (%s, %s, 'PRIMARY', 'press-1')
        """,
        (press_event, press_id),
    )
    for doc_id in derivatives:
        cur.execute(
            """
            INSERT INTO vault_signals.event_evidence (
              event_id, raw_document_id, role, independence_group
            ) VALUES (%s, %s, 'DERIVATIVE', 'press-1')
            """,
            (press_event, doc_id),
        )
    cur.execute("SELECT vault_signals.independent_source_count(%s)", (press_event,))
    assert cur.fetchone()[0] == 1

    two_event = str(uuid.uuid4())
    ind_docs = []
    for source, digest, group in (
        ("sec_edgar_fts", "hash-a", "ind-a"),
        ("fred", "hash-b", "ind-b"),
    ):
        run_id = _insert_run(cur, source)
        ind_docs.append(
            (
                group,
                _insert_document(cur, run_id, source, f"https://example.com/{digest}", digest),
            )
        )
    deriv_docs = []
    for source, digest in (
        ("daily_upside", "hash-da"),
        ("the_ai_report", "hash-db"),
        ("milk_road", "hash-dc"),
    ):
        run_id = _insert_run(cur, source)
        deriv_docs.append(
            _insert_document(cur, run_id, source, f"https://example.com/{digest}", digest)
        )
    cur.execute(
        """
        INSERT INTO vault_signals.event (
          id, event_key, title, event_type,
          prov_source, prov_rule_version, prov_confidence
        ) VALUES (%s, 'evt-two', 'Two reports', 'filing', 'fixture', %s, 0.400)
        """,
        (two_event, RULE),
    )
    for group, doc_id in ind_docs:
        cur.execute(
            """
            INSERT INTO vault_signals.event_evidence (
              event_id, raw_document_id, role, independence_group
            ) VALUES (%s, %s, 'PRIMARY', %s)
            """,
            (two_event, doc_id, group),
        )
    for doc_id in deriv_docs:
        cur.execute(
            """
            INSERT INTO vault_signals.event_evidence (
              event_id, raw_document_id, role, independence_group
            ) VALUES (%s, %s, 'DERIVATIVE', 'ind-a')
            """,
            (two_event, doc_id),
        )
    cur.execute("SELECT vault_signals.independent_source_count(%s)", (two_event,))
    assert cur.fetchone()[0] == 2

    cur.execute(
        """
        INSERT INTO vault_signals.origin_link (
          from_document_id, to_document_id, relation, detected_by, confidence, prov_rule_version
        ) VALUES (%s, %s, 'SYNDICATES', 'fixture', 0.500, %s)
        """,
        (derivatives[0], press_id, RULE),
    )

    seen = datetime(2026, 9, 1, tzinfo=timezone.utc)
    cur.execute("SELECT id FROM vault_signals.signal_type WHERE code = 'PLAYER_INJURY'")
    injury_type = cur.fetchone()[0]
    cur.execute("SELECT id FROM vault_signals.signal_type WHERE code = 'LICENSE_CHANGE'")
    license_type = cur.fetchone()[0]
    cur.execute(
        """
        SELECT id FROM vault_signals.score_weight_set WHERE is_current
        """
    )
    weight_id = cur.fetchone()[0]

    def insert_signal(type_id: str) -> str:
        signal_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO vault_signals.signal (
              id, signal_type_id, domain, title, summary, direction,
              first_seen_at, event_id, base_confidence, base_impact, noise_probability,
              score_weight_set_id, created_by_version,
              prov_source, prov_rule_version, prov_confidence, prov_notes
            ) VALUES (
              %s, %s, 'sports_cards', 'Fixture signal', 'Unverified fixture.', 'unknown',
              %s, %s, 0.800, 0.500, 0.250,
              %s, %s,
              'fixture', %s, 0.400, 'scores are inferred · unverified'
            )
            """,
            (signal_id, type_id, seen, press_event, weight_id, RULE, RULE),
        )
        cur.execute("SELECT vault_signals.signal_priority(%s)", (signal_id,))
        assert float(cur.fetchone()[0]) == pytest.approx(0.3)
        return signal_id

    injury_id = insert_signal(injury_type)
    license_id = insert_signal(license_type)
    later = seen + timedelta(hours=48)
    cur.execute(
        "SELECT vault_signals.signal_influence(%s, %s)",
        (injury_id, later),
    )
    assert float(cur.fetchone()[0]) == pytest.approx(0.15, abs=1e-5)
    cur.execute(
        "SELECT vault_signals.signal_influence(%s, %s)",
        (license_id, later),
    )
    license_influence = float(cur.fetchone()[0])
    assert license_influence > 0.3 * 0.99
    assert license_influence <= 0.3

    # A different weight set re-ranks at read time; the signal row is not rewritten.
    cur.execute(
        """
        INSERT INTO vault_signals.score_weight_set (name, version, weights_json, verified)
        VALUES ('fixture-reweight', '9.9.9',
                '{"formula": "weighted_product_v1",
                  "exponents": {"base_confidence": 2, "base_impact": 1, "one_minus_noise": 1}}',
                false)
        RETURNING id
        """
    )
    reweight_id = cur.fetchone()[0]
    cur.execute("SELECT vault_signals.signal_priority(%s, %s)", (injury_id, reweight_id))
    assert float(cur.fetchone()[0]) == pytest.approx(0.24)
    cur.execute("SELECT vault_signals.signal_priority(%s)", (injury_id,))
    assert float(cur.fetchone()[0]) == pytest.approx(0.3)

    cur.execute(
        """
        INSERT INTO vault_signals.score_weight_set (name, version, weights_json, verified)
        VALUES ('fixture-bogus', '9.9.9', '{"formula": "section_5_guess"}', false)
        RETURNING id
        """
    )
    bogus_id = cur.fetchone()[0]
    cur.execute("SAVEPOINT bogus_formula")
    with pytest.raises(psycopg2.Error, match="unsupported formula"):
        cur.execute("SELECT vault_signals.signal_priority(%s, %s)", (injury_id, bogus_id))
    cur.execute("ROLLBACK TO SAVEPOINT bogus_formula")
    cur.execute("SAVEPOINT bogus_current")
    with pytest.raises(psycopg2.Error, match="score_weight_set_current_is_evaluable"):
        cur.execute(
            """
            UPDATE vault_signals.score_weight_set SET is_current = false WHERE is_current;
            UPDATE vault_signals.score_weight_set SET is_current = true WHERE id = %s;
            """,
            (bogus_id,),
        )
    cur.execute("ROLLBACK TO SAVEPOINT bogus_current")

    cur.execute("SAVEPOINT valuation_join")
    with pytest.raises(psycopg2.Error, match="valuation firewall"):
        cur.execute(
            """
            SELECT s.id
              FROM vault_signals.signal s
             WHERE vault_signals.assert_not_valuation_evidence(s.id)
               AND s.id = %s
            """,
            (injury_id,),
        )
    cur.execute("ROLLBACK TO SAVEPOINT valuation_join")

    cur.execute("SAVEPOINT valuation_insert")
    with pytest.raises(psycopg2.Error, match="valuation firewall"):
        cur.execute(
            """
            INSERT INTO vault_signals.valuation_citation (signal_id, valuation_path)
            VALUES (%s, 'vault_market.market_value')
            """,
            (injury_id,),
        )
    cur.execute("ROLLBACK TO SAVEPOINT valuation_insert")

    created = datetime(2026, 9, 1, tzinfo=timezone.utc)
    cur.execute(
        """
        INSERT INTO vault_signals.prediction (
          created_at, created_by, subject_ref, subject_kind, claim_text,
          expected_low, expected_high, expected_unit, confidence, horizon_days,
          expires_at, source_signal_id,
          prov_source, prov_rule_version, prov_confidence, prov_notes
        ) VALUES (
          %s, 'fixture', 'fixture:subject:1', 'narrative',
          'Attention fades inside a season. Range, not a point.',
          10, 40, 'mentions', 0.450, 90, %s, %s,
          'fixture', %s, 0.450, 'crude prediction · unverified'
        )
        RETURNING id, score_weight_set_id
        """,
        (created, created + timedelta(days=90), injury_id, RULE),
    )
    prediction_id, prediction_weight_id = cur.fetchone()
    assert prediction_weight_id == weight_id
    cur.execute(
        """
        SELECT due_at
          FROM vault_signals.prediction_measurement
         WHERE prediction_id = %s
         ORDER BY due_at
        """,
        (prediction_id,),
    )
    dues = [row[0] for row in cur.fetchall()]
    assert len(dues) == 5
    expected = [created + timedelta(days=days) for days in (7, 30, 90, 180, 365)]
    for actual, want in zip(dues, expected, strict=True):
        assert actual == want

    cur.execute(
        """
        SELECT count(*) FILTER (WHERE adapter_enabled OR is_active)
          FROM vault_core.signals_news_source
        """
    )
    assert cur.fetchone()[0] == 0
    cur.close()
