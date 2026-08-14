#!/usr/bin/env python3
"""
IQVault comics loader — inventory.json -> PostgreSQL catalog + holdings.

Loads the CLZ-enriched inventory into:
  vault_comic.series / issue / variant   (catalog identity)
  vault_core.asset                       (the spine)
  vault_core.external_id                 (barcode, CLZ hash, BP ids)
  vault_collection.holding               (what you own + intel scores)

Idempotent: re-running updates holdings in place (keyed on CLZ id) and
skips catalog rows that already exist.

Usage:
  python load_comics.py --json path/to/inventory.json \
      --dsn "dbname=iqvault user=postgres host=localhost"
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, date
from pathlib import Path

import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
from clz_delta import ExistingHolding, compute_delta, holding_row_id  # noqa: E402

DATE_FORMATS = ["%b %d, %Y", "%b %Y", "%Y-%m-%d", "%m/%d/%Y", "%Y"]


def parse_date(s: str | None) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_year(s: str | None) -> int | None:
    m = re.search(r"(19|20)\d{2}", s or "")
    return int(m.group(0)) if m else None


def yn(v) -> bool:
    return str(v).strip().lower() in ("yes", "true", "1", "y")


def slugify(*parts) -> str:
    raw = "-".join(str(p) for p in parts if p)
    raw = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    return raw[:200]


def norm(v) -> str:
    return str(v or "").strip()


def ensure_dropped_at_column(cur) -> None:
    cur.execute(
        """
        ALTER TABLE vault_collection.holding
            ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ
        """
    )


def load_inventory(conn, rows: list[dict]) -> dict:
    """Upsert catalog + holdings and reconcile dropped CLZ rows. Returns stats + delta."""
    print(f"Loaded {len(rows)} inventory rows")

    # Pass 1: earliest year per (series, publisher) so a long-running series
    # is ONE row, not one per calendar year of releases.
    series_year: dict[tuple, int | None] = {}
    for r in rows:
        k = (norm(r.get("Series")), norm(r.get("Publisher")) or "Unknown")
        y = parse_year(r.get("Release Date")) or parse_year(r.get("Cover Date"))
        cur_y = series_year.get(k)
        if y and (cur_y is None or y < cur_y):
            series_year[k] = y
        elif k not in series_year:
            series_year[k] = None

    # NOTE: series UNIQUE(title, publisher, volume, year_began) does NOT stop
    # duplicates when year_began is NULL (SQL NULLs are pairwise distinct).
    # Schema-level fix for PG15+: UNIQUE NULLS NOT DISTINCT. Loader-level fix:
    # preload existing rows so re-runs reuse ids instead of re-inserting.
    series_cache: dict[tuple, str] = {}
    cur = conn.cursor()
    ensure_dropped_at_column(cur)
    cur.execute(
        """
        SELECT source_row_id, current_price_snapshot, dropped_at
        FROM vault_collection.holding
        WHERE source = 'clz_import'
        """
    )
    existing = {
        str(rid): ExistingHolding(
            source_row_id=str(rid),
            current_price=float(price) if price is not None else None,
            dropped_at=dropped,
        )
        for rid, price, dropped in cur.fetchall()
        if rid
    }
    incoming: dict[str, dict] = {}
    for r in rows:
        rid = holding_row_id(r)
        if rid:
            incoming[rid] = r
    delta = compute_delta(existing, incoming)

    cur.execute("SELECT id, title, publisher, volume, year_began FROM vault_comic.series")
    for sid, t, p, vol, y in cur.fetchall():
        series_cache[(t, p, vol, y)] = sid
    issue_cache: dict[tuple, str] = {}
    asset_cache: dict[tuple, str] = {}
    stats = dict(series=0, issues=0, assets=0, holdings=0, extids=0, skipped=0)

    for r in rows:
        series_t = norm(r.get("Series"))
        publisher = norm(r.get("Publisher")) or "Unknown"
        if not series_t:
            stats["skipped"] += 1
            continue

        year_began = series_year[(series_t, publisher)]

        # ── series ──────────────────────────────────────────────────────
        skey = (series_t, publisher, 1, year_began)
        if skey not in series_cache:
            cur.execute(
                """INSERT INTO vault_comic.series (title, publisher, volume, year_began)
                   VALUES (%s,%s,1,%s)
                   ON CONFLICT (title, publisher, volume, year_began) DO UPDATE SET title=EXCLUDED.title
                   RETURNING id""",
                (series_t, publisher, year_began),
            )
            series_cache[skey] = cur.fetchone()[0]
            stats["series"] += 1
        series_id = series_cache[skey]

        # ── issue ───────────────────────────────────────────────────────
        issue_no = norm(r.get("Issue")) or norm(r.get("Issue Full")) or "1"
        ikey = (series_id, issue_no)
        if ikey not in issue_cache:
            cur.execute(
                """INSERT INTO vault_comic.issue
                       (series_id, issue_number, cover_date, is_key_issue, key_reason)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (series_id, issue_number) DO UPDATE SET issue_number=EXCLUDED.issue_number
                   RETURNING id""",
                (
                    series_id,
                    issue_no,
                    parse_date(r.get("Cover Date")),
                    # CLZ values are 'No' / 'Minor' / 'Major' — not Yes/No
                    norm(r.get("Is Key Comic")).lower() in ("minor", "major", "yes"),
                    " | ".join(
                        p for p in (
                            norm(r.get("Is Key Comic")) if norm(r.get("Is Key Comic")).lower() in ("minor", "major") else "",
                            norm(r.get("Key Categories")),
                            norm(r.get("Key Comic Reason")),
                        ) if p
                    ) or None,
                ),
            )
            issue_cache[ikey] = cur.fetchone()[0]
            stats["issues"] += 1
        issue_id = issue_cache[ikey]

        # ── asset + variant (one per unique issue+cover) ────────────────
        cover_label = norm(r.get("Edition / Variant")) or norm(r.get("Issue Ext")) or "A"
        cover_label = cover_label[:120]
        akey = (issue_id, cover_label)
        if akey not in asset_cache:
            issue_full = norm(r.get("Issue Full")) or issue_no
            canonical = f"{series_t} #{issue_full}"
            if cover_label not in ("A", ""):
                canonical += f" ({cover_label})"
            slug = slugify(publisher, series_t, issue_full, cover_label, year_began)

            tags = [t.strip() for t in norm(r.get("Tags")).split(";") if t.strip()]
            pillar = norm(r.get("Collection Pillar"))
            if pillar:
                tags.append(f"pillar:{pillar}")

            cur.execute(
                """INSERT INTO vault_core.asset
                       (category_id, format, canonical_name, slug, release_year,
                        tags, primary_image_url)
                   VALUES (4,'single',%s,%s,%s,%s,%s)
                   ON CONFLICT (slug) DO UPDATE SET canonical_name=EXCLUDED.canonical_name
                   RETURNING id""",
                (canonical, slug, parse_year(r.get("Release Date")),
                 tags, norm(r.get("Cover Image URL")) or None),
            )
            asset_id = cur.fetchone()[0]

            cur.execute(
                """INSERT INTO vault_comic.variant
                       (asset_id, issue_id, printing, cover_label, is_variant_cover)
                   VALUES (%s,%s,1,%s,%s)
                   ON CONFLICT DO NOTHING""",
                (asset_id, issue_id, cover_label, cover_label not in ("A", "Regular")),
            )
            asset_cache[akey] = asset_id
            stats["assets"] += 1
        asset_id = asset_cache[akey]

        # ── external ids ────────────────────────────────────────────────
        for source, field in (("barcode", "Barcode"), ("clz_hash", "CLZ Hash"),
                              ("bp_comic", "BP Comic ID")):
            val = norm(r.get(field))
            if val:
                cur.execute(
                    """INSERT INTO vault_core.external_id (asset_id, source, external_value)
                       VALUES (%s,%s,%s) ON CONFLICT (source, external_value) DO NOTHING""",
                    (asset_id, source, val),
                )
                stats["extids"] += cur.rowcount

        # ── holding (one per inventory row) ─────────────────────────────
        clz_meta = json.dumps(r, default=str)
        cur.execute(
            """INSERT INTO vault_collection.holding
                   (asset_id, quantity, purchase_price, purchase_date, location,
                    slab_status, assumed_grade, grade_rating,
                    collection_pillar, museum_score, investment_score, liquidity_score,
                    recommendation, sell_priority, upgrade_candidate,
                    needs_grading, needs_photo, needs_verification, verification_notes,
                    value_locked, current_price_snapshot, source, source_row_id, clz_metadata)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'clz_import',%s,%s::jsonb)
               ON CONFLICT (source, source_row_id) DO UPDATE SET
                    quantity=EXCLUDED.quantity,
                    purchase_price=EXCLUDED.purchase_price,
                    purchase_date=EXCLUDED.purchase_date,
                    location=EXCLUDED.location,
                    slab_status=EXCLUDED.slab_status,
                    assumed_grade=EXCLUDED.assumed_grade,
                    grade_rating=EXCLUDED.grade_rating,
                    collection_pillar=EXCLUDED.collection_pillar,
                    museum_score=EXCLUDED.museum_score,
                    investment_score=EXCLUDED.investment_score,
                    liquidity_score=EXCLUDED.liquidity_score,
                    recommendation=EXCLUDED.recommendation,
                    sell_priority=EXCLUDED.sell_priority,
                    upgrade_candidate=EXCLUDED.upgrade_candidate,
                    needs_grading=EXCLUDED.needs_grading,
                    needs_photo=EXCLUDED.needs_photo,
                    needs_verification=EXCLUDED.needs_verification,
                    verification_notes=EXCLUDED.verification_notes,
                    value_locked=EXCLUDED.value_locked,
                    current_price_snapshot=EXCLUDED.current_price_snapshot,
                    clz_metadata=EXCLUDED.clz_metadata,
                    dropped_at=NULL,
                    updated_at=now()""",
            (
                asset_id,
                int(r.get("Quantity") or 1),
                r.get("Purchase Price"),
                parse_date(r.get("Purchase Date")),
                norm(r.get("Location")) or None,
                norm(r.get("Slab Status")) or None,
                norm(r.get("Assumed Grade")) or None,
                r.get("Grade Rating"),
                norm(r.get("Collection Pillar")) or None,
                r.get("Museum Score"), r.get("Investment Score"), r.get("Liquidity Score"),
                norm(r.get("Recommendation")) or None,
                norm(r.get("Sell Priority")) or None,
                yn(r.get("Upgrade Candidate")),
                yn(r.get("Needs Grading")), yn(r.get("Needs Photo")),
                yn(r.get("Needs Verification")),
                norm(r.get("Verification Notes")) or None,
                yn(r.get("Value Locked")),
                r.get("Current Price"),
                holding_row_id(r),
                clz_meta,
            ),
        )
        stats["holdings"] += 1

    if delta.dropped:
        cur.execute(
            """
            UPDATE vault_collection.holding
               SET dropped_at = now(), updated_at = now()
             WHERE source = 'clz_import'
               AND dropped_at IS NULL
               AND source_row_id = ANY(%s)
            """,
            (delta.dropped,),
        )
        stats["dropped"] = cur.rowcount
    else:
        stats["dropped"] = 0

    conn.commit()
    print("Committed.")
    for k, v in stats.items():
        print(f"  {k:9s} {v}")
    print(
        "  delta    "
        f"added={len(delta.added)} updated={len(delta.updated)} "
        f"dropped={len(delta.dropped)} revived={len(delta.revived)} "
        f"price_changed={len(delta.price_changed)} unchanged={delta.unchanged}"
    )
    return {"stats": stats, "delta": delta.as_dict()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--dsn", required=True)
    args = ap.parse_args()

    rows = json.load(open(args.json, encoding="utf-8"))
    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    try:
        load_inventory(conn, rows)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
