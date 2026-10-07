"""Pure CLZ DIFF classification. No database, no filesystem writes."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


USER_FIELDS = (
    "Current Price",
    "Quantity",
    "Purchase Price",
    "Purchase Date",
    "Location",
    "Slab Status",
    "Assumed Grade",
    "Grade Rating",
)

OWNERSHIP_FIELDS = frozenset({"Quantity"})
CONDITION_FIELDS = frozenset({"Slab Status", "Assumed Grade", "Grade Rating"})
VALUE_FIELDS = frozenset({"Current Price"})
METADATA_FIELDS = frozenset({"Purchase Price", "Purchase Date", "Location"})


@dataclass
class ExistingClzHolding:
    source_row_id: str
    current_price: float | None = None
    quantity: int | None = None
    purchase_price: float | None = None
    purchase_date: str | None = None
    location: str | None = None
    slab_status: str | None = None
    assumed_grade: str | None = None
    grade_rating: float | None = None
    possibly_sold: bool = False
    canonical_name: str | None = None
    asset_id: str | None = None
    has_vendor_map: bool = False
    slug: str | None = None


@dataclass
class ClzDiffRow:
    source_row_id: str
    classification: str
    changed_fields: list[str] = field(default_factory=list)
    change_types: list[str] = field(default_factory=list)
    possibly_sold: bool = False
    canonical_name: str | None = None
    clz_value: float | None = None
    quantity: int | None = None
    needs_fresh_vendor_map: bool = False


def change_types_for(classification: str, changed_fields: list[str]) -> list[str]:
    """Exclusive buckets first; a row can carry more than one non-metadata type."""
    fields = set(changed_fields)
    types: list[str] = []
    if classification == "new":
        types.append("ownership_new")
        return types
    if classification == "disappeared":
        types.append("ownership_sold")
        return types
    if fields & OWNERSHIP_FIELDS:
        types.append("ownership_quantity")
    if fields & CONDITION_FIELDS:
        types.append("condition_grade")
    if fields & VALUE_FIELDS:
        types.append("clz_value_drift")
    leftover = fields - OWNERSHIP_FIELDS - CONDITION_FIELDS - VALUE_FIELDS
    if leftover and not (fields & (OWNERSHIP_FIELDS | CONDITION_FIELDS | VALUE_FIELDS)):
        types.append("metadata_only")
    return types


@dataclass
class ClzDiffCounts:
    new: list[ClzDiffRow] = field(default_factory=list)
    changed: list[ClzDiffRow] = field(default_factory=list)
    unchanged: list[ClzDiffRow] = field(default_factory=list)
    disappeared: list[ClzDiffRow] = field(default_factory=list)

    def all_rows(self) -> list[ClzDiffRow]:
        return [*self.new, *self.changed, *self.unchanged, *self.disappeared]

    def as_dict(self) -> dict[str, Any]:
        return {
            "new": [asdict(r) for r in self.new],
            "changed": [asdict(r) for r in self.changed],
            "unchanged": [asdict(r) for r in self.unchanged],
            "disappeared": [asdict(r) for r in self.disappeared],
        }


def _num(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _int(raw: Any) -> int | None:
    n = _num(raw)
    return None if n is None else int(n)


def _str(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def incoming_user_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "Current Price": _num(row.get("Current Price", row.get("current_price_snapshot"))),
        "Quantity": _int(row.get("Quantity", row.get("quantity"))),
        "Purchase Price": _num(row.get("Purchase Price", row.get("purchase_price"))),
        "Purchase Date": _str(row.get("Purchase Date", row.get("purchase_date"))),
        "Location": _str(row.get("Location", row.get("location"))),
        "Slab Status": _str(row.get("Slab Status", row.get("slab_status"))),
        "Assumed Grade": _str(row.get("Assumed Grade", row.get("assumed_grade"))),
        "Grade Rating": _num(row.get("Grade Rating", row.get("grade_rating"))),
    }


def existing_user_fields(row: ExistingClzHolding) -> dict[str, Any]:
    return {
        "Current Price": row.current_price,
        "Quantity": row.quantity,
        "Purchase Price": row.purchase_price,
        "Purchase Date": _str(row.purchase_date),
        "Location": row.location,
        "Slab Status": row.slab_status,
        "Assumed Grade": row.assumed_grade,
        "Grade Rating": row.grade_rating,
    }


def _values_differ(field: str, old: Any, new: Any) -> bool:
    if field in {"Current Price", "Purchase Price", "Grade Rating"}:
        if old is None and new is None:
            return False
        if old is None or new is None:
            return True
        return abs(float(old) - float(new)) > 0.009
    return old != new


def classify_clz_diff(
    existing: dict[str, ExistingClzHolding],
    incoming: dict[str, dict[str, Any]],
) -> ClzDiffCounts:
    """Match CLZ record id -> holding.source_row_id. Never deletes."""
    out = ClzDiffCounts()
    incoming_ids = set(incoming)
    existing_ids = set(existing)

    for rid in sorted(incoming_ids - existing_ids):
        incoming_fields = incoming_user_fields(incoming[rid])
        out.new.append(
            ClzDiffRow(
                rid,
                "new",
                change_types=change_types_for("new", []),
                canonical_name=_incoming_title(incoming[rid]),
                clz_value=incoming_fields["Current Price"],
                quantity=incoming_fields["Quantity"],
            )
        )

    for rid in sorted(incoming_ids & existing_ids):
        prev = existing[rid]
        incoming_fields = incoming_user_fields(incoming[rid])
        changed = [
            field
            for field in USER_FIELDS
            if _values_differ(field, existing_user_fields(prev)[field], incoming_fields[field])
        ]
        row = ClzDiffRow(
            rid,
            "changed" if changed else "unchanged",
            changed_fields=changed,
            change_types=change_types_for("changed" if changed else "unchanged", changed),
            canonical_name=prev.canonical_name or _incoming_title(incoming[rid]),
            clz_value=incoming_fields["Current Price"] if incoming_fields["Current Price"] is not None else prev.current_price,
            quantity=incoming_fields["Quantity"] if incoming_fields["Quantity"] is not None else prev.quantity,
        )
        if changed:
            out.changed.append(row)
        else:
            out.unchanged.append(row)

    for rid in sorted(existing_ids - incoming_ids):
        prev = existing[rid]
        out.disappeared.append(
            ClzDiffRow(
                rid,
                "disappeared",
                change_types=change_types_for("disappeared", []),
                possibly_sold=False,
                canonical_name=prev.canonical_name,
                clz_value=prev.current_price,
                quantity=prev.quantity,
            )
        )

    return out


def _incoming_title(row: dict[str, Any]) -> str | None:
    series = str(row.get("Series") or "").strip()
    issue = str(row.get("Issue Full") or row.get("Issue") or "").strip()
    if series and issue:
        return f"{series} #{issue}"
    return series or None
