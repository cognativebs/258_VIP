"""Comics liquidation dry-run. No listings. No holding.location writes. Phase 2 off."""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg2
import psycopg2.extras

DSN = "dbname=iqvault user=postgres password=vault host=localhost"
OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "liquidation"
GENERATED_AT = datetime.now(timezone.utc).isoformat()

SINGLE_FVF = 0.13
SINGLE_SHIP = 1.50
LOT_FVF = 0.13
LOT_SHIP = 8.00
LOT_TARGET = 12
LOT_MAX = 20
LOT_MIN = 3
BULK_FVF = 0.13
BULK_PILE = 50
BULK_SHIP = 15.00
ASK_GUIDE_MEDIAN = 1.6
ASK_N_MIN = 5

P98_COMIC = {
    "ca856cde-c86e-4b65-8f61-f53488710a6a": "The Amazing Spider-Man, Vol. 1 #90",
    "5a70f269-5064-439e-8f24-f386858b6709": "The Amazing Spider-Man, Vol. 1 #301A (Direct Edition)",
    "61ca95cb-8df6-4a77-a73d-930707013a46": "Captain America Living Legend #2A",
}
P98_TCG = {
    "5bdeeea0-732b-486a-8f41-199baaf34783": "XY Black Star Promos #XY76 Zekrom",
    "46980eaf-fc98-42a7-a73d-930707013a46": "Pitch Black #120 Mega Darkrai ex",
}

VAULT_KEY_PILLARS = {
    "Batman",
    "Absolute Universe",
    "Spider-Man",
    "X-Men",
    "Superman",
    "First Appearances",
    "Cover Art & Favorite Artists",
    "Bronze & Silver Age Keys",
    "Investment Portfolio",
    "Good Girl / Risqué Covers",
    "Personal Favorites",
}
SELL_PILLARS = {"Sci-Fi", "Horror", "Independent", "General Inventory"}

BOX_FLOOR = 150
OVERPACK_PER_BOX = 220


def money(n: float) -> float:
    return round(float(n) + 1e-12, 2)


def num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def condition_key(slab: str | None, grade_rating: float | None) -> str:
    slab_l = (slab or "").strip().lower()
    g = grade_rating or 0.0
    graded = slab_l not in {"", "raw"} and "raw" not in slab_l
    if not graded and g <= 0:
        return "raw_ungraded"
    if g >= 9.9:
        return "graded_10"
    if g >= 9.6:
        return "graded_9_8"
    if g >= 9.3:
        return "graded_9_4"
    if g >= 9.0:
        return "graded_9_2"
    if g >= 7.5:
        return "graded_8"
    if g >= 5.5:
        return "graded_6"
    if g >= 3.5:
        return "graded_4"
    return "raw_ungraded"


def is_graded_slab(slab: str | None, grade_rating: float | None) -> bool:
    slab_l = (slab or "").strip().lower()
    if slab_l in {"", "raw"} or "raw" in slab_l:
        return False
    return True


def is_key(is_key_issue: bool, clz_key: str | None) -> bool:
    if is_key_issue:
        return True
    k = (clz_key or "").strip().lower()
    return k not in {"", "no", "false", "0"}


def issue_num(issue: str | None) -> int | None:
    if not issue:
        return None
    m = re.search(r"\d+", str(issue))
    return int(m.group()) if m else None


def net_single(gross: float) -> float:
    return money(max(0.0, gross * (1.0 - SINGLE_FVF) - SINGLE_SHIP))


def pick_gross(guide: float | None, median_ask: float | None, ask_n: int, clz: float | None):
    if guide is not None and guide > 0:
        return guide, "guide", 0.75
    if median_ask is not None and ask_n >= ASK_N_MIN and median_ask > 0:
        est = median_ask / ASK_GUIDE_MEDIAN
        return est, "ebay_ask", 0.55
    if clz is not None and clz > 0:
        return clz, "clz", 0.25
    return 0.0, "none", 0.0


