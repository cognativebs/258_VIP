#!/usr/bin/env python3
"""One-way import: Binder SQLite file → vault_tcg Postgres (ADR 0007).

Usage:
  python scripts/migrate_binder_sqlite_to_postgres.py \
      --sqlite apps/binder-vault/.data/binder-vault.sqlite \
      --dsn "dbname=iqvault user=postgres password=vault host=localhost"
"""
from __future__ import annotations

import argparse
import sqlite3
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    ap.add_argument(
        "--dsn",
        default="dbname=iqvault user=postgres password=vault host=localhost",
    )
    args = ap.parse_args()

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        print("pip install psycopg2-binary", file=sys.stderr)
        return 1

    src = sqlite3.connect(args.sqlite)
    src.row_factory = sqlite3.Row
    dst = psycopg2.connect(args.dsn)
    dst.autocommit = False
    cur = dst.cursor()

    binders = list(src.execute("SELECT * FROM binder"))
    pages = list(src.execute("SELECT * FROM binder_page"))
    slots = list(src.execute("SELECT * FROM binder_slot"))
    print(f"SQLite: {len(binders)} binders, {len(pages)} pages, {len(slots)} slots")

    for b in binders:
        cur.execute(
            """INSERT INTO vault_tcg.binder
                   (id, name, spine_color, rows, cols, template, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET
                 name=EXCLUDED.name, spine_color=EXCLUDED.spine_color,
                 rows=EXCLUDED.rows, cols=EXCLUDED.cols, template=EXCLUDED.template,
                 updated_at=EXCLUDED.updated_at""",
            (
                b["id"], b["name"], b["spine_color"], b["rows"], b["cols"],
                b["template"], b["created_at"], b["updated_at"],
            ),
        )

    for p in pages:
        cur.execute(
            """INSERT INTO vault_tcg.binder_page
                   (id, binder_id, page_index, title, subtitle, tone, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET
                 page_index=EXCLUDED.page_index, title=EXCLUDED.title,
                 subtitle=EXCLUDED.subtitle, tone=EXCLUDED.tone""",
            (
                p["id"], p["binder_id"], p["page_index"], p["title"],
                p["subtitle"], p["tone"], p["created_at"],
            ),
        )

    for s in slots:
        keys = s.keys()
        cur.execute(
            """INSERT INTO vault_tcg.binder_slot
                   (id, page_id, slot_index, role_label, is_center,
                    source, external_id, card_name, set_name, number, rarity,
                    image_url, image_local, price_market, price_currency, price_updated_at,
                    provenance_method, provenance_source, provenance_model_version,
                    confidence, verification_status, added_at, on_wishlist, owned)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET
                 source=EXCLUDED.source, external_id=EXCLUDED.external_id,
                 card_name=EXCLUDED.card_name, set_name=EXCLUDED.set_name,
                 number=EXCLUDED.number, rarity=EXCLUDED.rarity,
                 image_url=EXCLUDED.image_url, image_local=EXCLUDED.image_local,
                 price_market=EXCLUDED.price_market, price_currency=EXCLUDED.price_currency,
                 price_updated_at=EXCLUDED.price_updated_at,
                 provenance_method=EXCLUDED.provenance_method,
                 provenance_source=EXCLUDED.provenance_source,
                 provenance_model_version=EXCLUDED.provenance_model_version,
                 confidence=EXCLUDED.confidence,
                 verification_status=EXCLUDED.verification_status,
                 added_at=EXCLUDED.added_at,
                 on_wishlist=EXCLUDED.on_wishlist, owned=EXCLUDED.owned""",
            (
                s["id"], s["page_id"], s["slot_index"], s["role_label"],
                bool(s["is_center"]),
                s["source"], s["external_id"], s["card_name"], s["set_name"],
                s["number"], s["rarity"], s["image_url"], s["image_local"],
                s["price_market"], s["price_currency"],
                s["price_updated_at"] if "price_updated_at" in keys else None,
                s["provenance_method"], s["provenance_source"],
                s["provenance_model_version"], s["confidence"],
                s["verification_status"], s["added_at"],
                bool(s["on_wishlist"]) if "on_wishlist" in keys else False,
                bool(s["owned"]) if "owned" in keys else False,
            ),
        )

    dst.commit()
    cur.execute("SELECT COUNT(*) FROM vault_tcg.binder")
    print("Postgres binders:", cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM vault_tcg.binder_slot WHERE source IS NOT NULL")
    print("Postgres filled slots:", cur.fetchone()[0])
    cur.close()
    dst.close()
    src.close()
    print("Import complete. SQLite file left in place as an archive — Binder no longer reads it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
