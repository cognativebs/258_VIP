"""Collection-level unknown-exit (unrecorded bulk gift). Never touches holdings."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

UNKNOWN_EXIT_RULE = "unknown-exit@0.1.0"
DEFAULT_SCOPE_NAME = "General Inventory"
DEFAULT_SCOPE = "general_inventory_bulk"

CATALOG_SLICE_SQL = """
SELECT
    COUNT(*) FILTER (WHERE dropped_at IS NULL) AS catalog_holdings,
    COALESCE(
        SUM(COALESCE(current_price_snapshot, 0) * COALESCE(quantity, 1))
        FILTER (WHERE dropped_at IS NULL),
        0
    ) AS catalog_value,
    COUNT(*) FILTER (
        WHERE dropped_at IS NULL AND collection_pillar = %s
    ) AS scope_holdings,
    COALESCE(
        SUM(COALESCE(current_price_snapshot, 0) * COALESCE(quantity, 1))
        FILTER (WHERE dropped_at IS NULL AND collection_pillar = %s),
        0
    ) AS scope_value
FROM vault_collection.holding
WHERE source = 'clz_import'
"""

OPEN_EVENT_SQL = """
SELECT
    id, scope, estimated_qty, estimated_value_low, estimated_value_high,
    currency, titles_recorded, recipient_note, occurred_at, status,
    holdings_touched, prov_source, prov_method, prov_rule_version,
    prov_confidence, prov_verification, prov_notes, created_at, updated_at
