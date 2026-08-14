"""PostgreSQL → Comics Terminal JSON shape."""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from clz_delta import holding_is_active  # noqa: E402

HOLDINGS_SQL = """
SELECT
    h.quantity,
    h.purchase_price,
    h.purchase_date,
    h.location,
    h.slab_status,
    h.assumed_grade,
    h.grade_rating,
    h.collection_pillar,
    h.museum_score,
    h.investment_score,
    h.liquidity_score,
    h.recommendation,
    h.sell_priority,
    h.upgrade_candidate,
    h.needs_grading,
    h.needs_photo,
    h.needs_verification,
    h.verification_notes,
    h.value_locked,
    h.current_price_snapshot,
    h.source_row_id,
    h.clz_metadata,
    h.imported_at,
    h.updated_at,
    h.dropped_at,
    a.canonical_name,
    a.primary_image_url,
    a.release_year,
    s.title AS series_title,
    s.publisher,
    i.issue_number,
    i.cover_date,
    i.is_key_issue,
    i.key_reason,
    v.cover_label
FROM vault_collection.holding h
JOIN vault_core.asset a ON a.id = h.asset_id
JOIN vault_comic.variant v ON v.asset_id = a.id
JOIN vault_comic.issue i ON i.id = v.issue_id
JOIN vault_comic.series s ON s.id = i.series_id
WHERE h.dropped_at IS NULL
ORDER BY s.title, i.issue_number, v.cover_label
"""


def _yn(val: bool | None) -> str:
    return "Yes" if val else "No"


def _num(val: Any, default: float = 0) -> float:
    if val is None:
        return default
    if isinstance(val, Decimal):
        return float(val)
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _date_str(val: Any) -> str:
    if val is None:
        return ""
    if hasattr(val, "isoformat"):
        return val.strftime("%b %d, %Y") if hasattr(val, "day") else str(val)
    return str(val)


def row_from_holding(rec: dict) -> dict:
    """Map a DB holding row to the CLZ inventory.json shape the terminal expects."""
    meta = rec.get("clz_metadata") or {}
    if isinstance(meta, str):
        meta = json.loads(meta)

    if meta:
        row = dict(meta)
    else:
        row = {
            "Series": rec.get("series_title") or "",
            "Issue": rec.get("issue_number") or "",
            "Issue Full": rec.get("issue_number") or "",
            "Publisher": rec.get("publisher") or "",
            "Edition / Variant": rec.get("cover_label") or "",
            "Cover Image URL": rec.get("primary_image_url") or "",
        }

    row["Collection Pillar"] = rec.get("collection_pillar") or row.get("Collection Pillar", "")
    row["Recommendation"] = rec.get("recommendation") or row.get("Recommendation", "")
    row["Sell Priority"] = rec.get("sell_priority") or row.get("Sell Priority", "")
    row["Museum Score"] = _num(rec.get("museum_score"), row.get("Museum Score", 0))
    row["Investment Score"] = _num(rec.get("investment_score"), row.get("Investment Score", 0))
    row["Liquidity Score"] = _num(rec.get("liquidity_score"), row.get("Liquidity Score", 0))
    row["Upgrade Candidate"] = _yn(rec.get("upgrade_candidate"))
    row["Needs Grading"] = _yn(rec.get("needs_grading"))
    row["Needs Photo"] = _yn(rec.get("needs_photo"))
    row["Needs Verification"] = _yn(rec.get("needs_verification"))
    row["Verification Notes"] = rec.get("verification_notes") or row.get("Verification Notes", "")
    row["Quantity"] = int(rec.get("quantity") or row.get("Quantity") or 1)
    row["Location"] = rec.get("location") or row.get("Location", "")
    row["Current Price"] = _num(rec.get("current_price_snapshot"), row.get("Current Price", 0))
    row["Purchase Price"] = _num(rec.get("purchase_price"), row.get("Purchase Price", 0))
    row["Purchase Date"] = _date_str(rec.get("purchase_date")) or row.get("Purchase Date", "")
    row["Slab Status"] = rec.get("slab_status") or row.get("Slab Status", "")
    row["Assumed Grade"] = rec.get("assumed_grade") or row.get("Assumed Grade", "")
    row["Grade Rating"] = _num(rec.get("grade_rating"), row.get("Grade Rating", 0))
    row["Value Locked"] = _yn(rec.get("value_locked"))
    row["Cover Image URL"] = rec.get("primary_image_url") or row.get("Cover Image URL", "")

    if rec.get("is_key_issue"):
        key_level = row.get("Is Key Comic", "")
        if key_level in ("", "No"):
            row["Is Key Comic"] = "Minor"
        row["Key Comic Reason"] = rec.get("key_reason") or row.get("Key Comic Reason", "")

    imported = rec.get("updated_at") or rec.get("imported_at")
    row["id"] = rec.get("source_row_id") or row.get("id") or ""
    row["_source"] = "postgres"
    row["_importedAt"] = imported.isoformat() if imported else None
    return row


