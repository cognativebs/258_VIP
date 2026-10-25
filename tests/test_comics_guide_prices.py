"""Comics guide prices: CLZ values and ComicBase second-opinion prices as dated vendor-guide rows.

DB test needs IQVAULT_TEST_DSN with the CLZ import; it runs in one transaction and rolls back.
CI imports that export before pytest, and import_clz.py already seeds the CLZ guide rows.
This test deletes those rows inside the transaction so the first write is still observable,
then checks a same-day second write is a no-op. The rollback restores the import's rows.
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

from comics_guide_prices import condition_key_for_comicbase, price_of  # noqa: E402


def test_condition_and_price_parsing():
    assert condition_key_for_comicbase("NM") == "raw_nm"
    assert condition_key_for_comicbase("vf") == "raw_vf"
    assert condition_key_for_comicbase("") == "raw_nm"
    assert condition_key_for_comicbase("NM-") == "raw_nm"
    assert price_of("3") == 3.0 and price_of("$1,250.50") == 1250.5
    assert price_of("0") is None and price_of("") is None and price_of(None) is None


DSN = os.environ.get("IQVAULT_TEST_DSN")


class _NoCommit:
    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def rollback(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.mark.skipif(not DSN, reason="IQVAULT_TEST_DSN not set — needs a migrated Postgres with the CLZ import")
def test_prices_are_dated_vendor_guide_rows_written_once(tmp_path):
    psycopg2 = pytest.importorskip("psycopg2")
    import comics_guide_prices as g

    conn = psycopg2.connect(DSN)
    try:
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM vault_market.data_source WHERE source_key IN ('clz', 'comicbase')")
        if cur.fetchone()[0] < 2:
            pytest.skip("needs migration 20261025_01")
        cur.execute(
            """SELECT s.title, i.issue_number, h.source_row_id FROM vault_collection.holding h
                 JOIN vault_comic.variant v ON v.asset_id = h.asset_id JOIN vault_comic.issue i ON i.id = v.issue_id
                 JOIN vault_comic.series s ON s.id = i.series_id
                WHERE h.source = 'clz_import' AND h.dropped_at IS NULL
                  AND s.title = 'Action Comics, Vol. 2' AND i.issue_number = '5' LIMIT 1"""
        )
        if not cur.fetchone():
            pytest.skip("needs the CLZ import (Action Comics, Vol. 2 #5)")
        wrapped = _NoCommit(conn)
        # Import already wrote today's CLZ guide rows (ON CONFLICT DO NOTHING).
        # Drop them in this transaction so the first call below is a real write.
        # finally rolls the connection back, so the committed import rows stay.
        cur.execute("DELETE FROM vault_market.guide_price_observation WHERE source = 'clz'")

        first = g.run_clz(wrapped, dry_run=False)
        assert first["rows_written"] == first["holdings_priced"] > 0
        assert g.run_clz(wrapped, dry_run=False)["rows_written"] == 0  # same export, same day: nothing new
        cur.execute("SELECT count(*) FROM vault_market.guide_price_observation WHERE source = 'clz'")
        assert cur.fetchone()[0] == first["holdings_priced"]

        export = tmp_path / "Exported Comic Books.txt"
        export.write_text(
            '"Title","Item #","Condition","Qty In Stock","Price","Item Description","Cover Date"\n'
            '"Action Comics (2nd Series)","5","NM","1","12.5","","3/1/2012"\n'
            '"No Such Series","1","NM","1","4","","1/1/2001"\n',
            encoding="utf-8",
        )
        cb = g.run_comicbase(wrapped, str(export), dry_run=False, out_dir=str(tmp_path))
        assert (cb["items"], cb["priced"], cb["not_priced"]) == (2, 1, 1)
        cur.execute(
            """SELECT source, condition_key, guide_price::float, evidence_class, prov_verification::text, baseline_eligible
                 FROM vault_market.guide_price_observation WHERE source = 'comicbase' AND guide_price = 12.5"""
        )
        assert cur.fetchone() == ("comicbase", "raw_nm", 12.5, "vendor_derived", "unverified", False)
        assert g.run_comicbase(wrapped, str(export), dry_run=False, out_dir=str(tmp_path))["rows_written"] == 0
        assert "No Such Series" in (tmp_path / "comicbase-prices-Exported-Comic-Books" / "not_priced.csv").read_text(encoding="utf-8-sig")
    finally:
        conn.rollback()
        conn.close()
