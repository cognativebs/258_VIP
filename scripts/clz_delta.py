"""Pure CLZ sync delta math — no database, no filesystem.

Existing holdings vs an incoming export. Used by clz_sync and tests.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


def holding_row_id(row: dict[str, Any]) -> str:
    """Match load_comics.py: BP id + hash prefix, else CLZ Hash."""
    explicit = str(row.get("id") or "").strip()
    if explicit:
        return explicit
    bp = str(row.get("BP Comic ID") or "").strip()
    clz = str(row.get("CLZ Hash") or "").strip()
    if bp and clz:
        return f"{bp}-{clz[:8]}"
    return clz


def _price(row: dict[str, Any]) -> float | None:
    raw = row.get("Current Price", row.get("current_price_snapshot"))
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


@dataclass
class ExistingHolding:
    source_row_id: str
    current_price: float | None = None
    dropped_at: datetime | None = None


@dataclass
class ClzDelta:
    added: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    revived: list[str] = field(default_factory=list)
    price_changed: list[str] = field(default_factory=list)
    unchanged: int = 0
    skipped_duplicate_hash: bool = False
    already_current: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_delta(
    existing: dict[str, ExistingHolding],
    incoming: dict[str, dict[str, Any]],
) -> ClzDelta:
    """Compare current CLZ holdings to a parsed export keyed by source_row_id."""
    delta = ClzDelta()
    incoming_ids = set(incoming.keys())
    existing_ids = set(existing.keys())

    for rid in sorted(incoming_ids - existing_ids):
        delta.added.append(rid)

    for rid in sorted(existing_ids & incoming_ids):
        prev = existing[rid]
        new_price = _price(incoming[rid])
        if prev.dropped_at is not None:
            delta.revived.append(rid)
            continue
        price_changed = _prices_differ(prev.current_price, new_price)
        if price_changed:
            delta.price_changed.append(rid)
            delta.updated.append(rid)
        else:
            delta.unchanged += 1

    for rid in sorted(existing_ids - incoming_ids):
        prev = existing[rid]
        if prev.dropped_at is None:
            delta.dropped.append(rid)

    return delta


def _prices_differ(old: float | None, new: float | None) -> bool:
    if old is None and new is None:
        return False
    if old is None or new is None:
        return True
    return abs(old - new) > 0.009


def holding_is_active(rec: dict[str, Any]) -> bool:
    """Comics API / terminal: dropped CLZ rows stay in DB but leave the grid."""
    return rec.get("dropped_at") is None
