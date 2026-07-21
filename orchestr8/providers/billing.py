"""Best-effort account cost/balance snapshots per provider.

Reality (researched):
  - OpenAI:    no balance endpoint. Month-to-date SPEND via /v1/organization/costs
               with an Admin key (OPENAI_ADMIN_KEY, prefix sk-admin-).
  - Anthropic: no balance endpoint. SPEND via /v1/organizations/cost_report with an
               Admin key (ANTHROPIC_ADMIN_KEY, prefix sk-ant-admin-).
  - xAI:       real prepaid BALANCE via management-api.x.ai using a management key
               (XAI_MGMT_KEY) + XAI_TEAM_ID.

Every adapter degrades gracefully: if the key is missing or the call fails, it
returns {"available": False, "reason": ...} instead of raising.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone


def _get_json(url: str, headers: dict, *, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _month_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def openai_snapshot() -> dict:
    key = os.environ.get("OPENAI_ADMIN_KEY")
    if not key:
        return {"available": False, "reason": "Set OPENAI_ADMIN_KEY (sk-admin-…) for spend"}
    start = int(_month_start_utc().timestamp())
    try:
        data = _get_json(
            f"https://api.openai.com/v1/organization/costs?start_time={start}&limit=180",
            {"Authorization": f"Bearer {key}"},
        )
    except urllib.error.HTTPError as e:
        return {"available": False, "reason": f"HTTP {e.code} (admin key / owner role required)"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": str(e)}

    spend = 0.0
    for bucket in data.get("data", []):
        for item in bucket.get("results", []):
            amt = item.get("amount", {})
            spend += float(amt.get("value", 0) or 0)
    return {
        "available": True,
        "kind": "spend_mtd",
        "currency": "USD",
        "spendMtd": round(spend, 4),
        "balance": None,
        "note": "Month-to-date spend (no balance endpoint exists).",
    }


def anthropic_snapshot() -> dict:
    key = os.environ.get("ANTHROPIC_ADMIN_KEY")
    if not key:
        return {"available": False, "reason": "Set ANTHROPIC_ADMIN_KEY (sk-ant-admin-…) for spend"}
    starting_at = _month_start_utc().strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        data = _get_json(
            f"https://api.anthropic.com/v1/organizations/cost_report"
            f"?starting_at={starting_at}&bucket_width=1d",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
    except urllib.error.HTTPError as e:
        return {"available": False, "reason": f"HTTP {e.code} (admin key required)"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": str(e)}

    cents = 0.0
    for bucket in data.get("data", []):
        for item in bucket.get("results", []):
            amt = item.get("amount") or item.get("cost") or {}
            if isinstance(amt, dict):
                cents += float(amt.get("value", 0) or 0)
            else:
                cents += float(amt or 0)
    return {
        "available": True,
        "kind": "spend_mtd",
        "currency": "USD",
        "spendMtd": round(cents / 100.0, 4),
        "balance": None,
        "note": "Month-to-date spend (no balance endpoint exists).",
    }


def xai_snapshot() -> dict:
    key = os.environ.get("XAI_MGMT_KEY")
    team = os.environ.get("XAI_TEAM_ID")
    if not key or not team:
        return {"available": False, "reason": "Set XAI_MGMT_KEY + XAI_TEAM_ID for prepaid balance"}
    try:
        data = _get_json(
            f"https://management-api.x.ai/v1/billing/teams/{team}/prepaid/balance",
            {"Authorization": f"Bearer {key}"},
        )
    except urllib.error.HTTPError as e:
        return {"available": False, "reason": f"HTTP {e.code} (management key / team id)"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": str(e)}

    # total.val is USD cents; negative sign means credit remaining.
    val = None
    try:
        val = float((data.get("total") or {}).get("val"))
    except (TypeError, ValueError):
        val = None
    balance = round(-val / 100.0, 4) if isinstance(val, float) else None
    return {
        "available": True,
        "kind": "balance",
        "currency": "USD",
        "balance": balance,
        "spendMtd": None,
        "note": "Prepaid credit remaining.",
    }


def accounts_snapshot() -> dict:
    return {
        "openai": openai_snapshot(),
        "anthropic": anthropic_snapshot(),
        "grok": xai_snapshot(),
    }
