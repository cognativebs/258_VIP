#!/usr/bin/env python3
"""Score staged IQVault scans against plan 0001 Phase 1/2 gates.

Run on the machine whose Postgres has the scans (desktop IQVault, not an
empty cloud snapshot):

    python scripts/score_scan_identification.py
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from typing import Any


def _sources(ext: Any) -> list[str]:
    if not isinstance(ext, list):
        return []
    out: list[str] = []
    for row in ext:
        if isinstance(row, dict) and row.get("source"):
            out.append(str(row["source"]).lower())
    return out


def _ratio(correct: int, total: int) -> float | None:
    if total == 0:
        return None
    return round(correct / total, 4)


def score_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("category") in ("pokemon", "mtg"):
            by_cat[row["category"]].append(row)

    def slice_for(category: str, required: str, min_units: int, target: float) -> dict[str, Any]:
        units = by_cat.get(category, [])
        with_candidate = 0
        top1_has = 0
        all_have = 0
        holding_writes = 0
        scored = 0
        correct = 0
        for row in units:
            count = int(row.get("candidateCount") or 0)
            with_req = int(row.get("candidatesWithRequiredId") or 0)
            if count > 0:
                with_candidate += 1
            if required in (row.get("externalSources") or []):
                top1_has += 1
            if count > 0 and with_req == count:
                all_have += 1
            if row.get("holdingWritten"):
                holding_writes += 1
            if row.get("confirmedCorrect") is True:
                scored += 1
                correct += 1
            elif row.get("confirmedCorrect") is False:
                scored += 1
        accuracy = _ratio(correct, scored)
        blockers: list[str] = []
        if len(units) < min_units:
            blockers.append(f"need {min_units} {category} scans, have {len(units)}")
        if units and all_have < len(units):
            blockers.append(
                f"{len(units) - all_have} {category} unit(s) missing {required} on every candidate"
            )
        if accuracy is None:
            blockers.append(
                f"{category} top-1 accuracy is unknown until confirm/correct in Review"
            )
        elif accuracy < target:
            blockers.append(f"{category} top-1 {accuracy} < {target}")
        return {
            "category": category,
            "requiredExternalSource": required,
            "units": len(units),
            "withCandidate": with_candidate,
            "top1HasRequiredId": top1_has,
            "allCandidatesHaveRequiredId": all_have,
            "holdingWrites": holding_writes,
            "scoredForAccuracy": scored,
            "top1Correct": correct,
            "top1Accuracy": accuracy,
            "minUnits": min_units,
            "top1Target": target,
            "passed": not blockers,
            "blockers": blockers,
        }

    return {
        "pokemon": slice_for("pokemon", "tcgdex", 25, 0.8),
        "mtg": slice_for("mtg", "scryfall", 25, 0.85),
        "units": rows,
    }


def load_from_db(dsn: str) -> list[dict[str, Any]]:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(dsn)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        """
        SELECT
          u.id,
          u.category_hint,
          u.holding_id,
          obs.was_correct,
          COALESCE((
            SELECT json_agg(json_build_object(
              'displayName', c.display_name,
              'adapterId', c.adapter_id,
              'confidence', c.confidence,
              'category', c.category,
              'externalIds', c.external_ids
            ) ORDER BY c.confidence DESC)
            FROM vault_media.scan_unit_candidate c
            WHERE c.unit_id = u.id
          ), '[]'::json) AS candidates
        FROM vault_media.scan_unit u
        LEFT JOIN vault_market.id_observation obs
          ON obs.id::text = u.id_observation_ref
        ORDER BY u.created_at DESC
        """
    )
    rows: list[dict[str, Any]] = []
    for raw in cur.fetchall():
        candidates = raw["candidates"] or []
        if isinstance(candidates, str):
            candidates = json.loads(candidates)
        top = candidates[0] if candidates else None
        category = (top or {}).get("category") or raw["category_hint"]
        if category not in ("pokemon", "mtg"):
            continue
        required = "tcgdex" if category == "pokemon" else "scryfall"
        with_req = sum(
            1
            for c in candidates
            if required in _sources(c.get("externalIds"))
        )
        rows.append(
            {
                "unitId": str(raw["id"]),
                "category": category,
                "displayName": (top or {}).get("displayName"),
                "adapterId": (top or {}).get("adapterId"),
                "confidence": float(top["confidence"]) if top and top.get("confidence") is not None else None,
                "externalSources": _sources((top or {}).get("externalIds")),
                "candidateCount": len(candidates),
                "candidatesWithRequiredId": with_req,
                "holdingWritten": bool(raw["holding_id"]),
                "confirmedCorrect": raw["was_correct"],
            }
        )
    cur.close()
    conn.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dsn",
        default="dbname=iqvault user=postgres password=vault host=localhost",
    )
    args = ap.parse_args()
    try:
        rows = load_from_db(args.dsn)
    except Exception as exc:  # noqa: BLE001 — operator-facing CLI
        print(f"could not read scan units: {exc}", file=sys.stderr)
        return 1
    report = score_rows(rows)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    poke = report["pokemon"]
    mtg = report["mtg"]
    print(
        f"# pokemon {poke['units']}/25 passed={poke['passed']} blockers={poke['blockers']}",
        file=sys.stderr,
    )
    print(
        f"# mtg {mtg['units']}/25 passed={mtg['passed']} blockers={mtg['blockers']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