def build_meta(rows: list[dict], *, snapshot_label: str | None = None) -> dict:
    total_value = sum(r.get("Current Price", 0) * r.get("Quantity", 1) for r in rows)
    pillars = Counter(r.get("Collection Pillar", "Unknown") for r in rows)
    pillar_value: dict[str, float] = defaultdict(float)
    for r in rows:
        pillar_value[r.get("Collection Pillar", "Unknown")] += r.get("Current Price", 0) * r.get(
            "Quantity", 1
        )

    locations = Counter(r.get("Location", "") or "Unassigned" for r in rows)
    recs = Counter(r.get("Recommendation", "") for r in rows)

    label = snapshot_label or "PostgreSQL live"

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "snapshotLabel": label,
        "recordCount": len(rows),
        "totalQuantity": sum(r.get("Quantity", 1) for r in rows),
        "totalValue": round(total_value, 2),
        "museumCandidates": sum(1 for r in rows if r.get("Recommendation") == "Museum Candidate"),
        "highSellPriority": sum(1 for r in rows if r.get("Sell Priority") == "High"),
        "duplicates": sum(1 for r in rows if r.get("Duplicate") == "Yes"),
        "needsGrading": sum(1 for r in rows if r.get("Needs Grading") == "Yes"),
        "needsVerification": sum(1 for r in rows if r.get("Needs Verification") == "Yes"),
        "pillars": [
            {"name": name, "count": count, "value": round(pillar_value[name], 2)}
            for name, count in pillars.most_common()
        ],
        "recommendations": dict(recs.most_common()),
        "topLocations": [{"name": k, "count": v} for k, v in locations.most_common(12)],
        "avgMuseumScore": round(
            sum(r.get("Museum Score", 0) for r in rows) / max(len(rows), 1), 1
        ),
        "avgInvestmentScore": round(
            sum(r.get("Investment Score", 0) for r in rows) / max(len(rows), 1), 1
        ),
        "source": "postgres",
    }


def _snapshot_label(conn, rows: list[dict]) -> str:
    """Prefer latest raw CLZ snapshot ingest, else MAX(holding.updated_at)."""
    cur = conn.cursor()
    ingested = None
    try:
        cur.execute(
            """
            SELECT MAX(ingested_at)
              FROM vault_evidence.raw_snapshots
             WHERE source = 'clz_xml'
            """
        )
        ingested = cur.fetchone()[0]
    except Exception:
        conn.rollback()
    updated = None
    try:
        cur.execute(
            """
            SELECT MAX(updated_at)
              FROM vault_collection.holding
             WHERE source = 'clz_import' AND dropped_at IS NULL
            """
        )
        updated = cur.fetchone()[0]
    except Exception:
        conn.rollback()
    cur.close()
    stamp = ingested or updated
    if stamp is None and rows:
        iso = rows[0].get("_importedAt")
        if iso:
            return f"PostgreSQL · imported {str(iso)[:10]}"
        return "PostgreSQL live"
    if stamp is None:
        return "PostgreSQL live"
    day = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp)[:10]
    return f"PostgreSQL · CLZ {day}"


def fetch_inventory(conn) -> tuple[list[dict], dict]:
    cur = conn.cursor()
    cur.execute(HOLDINGS_SQL)
    cols = [d[0] for d in cur.description]
    recs = [dict(zip(cols, rec)) for rec in cur.fetchall()]
    cur.close()
    rows = [row_from_holding(rec) for rec in recs if holding_is_active(rec)]
    meta = build_meta(rows, snapshot_label=_snapshot_label(conn, rows))
    return rows, meta


def _yes_no(val: Any) -> bool | None:
    if val is None or val == "":
        return None
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ("yes", "true", "1"):
        return True
    if s in ("no", "false", "0"):
        return False
    return None