HOLDINGS_SQL = """
SELECT
  h.id AS holding_id,
  h.source_row_id,
  h.asset_id,
  h.quantity,
  h.current_price_snapshot,
  h.collection_pillar,
  h.recommendation,
  h.needs_verification,
  h.verification_notes,
  h.slab_status,
  h.grade_rating,
  h.assumed_grade,
  h.location,
  a.canonical_name,
  s.title AS series_title,
  s.publisher,
  i.issue_number,
  i.is_key_issue,
  v.cover_label,
  h.clz_metadata->>'Is Key Comic' AS clz_key,
  h.clz_metadata->>'Barcode' AS barcode,
  m.confirmed_at IS NOT NULL AS map_confirmed,
  m.needs_review AS map_needs_review,
  m.match_confidence
FROM vault_collection.holding h
JOIN vault_core.asset a ON a.id = h.asset_id
JOIN vault_comic.variant v ON v.asset_id = a.id
JOIN vault_comic.issue i ON i.id = v.issue_id
JOIN vault_comic.series s ON s.id = i.series_id
LEFT JOIN LATERAL (
  SELECT confirmed_at, needs_review, match_confidence
  FROM vault_market.vendor_product_map vpm
  WHERE vpm.asset_id = h.asset_id
    AND vpm.confirmed_at IS NOT NULL
  ORDER BY vpm.confirmed_at DESC
  LIMIT 1
) m ON TRUE
WHERE h.source = 'clz_import'
  AND h.dropped_at IS NULL
ORDER BY s.title, i.issue_number, v.cover_label
"""

GUIDE_SQL = """
SELECT DISTINCT ON (asset_id, condition_key)
  asset_id, condition_key, guide_price::float AS guide_price
FROM vault_market.v_guide_price_baseline
WHERE observation_kind = 'guide_quote'
  AND guide_price IS NOT NULL
ORDER BY asset_id, condition_key, snapshot_on DESC, observed_at DESC
"""

ASK_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (listing_id)
    asset_id, ask_price::float AS ask_price
  FROM vault_market.listing_observation
  WHERE observation_kind = 'browse_listing'
    AND ask_price IS NOT NULL
  ORDER BY listing_id, observed_at DESC
)
SELECT
  asset_id,
  count(*)::int AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ask_price) AS median_ask