FROM vault_collection.unknown_exit
WHERE status = 'open'
ORDER BY occurred_at DESC
LIMIT 1
"""


def _num(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    if isinstance(val, Decimal):
        return float(val)
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _round2(n: float) -> float:
    return round(n + 0.0, 2)


def gifted_share(estimated_qty: int, scope_holdings: int) -> float:
    if scope_holdings <= 0 or estimated_qty <= 0:
        return 0.0
    return min(1.0, estimated_qty / scope_holdings)


def evaluate_unknown_exit_impact(slice: dict, estimated_qty: int) -> dict:
    """Match @vip/core-model evaluateUnknownExitImpact. Inferred · unverified."""
    catalog_holdings = int(slice.get("catalogHoldings") or 0)
    catalog_value = _num(slice.get("catalogValue"))
    scope_holdings = int(slice.get("scopeHoldings") or 0)
    scope_value = _num(slice.get("scopeValue"))
    scope_name = str(slice.get("scopeName") or DEFAULT_SCOPE_NAME)
    qty = max(0, int(estimated_qty))
    share = gifted_share(qty, scope_holdings)
    unaccounted = _round2(scope_value * share)
    gifted_holdings = min(qty, scope_holdings)
    return {
        "catalogHoldings": catalog_holdings,
        "catalogValue": _round2(catalog_value),
        "scopeName": scope_name,
        "scopeHoldings": scope_holdings,
        "scopeValue": _round2(scope_value),
        "estimatedQty": qty,
        "giftedShare": share,
        "unaccountedValueHigh": unaccounted,
        "physicalHoldingsLow": max(0, catalog_holdings - gifted_holdings),
        "physicalHoldingsHigh": catalog_holdings,
        "physicalValueLow": _round2(max(0.0, catalog_value - unaccounted)),
        "physicalValueHigh": _round2(catalog_value),
        "holdingsTouched": False,
        "titlesInvented": False,
        "verificationStatus": "unverified",
        "method": "inferred",
        "ruleOrModelVersion": UNKNOWN_EXIT_RULE,
        "recommendations": [
            {
                "action": "Pass",
                "appliesTo": "general_inventory_bulk",
                "reasonCodes": [
                    "UNRECORDED_BULK_EXIT",
                    "TITLES_UNKNOWN",
                    "DO_NOT_DELETE_HOLDINGS",
                ],
                "confidence": 0.4,
                "notes": (
                    "Pass on treating General Inventory as physically confirmed "
                    "sell/lot stock. Titles were not recorded — do not delete "
                    "or drop holdings."
                ),
            },
            {
                "action": "Hold",
                "appliesTo": "keys_and_themed_pillars",
                "reasonCodes": ["BULK_GIFT_OUTSIDE_KEYS", "STALE_CLZ_SNAPSHOT"],
                "confidence": 0.55,
                "notes": (
                    "Hold keys, museum, and themed pillars. The unrecorded gift "
                    "was bulk; collection value barely moves if General "
                    "Inventory is the slice."
                ),
            },
        ],
    }


def fetch_catalog_slice(conn, scope_name: str = DEFAULT_SCOPE_NAME) -> dict:
    cur = conn.cursor()
    cur.execute(CATALOG_SLICE_SQL, (scope_name, scope_name))
    row = cur.fetchone()
    cur.close()
    if not row:
        return {
            "catalogHoldings": 0,
            "catalogValue": 0.0,
            "scopeName": scope_name,
            "scopeHoldings": 0,
            "scopeValue": 0.0,
        }
    return {
        "catalogHoldings": int(row[0] or 0),
        "catalogValue": _num(row[1]),
        "scopeName": scope_name,
        "scopeHoldings": int(row[2] or 0),
        "scopeValue": _num(row[3]),
    }


def _event_from_row(row: tuple) -> dict:
    return {
        "id": str(row[0]),
        "scope": row[1],
        "estimatedQty": int(row[2]),
        "estimatedValueLow": None if row[3] is None else _num(row[3]),
        "estimatedValueHigh": None if row[4] is None else _num(row[4]),
        "currency": row[5] or "USD",
        "titlesRecorded": False,
        "recipientNote": row[7],
        "occurredAt": row[8].isoformat() if hasattr(row[8], "isoformat") else row[8],
        "status": row[9],
        "holdingsTouched": False,
        "provenance": {
            "source": row[11],
            "method": str(row[12]),
            "ruleOrModelVersion": row[13],
            "confidence": _num(row[14]),
            "verificationStatus": str(row[15]),
            "notes": row[16] or None,
        },
        "createdAt": row[17].isoformat() if hasattr(row[17], "isoformat") else row[17],
        "updatedAt": row[18].isoformat() if hasattr(row[18], "isoformat") else row[18],
    }


def fetch_open_event(conn) -> dict | None:
    cur = conn.cursor()
    try:
        cur.execute(OPEN_EVENT_SQL)
        row = cur.fetchone()
    except Exception:
        conn.rollback()
        cur.close()
        return None
    cur.close()
    if not row:
        return None
    return _event_from_row(row)


def create_unknown_exit(conn, body: dict) -> dict:
    """Insert an inferred · unverified event. Does not UPDATE holding."""
    if body.get("titlesRecorded") is not False:
        raise ValueError("titlesRecorded must be false — this path does not accept a title list")
    if body.get("acknowledgeUnknownTitles") is not True:
        raise ValueError("acknowledgeUnknownTitles must be true")
    qty = int(body.get("estimatedQty") or 0)
    if qty < 1:
        raise ValueError("estimatedQty must be at least 1")
    scope = str(body.get("scope") or DEFAULT_SCOPE)
    if scope not in ("general_inventory_bulk", "dealer_inventory_bulk", "operator_named"):
        raise ValueError("invalid scope")
    note = (body.get("recipientNote") or "").strip() or None
    occurred = body.get("occurredAt")
    slice_ = fetch_catalog_slice(conn)
    if slice_["scopeHoldings"] <= 0:
        raise ValueError("No General Inventory holdings to scope this exit against")
    impact = evaluate_unknown_exit_impact(slice_, qty)
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE vault_collection.unknown_exit
           SET status = 'superseded', updated_at = now()
         WHERE status = 'open'
        """
    )
    cur.execute(
        """
        INSERT INTO vault_collection.unknown_exit
            (scope, estimated_qty, estimated_value_low, estimated_value_high,
             titles_recorded, recipient_note, occurred_at, status, holdings_touched,
             prov_source, prov_method, prov_rule_version, prov_confidence,
             prov_verification, prov_notes)
        VALUES (
            %s, %s, %s, %s, FALSE, %s, COALESCE(%s::timestamptz, now()),
            'open', FALSE,
            'operator_report', 'inferred', %s, 0.400, 'unverified', %s
        )
        RETURNING
            id, scope, estimated_qty, estimated_value_low, estimated_value_high,
            currency, titles_recorded, recipient_note, occurred_at, status,
            holdings_touched, prov_source, prov_method, prov_rule_version,
            prov_confidence, prov_verification, prov_notes, created_at, updated_at
        """,
        (
            scope,
            qty,
            impact["physicalValueLow"],
            impact["physicalValueHigh"],
            note,
            occurred,
            UNKNOWN_EXIT_RULE,
            (
                "Unrecorded bulk exit · titles unknown · holdings not deleted. "
                f"{note or ''}"
            ).strip(),
        ),
    )
    row = cur.fetchone()
    cur.close()
    conn.commit()
    event = _event_from_row(row)
    return {"event": event, "impact": impact, "catalog": slice_}


def unknown_exit_payload(conn) -> dict:
    slice_ = fetch_catalog_slice(conn)
    event = fetch_open_event(conn)
    qty = int(event["estimatedQty"]) if event else 0
    impact = evaluate_unknown_exit_impact(slice_, qty) if event else None
    return {"event": event, "impact": impact, "catalog": slice_}


def attach_unknown_exit(conn, meta: dict) -> dict:
    """Overlay open event + impact on comics meta. Safe if table is missing."""
    try:
        payload = unknown_exit_payload(conn)
    except Exception:
        conn.rollback()
        return meta
    meta = dict(meta)
    meta["unknownExit"] = payload
    if payload.get("impact"):
        impact = payload["impact"]
        meta["physicalValueLow"] = impact["physicalValueLow"]
        meta["physicalValueHigh"] = impact["physicalValueHigh"]
        meta["physicalValueLabel"] = (
            f"${impact['physicalValueLow']:,.0f}–${impact['physicalValueHigh']:,.0f} "
            "inferred · unverified"
        )
    return meta