# CLZ display field → (holding column, converter)
HOLDING_FIELD_MAP: dict[str, tuple[str, Any]] = {
    "Quantity": ("quantity", lambda v: int(v) if v not in (None, "") else 1),
    "Location": ("location", lambda v: (str(v).strip() or None) if v is not None else None),
    "Purchase Price": ("purchase_price", _num),
    "Slab Status": ("slab_status", lambda v: (str(v).strip() or None) if v is not None else None),
    "Assumed Grade": ("assumed_grade", lambda v: (str(v).strip() or None) if v is not None else None),
    "Grade Rating": ("grade_rating", _num),
    "Collection Pillar": ("collection_pillar", lambda v: (str(v).strip() or None) if v is not None else None),
    "Museum Score": ("museum_score", _num),
    "Investment Score": ("investment_score", _num),
    "Liquidity Score": ("liquidity_score", _num),
    "Recommendation": ("recommendation", lambda v: (str(v).strip() or None) if v is not None else None),
    "Sell Priority": ("sell_priority", lambda v: (str(v).strip() or None) if v is not None else None),
    "Verification Notes": ("verification_notes", lambda v: (str(v).strip() or None) if v is not None else None),
    "Current Price": ("current_price_snapshot", _num),
    "Upgrade Candidate": ("upgrade_candidate", _yes_no),
    "Needs Grading": ("needs_grading", _yes_no),
    "Needs Photo": ("needs_photo", _yes_no),
    "Needs Verification": ("needs_verification", _yes_no),
    "Value Locked": ("value_locked", _yes_no),
}


HOLDING_BY_ID_SQL = """
SELECT
    h.quantity,
    h.purchase_price,
    h.purchase_date,
    h.location,
    h.slab_status,
    h.assumed_grade,
    h.grade_rating,
    h.collection_pillar,
    h.museum_score,
    h.investment_score,
    h.liquidity_score,
    h.recommendation,
    h.sell_priority,
    h.upgrade_candidate,
    h.needs_grading,
    h.needs_photo,
    h.needs_verification,
    h.verification_notes,
    h.value_locked,
    h.current_price_snapshot,
    h.source_row_id,
    h.clz_metadata,
    h.imported_at,
    h.updated_at,
    h.dropped_at,
    a.canonical_name,
    a.primary_image_url,
    a.release_year,
    s.title AS series_title,
    s.publisher,
    i.issue_number,
    i.cover_date,
    i.is_key_issue,
    i.key_reason,
    v.cover_label
FROM vault_collection.holding h
JOIN vault_core.asset a ON a.id = h.asset_id
JOIN vault_comic.variant v ON v.asset_id = a.id
JOIN vault_comic.issue i ON i.id = v.issue_id
JOIN vault_comic.series s ON s.id = i.series_id
WHERE h.source_row_id = %s
"""


def update_holding(conn, source_row_id: str, fields: dict) -> dict:
    """Patch holding columns + merge into clz_metadata. Returns updated CLZ row."""
    if not source_row_id:
        raise ValueError("Missing holding id")

    sets: list[str] = []
    params: list[Any] = []
    meta_patch: dict[str, Any] = {}

    for clz_key, raw_val in fields.items():
        if clz_key not in HOLDING_FIELD_MAP:
            continue
        col, conv = HOLDING_FIELD_MAP[clz_key]
        val = conv(raw_val)
        sets.append(f"{col} = %s")
        params.append(val)
        if clz_key in (
            "Upgrade Candidate",
            "Needs Grading",
            "Needs Photo",
            "Needs Verification",
            "Value Locked",
        ):
            meta_patch[clz_key] = _yn(val) if val is not None else "No"
        elif val is not None:
            meta_patch[clz_key] = val

    if not sets:
        raise ValueError("No editable fields in patch")

    sets.append("updated_at = now()")
    sets.append("clz_metadata = COALESCE(clz_metadata, '{}'::jsonb) || %s::jsonb")
    params.append(json.dumps(meta_patch, default=str))
    params.append(source_row_id)

    sql = f"""
        UPDATE vault_collection.holding
        SET {", ".join(sets)}
        WHERE source = 'clz_import' AND source_row_id = %s
    """
    cur = conn.cursor()
    cur.execute(sql, params)
    if cur.rowcount == 0:
        cur.close()
        raise LookupError(f"Holding not found: {source_row_id}")

    cur.execute(HOLDING_BY_ID_SQL, (source_row_id,))
    cols = [d[0] for d in cur.description]
    rec = cur.fetchone()
    cur.close()
    if not rec:
        raise LookupError(f"Holding not found after update: {source_row_id}")

    conn.commit()
    return row_from_holding(dict(zip(cols, rec)))