FROM latest
GROUP BY asset_id
HAVING count(*) >= %s
"""


def chunk_run(rows: list[dict], target: int = LOT_TARGET, max_n: int = LOT_MAX) -> list[list[dict]]:
    if len(rows) <= max_n:
        return [rows]
    chunks = []
    i = 0
    n = len(rows)
    while i < n:
        remaining = n - i
        if remaining <= max_n:
            chunks.append(rows[i:])
            break
        take = target if remaining - target >= LOT_MIN else remaining // 2
        take = max(LOT_MIN, min(max_n, take))
        chunks.append(rows[i : i + take])
        i += take
    return chunks


def group_lots(lot_books: list[dict]) -> list[dict]:
    by_series: dict[str, list[dict]] = defaultdict(list)
    for b in lot_books:
        by_series[b["series"]].append(b)

    lots = []
    leftovers = []
    for series, books in by_series.items():
        books.sort(key=lambda x: (issue_num(x["issue"]) or 10**9, x["name"]))
        if len(books) >= LOT_MIN:
            for i, chunk in enumerate(chunk_run(books), start=1):
                lots.append(
                    {
                        "lotId": f"LOT-{re.sub(r'[^A-Za-z0-9]+', '', series)[:18].upper()}-{i:02d}",
                        "kind": "series_run",
                        "label": series if len(chunk_run(books)) == 1 else f"{series} (part {i})",
                        "books": chunk,
                    }
                )
        else:
            leftovers.extend(books)

    by_pillar: dict[str, list[dict]] = defaultdict(list)
    for b in leftovers:
        by_pillar[b["pillar"] or "Mixed"].append(b)
    leftovers2 = []
    for pillar, books in by_pillar.items():
        books.sort(key=lambda x: (x["series"], issue_num(x["issue"]) or 10**9))
        if len(books) >= LOT_MIN:
            for i, chunk in enumerate(chunk_run(books), start=1):
                lots.append(
                    {
                        "lotId": f"LOT-{re.sub(r'[^A-Za-z0-9]+', '', pillar)[:14].upper()}-{i:02d}",
                        "kind": "character_pillar",
                        "label": f"{pillar} mix" if len(chunk_run(books)) == 1 else f"{pillar} mix (part {i})",
                        "books": chunk,
                    }
                )
        else:
            leftovers2.extend(books)

    leftovers2.sort(key=lambda x: (x["series"], issue_num(x["issue"]) or 10**9))
    for i, chunk in enumerate(chunk_run(leftovers2, target=10, max_n=15) if leftovers2 else [], start=1):
        lots.append(
            {
                "lotId": f"LOT-MIXED-{i:02d}",
                "kind": "mixed",
                "label": f"Mixed remaining {i}",
                "books": chunk,
            }
        )
    return lots


def assign_boxes(items: list[dict], box_ids: list[str], group_key: str | None = None) -> None:
    """Fill each box to at least BOX_FLOOR, then overflow to the next; last box takes the rest."""
    if not items:
        return
    if group_key:
        groups: dict[str, list[dict]] = defaultdict(list)
        for it in items:
            groups[it.get(group_key) or "_"].append(it)
        ordered = []
        for g in groups.values():
            ordered.extend(g)
        items[:] = ordered

    n_boxes = len(box_ids)
    if n_boxes == 1:
        for it in items:
            it["boxId"] = box_ids[0]
        return

    # Put at least BOX_FLOOR in each box except we may not have enough.
    remaining = list(items)
    for i, box in enumerate(box_ids):
        is_last = i == n_boxes - 1
        if is_last:
            for it in remaining:
                it["boxId"] = box
            remaining = []
            break
        take = min(max(BOX_FLOOR, 0), len(remaining))
        # If leftover after this take would be tiny, dump into this box... no, last absorbs overflow.
        if len(remaining) - BOX_FLOOR < BOX_FLOOR and i == n_boxes - 2:
            # leave at least something for last if possible, else last can be under floor
            take = max(BOX_FLOOR, len(remaining) - max(0, len(remaining) // 2))
            take = min(take, len(remaining))
        for it in remaining[:BOX_FLOOR]:
            it["boxId"] = box
        remaining = remaining[BOX_FLOOR:]
    for it in remaining:
        it["boxId"] = box_ids[-1]


def main() -> None:
    conn = psycopg2.connect(DSN)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(HOLDINGS_SQL)
    holdings = [dict(r) for r in cur.fetchall()]
    cur.execute(GUIDE_SQL)
    guides = {(str(r["asset_id"]), r["condition_key"]): r["guide_price"] for r in cur.fetchall()}
    cur.execute(ASK_SQL, (ASK_N_MIN,))
    asks = {str(r["asset_id"]): (int(r["n"]), float(r["median_ask"])) for r in cur.fetchall()}
    conn.close()

    books = []
    for h in holdings:
        asset_id = str(h["asset_id"])
        qty = int(h["quantity"] or 1)
        ck = condition_key(h["slab_status"], num(h["grade_rating"]))
        guide = guides.get((asset_id, ck))
        if guide is None and ck != "raw_ungraded":
            guide = guides.get((asset_id, "raw_ungraded"))
        ask_n, median_ask = asks.get(asset_id, (0, None))
        clz = num(h["current_price_snapshot"])
        unit_gross, source, conf = pick_gross(guide, median_ask, ask_n, clz)
        gross = unit_gross * qty
        ns = net_single(gross)
        pillar = (h["collection_pillar"] or "").strip()
        rec = (h["recommendation"] or "").strip()
        museum = rec == "Museum Candidate"
        graded = is_graded_slab(h["slab_status"], num(h["grade_rating"]))
        key = is_key(bool(h["is_key_issue"]), h["clz_key"])
        sci_fi_sell = pillar == "Sci-Fi"
        vault_key = key and pillar in VAULT_KEY_PILLARS and not sci_fi_sell
        p98 = asset_id in P98_COMIC
        unmatched = not bool(h["map_confirmed"])
        no_source = source == "none"

        vault_reasons = []
        if museum:
            vault_reasons.append("museum")
        if graded:
            vault_reasons.append("graded_slab")
        if vault_key:
            vault_reasons.append("pillar_key")

        if vault_reasons and not p98:
            disp = "VAULT"
        elif p98:
            disp = "GRADE"
        elif unmatched and source in {"none", "clz"}:
            disp = "HOLD"
        elif no_source:
            disp = "HOLD"
        elif ns >= 20:
            disp = "SELL_SINGLE"
        elif ns >= 5:
            disp = "SELL_LOT"
        else:
            disp = "BULK"

        if disp == "VAULT" and p98:
            disp = "GRADE"

        books.append(
            {
                "holdingId": str(h["holding_id"]),
                "sourceRowId": h["source_row_id"],
                "assetId": asset_id,
                "name": h["canonical_name"],
                "series": h["series_title"] or "",
                "issue": h["issue_number"] or "",
                "cover": h["cover_label"] or "",
                "publisher": h["publisher"] or "",
                "pillar": pillar,
                "qty": qty,
                "slab": h["slab_status"] or "",
                "conditionKey": ck,
                "recommendation": rec,
                "needsVerification": bool(h["needs_verification"]),
                "mapConfirmed": bool(h["map_confirmed"]),
                "gross": money(gross),
                "netSingle": ns,
                "priceSource": source,
                "confidence": conf,
                "guide": money(guide) if guide else None,
                "medianAsk": money(median_ask) if median_ask else None,
                "askN": ask_n,
                "clz": money(clz) if clz else None,
                "disposition": disp,
                "vaultReasons": vault_reasons,
                "p98": p98,
                "isKey": key,
                "museum": museum,
                "graded": graded,
                "barcode": h["barcode"] or "",
                "locationProposed": None,
                "boxId": None,
                "lotId": None,
                "netRealizable": 0.0,
            }
        )

    vault = [b for b in books if b["disposition"] == "VAULT"]
    grade = [b for b in books if b["disposition"] == "GRADE"]
    hold = [b for b in books if b["disposition"] == "HOLD"]
    singles = [b for b in books if b["disposition"] == "SELL_SINGLE"]
    lot_books = [b for b in books if b["disposition"] == "SELL_LOT"]
    bulk = [b for b in books if b["disposition"] == "BULK"]

    for b in singles:
        b["netRealizable"] = b["netSingle"]
    for b in vault + grade + hold:
        b["netRealizable"] = 0.0

    lots = group_lots(lot_books)
    lot_summaries = []
    for lot in lots:
        g = sum(x["gross"] for x in lot["books"])
        n = money(max(0.0, g * (1.0 - LOT_FVF) - LOT_SHIP))
        lot["gross"] = money(g)
        lot["net"] = n
        lot["count"] = len(lot["books"])
        for x in lot["books"]:
            x["lotId"] = lot["lotId"]
            share = (x["gross"] / g) if g else 0
            x["netRealizable"] = money(n * share)
        lot_summaries.append(
            {
                "lotId": lot["lotId"],
                "kind": lot["kind"],
                "label": lot["label"],
                "count": lot["count"],
                "gross": lot["gross"],
                "net": lot["net"],
                "titles": [x["name"] for x in lot["books"][:8]],
            }
        )

    bulk.sort(key=lambda x: (-x["gross"], x["series"], x["name"]))
    bulk_net = 0.0
    bulk_piles = []
    for i in range(0, len(bulk), BULK_PILE):
        pile = bulk[i : i + BULK_PILE]
        g = sum(x["gross"] for x in pile)
        n = money(max(0.0, g * (1.0 - BULK_FVF) - BULK_SHIP))
        bulk_net += n
        pile_id = f"PILE-{i // BULK_PILE + 1:02d}"
        bulk_piles.append({"pileId": pile_id, "count": len(pile), "gross": money(g), "net": n})
        for x in pile:
            share = (x["gross"] / g) if g else 0
            x["netRealizable"] = money(n * share)
            x["lotId"] = pile_id

    singles.sort(key=lambda x: -x["netRealizable"])
    sale = singles + lot_books + bulk
    sale_sorted = sorted(sale, key=lambda x: -x["netRealizable"])
    headline = money(sum(b["netRealizable"] for b in sale))

    def bucket(rows, label):
        net = money(sum(b["netRealizable"] for b in rows))
        n = len(rows)
        copies = sum(b["qty"] for b in rows)
        return {
            "disposition": label,
            "books": n,
            "copies": copies,
            "net": net,
            "effort": money(net / n) if n else 0.0,
        }

    buckets = [
        bucket(vault, "VAULT"),
        bucket(grade, "GRADE"),
        bucket(singles, "SELL_SINGLE"),
        bucket(lot_books, "SELL_LOT"),
        bucket(bulk, "BULK"),
        bucket(hold, "HOLD"),
    ]

    curve = []
    running = 0.0
    targets = [2000, 4000, 6000, 8000, 10000]
    hit = {t: None for t in targets}
    for i, b in enumerate(sale_sorted, start=1):
        running += b["netRealizable"]
        for t in targets:
            if hit[t] is None and running >= t:
                hit[t] = i
        curve.append({"n": i, "net": money(running)})
    curve_points = []
    for step in [1, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000]:
        if step <= len(curve):
            curve_points.append(curve[step - 1])
    if curve:
        curve_points.append(curve[-1])

    top100 = sale_sorted[:100]
    top100_net = money(sum(b["netRealizable"] for b in top100))
    top100_pct = round(100.0 * top100_net / headline, 1) if headline else 0.0

    by_src = defaultdict(float)
    for b in sale:
        by_src[b["priceSource"]] += b["netRealizable"]
    conf_split = {
        k: {"net": money(v), "pct": round(100.0 * v / headline, 1) if headline else 0.0}
        for k, v in sorted(by_src.items(), key=lambda kv: -kv[1])
    }

    reachable = headline
    ten_k = reachable >= 10000

    # Box assignment: fill to 150 floor then overflow last box.
    vault.sort(key=lambda x: (x["pillar"], x["series"], issue_num(x["issue"]) or 0))
    assign_boxes(vault, ["VAULT-01"])
    hold_box = sorted(grade + hold, key=lambda x: (0 if x["p98"] else 1, x["series"], x["name"]))
    assign_boxes(hold_box, ["HOLD-01"])
    assign_boxes(singles, ["SELL-S-01", "SELL-S-02"])
    # lots packed together
    lot_ordered = []
    for lot in lots:
        lot_ordered.extend(lot["books"])
    assign_boxes(lot_ordered, ["SELL-L-01", "SELL-L-02"], group_key="lotId")

    def box_stats(box_id, rows, boxed=True):
        in_box = [b for b in rows if b.get("boxId") == box_id]
        return {
            "boxId": box_id,
            "count": len(in_box),
            "floor": BOX_FLOOR,
            "underFloor": len(in_box) < BOX_FLOOR,
            "overpackRecommend": len(in_box) > OVERPACK_PER_BOX,
            "net": money(sum(b["netRealizable"] for b in in_box)),
            "disposition": in_box[0]["disposition"] if in_box else None,
        }

    boxes = [
        box_stats("VAULT-01", vault),
        box_stats("HOLD-01", hold_box),
        box_stats("SELL-S-01", singles),
        box_stats("SELL-S-02", singles),
        box_stats("SELL-L-01", lot_ordered),
        box_stats("SELL-L-02", lot_ordered),
    ]

    def overflow_note(label, n, allocated_boxes):
        cap_soft = allocated_boxes * OVERPACK_PER_BOX
        extra = max(0, n - cap_soft)
        extra_net = 0.0
        return extra, extra_net, n > cap_soft

    fit = []
    for label, rows, n_boxes, box_ids in [
        ("VAULT", vault, 1, ["VAULT-01"]),
        ("HOLD+GRADE", hold_box, 1, ["HOLD-01"]),
        ("SELL_SINGLE", singles, 2, ["SELL-S-01", "SELL-S-02"]),
        ("SELL_LOT", lot_books, 2, ["SELL-L-01", "SELL-L-02"]),
        ("BULK", bulk, 0, []),
    ]:
        n = len(rows)
        net = money(sum(b["netRealizable"] for b in rows))
        if n_boxes == 0:
            fit.append(
                {
                    "bucket": label,
                    "books": n,
                    "net": net,
                    "boxes": 0,
                    "fits": True,
                    "overflowBooks": n,
                    "overflowNet": net,
                    "recommendExtraBoxes": 0,
                    "note": "No box — loose pile by design.",
                }
            )
            continue
        soft = n_boxes * OVERPACK_PER_BOX
        overflow = max(0, n - soft)
        extra_boxes = math.ceil(n / OVERPACK_PER_BOX) - n_boxes if n > soft else 0
        # overflow dollars = books that would not fit even overpacked, cheapest last
        ranked = sorted(rows, key=lambda x: -x["netRealizable"])
        overflow_rows = ranked[soft:] if overflow else []
        fit.append(
            {
                "bucket": label,
                "books": n,
                "net": net,
                "boxes": n_boxes,
                "floorTotal": n_boxes * BOX_FLOOR,
                "softCap": soft,
                "fits": overflow == 0,
                "overflowBooks": overflow,
                "overflowNet": money(sum(b["netRealizable"] for b in overflow_rows)),
                "recommendExtraBoxes": extra_boxes,
                "under60": label == "VAULT" and n < 60,
                "underFloor": n < BOX_FLOOR,
                "note": (
                    "Under ~60 — consider drawer storage and reassign VAULT-01 to SELL_SINGLE."
                    if label == "VAULT" and n < 60
                    else (
                        f"Buy {extra_boxes} more box(es) rather than overpack."
                        if extra_boxes
                        else (
                            f"Under {BOX_FLOOR} floor — box still assigned, not padded."
                            if n < BOX_FLOOR
                            else "Fits allocated boxes (150 floor, overflow allowed up to ~220/box)."
                        )
                    )
                ),
            }
        )

    # Locations
    for b in vault:
        b["locationProposed"] = "VAULT-01"
    for b in hold_box:
        b["locationProposed"] = "HOLD-01"
    for b in singles:
        b["locationProposed"] = b["boxId"]
    for b in lot_books:
        b["locationProposed"] = b["boxId"]
    for i, b in enumerate(bulk):
        shelf = f"SHELF-BULK-{(i // 80) + 1:02d}"
        b["locationProposed"] = shelf
        b["boxId"] = None

    shelves = defaultdict(int)
    for b in bulk:
        shelves[b["locationProposed"]] += 1

    # Pick list: each book once, boxed first then bulk shelves
    pick = []
    order_boxes = ["VAULT-01", "HOLD-01", "SELL-S-01", "SELL-S-02", "SELL-L-01", "SELL-L-02"]
    by_box = defaultdict(list)
    for b in books:
        if b["boxId"]:
            by_box[b["boxId"]].append(b)
    seq = 1
    for box in order_boxes:
        rows = sorted(by_box.get(box, []), key=lambda x: (x.get("lotId") or "", x["series"], issue_num(x["issue"]) or 0, x["name"]))
        for b in rows:
            pick.append(
                {
                    "seq": seq,
                    "boxId": box,
                    "location": b["locationProposed"],
                    "lotId": b.get("lotId"),
                    "name": b["name"],
                    "holdingId": b["holdingId"],
                    "disposition": b["disposition"],
                    "net": b["netRealizable"],
                }
            )
            seq += 1
    for loc in sorted({b["locationProposed"] for b in bulk}):
        rows = [b for b in bulk if b["locationProposed"] == loc]
        for b in rows:
            pick.append(
                {
                    "seq": seq,
                    "boxId": None,
                    "location": loc,
                    "lotId": b.get("lotId"),
                    "name": b["name"],
                    "holdingId": b["holdingId"],
                    "disposition": "BULK",
                    "net": b["netRealizable"],
                }
            )
            seq += 1

    p98_status = []
    found_p98 = {b["assetId"] for b in books if b["p98"]}
    for aid, name in P98_COMIC.items():
        hits = [b for b in books if b["assetId"] == aid]
        p98_status.append(
            {
                "assetId": aid,
                "name": name,
                "holdings": len(hits),
                "disposition": hits[0]["disposition"] if hits else "NOT_IN_COMICS",
            }
        )
    tcg_note = [{"assetId": k, "name": v, "disposition": "OUT_OF_SCOPE_TCG"} for k, v in P98_TCG.items()]

    pillar_counts = defaultdict(lambda: defaultdict(int))
    for b in books:
        pillar_counts[b["pillar"] or "(none)"][b["disposition"]] += 1

    labels = [
        {"boxId": "VAULT-01", "barcode": "VAULT-01", "symbology": "CODE128", "title": "VAULT — museum, pillar keys, graded"},
        {"boxId": "HOLD-01", "barcode": "HOLD-01", "symbology": "CODE128", "title": "HOLD/GRADE — p98 + unmatched/no source"},
        {"boxId": "SELL-S-01", "barcode": "SELL-S-01", "symbology": "CODE128", "title": "SELL SINGLE 1 — net ≥ $20"},
        {"boxId": "SELL-S-02", "barcode": "SELL-S-02", "symbology": "CODE128", "title": "SELL SINGLE 2 — net ≥ $20"},
        {"boxId": "SELL-L-01", "barcode": "SELL-L-01", "symbology": "CODE128", "title": "SELL LOT 1 — packed by lot"},
        {"boxId": "SELL-L-02", "barcode": "SELL-L-02", "symbology": "CODE128", "title": "SELL LOT 2 — packed by lot"},
    ]

    summary = {
        "generatedAt": GENERATED_AT,
        "dryRun": True,
        "writes": "none — holding.location untouched, no listings, Phase 2 off",
        "rates": {
            "single": "13% FVF + $1.50 shipping per book",
            "lot": "13% FVF + $8.00 media-mail per lot (target 12, max 20 books)",
            "bulk": "13% FVF + $15.00 per 50-book pile",
            "ebayHaircut": "median ask / 1.6 (observed ask/guide median 1.6)",
            "guide": "PriceCharting baseline-eligible only, condition-matched",
            "clz": "last resort, confidence 0.25",
        },
        "headlineNet": headline,
        "tenKReachableWithoutVault": ten_k,
        "reachableWithoutVault": headline,
        "saleBooks": len(sale),
        "vaultBooks": len(vault),
        "gradeBooks": len(grade),
        "holdBooks": len(hold),
        "buckets": buckets,
        "curveHits": {str(k): v for k, v in hit.items()},
        "curvePoints": curve_points,
        "top100": {"net": top100_net, "pctOfSale": top100_pct, "books": [{"name": b["name"], "net": b["netRealizable"], "source": b["priceSource"], "disp": b["disposition"]} for b in top100[:25]]},
        "confidenceSplit": conf_split,
        "lots": lot_summaries,
        "bulkPiles": bulk_piles,
        "boxes": boxes,
        "fit": fit,
        "vaultUnder60": len(vault) < 60,
        "vaultCount": len(vault),
        "looseShelves": dict(shelves),
        "locationScheme": {
            "boxed": "VAULT-01, HOLD-01, SELL-S-01/02, SELL-L-01/02",
            "bulk": "SHELF-BULK-NN, 80 books per shelf string, never mixed with sale/vault",
            "overflow": "If a bucket needs another box, do not silently put overflow on a mixed shelf",
        },
        "p98Comics": p98_status,
        "p98TcgExcluded": tcg_note,
        "labels": labels,
        "pickListCount": len(pick),
        "totalComics": len(books),
        "pillarMix": {p: dict(d) for p, d in sorted(pillar_counts.items(), key=lambda kv: -sum(kv[1].values()))},
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "2026-09-20_liquidation_dry_run_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    manifests = {
        "generatedAt": GENERATED_AT,
        "dryRun": True,
        "boxes": {
            box: [
                {
                    "name": b["name"],
                    "holdingId": b["holdingId"],
                    "disposition": b["disposition"],
                    "lotId": b.get("lotId"),
                    "net": b["netRealizable"],
                    "source": b["priceSource"],
                }
                for b in books
                if b.get("boxId") == box
            ]
            for box in order_boxes
        },
        "looseBulk": [
            {
                "name": b["name"],
                "holdingId": b["holdingId"],
                "location": b["locationProposed"],
                "net": b["netRealizable"],
            }
            for b in bulk
        ],
        "pickList": pick,
        "lots": [
            {
                **{k: v for k, v in lot.items() if k != "books"},
                "holdings": [x["holdingId"] for x in lot["books"]],
            }
            for lot in lots
        ],
    }
    (OUT_DIR / "2026-09-20_liquidation_dry_run_manifests.json").write_text(
        json.dumps(manifests), encoding="utf-8"
    )

    print(json.dumps({k: summary[k] for k in [
        "headlineNet", "tenKReachableWithoutVault", "saleBooks", "vaultBooks",
        "gradeBooks", "holdBooks", "totalComics", "buckets", "curveHits",
        "top100", "confidenceSplit", "fit", "boxes", "vaultUnder60",
        "p98Comics", "lots", "bulkPiles", "looseShelves", "pickListCount",
    ]}, indent=2, default=str))


if __name__ == "__main__":
    main()
