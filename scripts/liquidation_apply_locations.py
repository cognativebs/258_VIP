"""Apply confirmed liquidation locations + print-ready pull sheets.

No listings. Phase 2 off. Reversible via pre-write snapshot.
"""
from __future__ import annotations

import html
import json
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from liquidation_dry_run import (  # noqa: E402
    ASK_N_MIN,
    ASK_SQL,
    BOX_FLOOR,
    BULK_FVF,
    BULK_PILE,
    BULK_SHIP,
    DSN,
    GUIDE_SQL,
    HOLDINGS_SQL,
    LOT_FVF,
    LOT_SHIP,
    P98_COMIC,
    VAULT_KEY_PILLARS,
    condition_key,
    group_lots,
    is_graded_slab,
    is_key,
    issue_num,
    money,
    net_single,
    num,
    pick_gross,
)

ROOT = Path(__file__).resolve().parents[1]
RAW_SNAP = ROOT / "data" / "raw" / "liquidation"
SHEETS = ROOT / "data" / "liquidation" / "pull-sheets"
RULE = "liquidation-location-apply@0.1.0"
SEED = 20260920
HOLD_BOX_CAP = 150  # floor and cap — do not overpack HOLD-01
HOLD_SHELF_SIZE = 50
BULK_SHELF_SIZE = 80
GENERATED_AT = datetime.now(timezone.utc).isoformat()

HOLDINGS_EXTRA_SQL = HOLDINGS_SQL.replace(
    "  h.location,\n  a.canonical_name,",
    "  h.location,\n"
    "  h.clz_metadata->>'Location' AS clz_location,\n"
    "  s.year_began,\n  a.release_year,\n"
    "  a.canonical_name,",
)


def era_of(year: int | None) -> str:
    if year is None or year <= 0:
        return "Unknown"
    if year < 1956:
        return "Golden (pre-1956)"
    if year < 1970:
        return "Silver (1956–1969)"
    if year < 1984:
        return "Bronze (1970–1983)"
    if year < 1992:
        return "Copper (1984–1991)"
    return "Modern (1992+)"


def condition_label(b: dict) -> str:
    assumed = (b.get("assumedGrade") or "").strip()
    if b.get("graded"):
        g = b.get("gradeRating")
        return f"{b.get('slab') or 'Slabbed'}" + (f" · {g}" if g else "")
    if "nm" in assumed.lower() or b.get("conditionKey") == "raw_ungraded":
        return "Raw · NM assumed · unverified"
    return assumed or (b.get("slab") or "Raw")


def clz_guess(b: dict) -> str:
    clz = (b.get("clzLocation") or "").strip()
    prev = (b.get("locationBefore") or "").strip()
    if clz and prev and clz != prev:
        return f"CLZ: {clz} · db was: {prev}"
    if clz:
        return clz
    if prev:
        return prev
    return "unlocated (CLZ blank)"


def source_label(src: str, conf: float) -> str:
    names = {
        "guide": "PriceCharting guide (baseline)",
        "ebay_ask": "eBay median ask / 1.6",
        "clz": "CLZ last resort",
        "none": "no source",
    }
    return f"{names.get(src, src)} · conf {conf:.2f}"


def lot_listing_title(lot: dict) -> str:
    books = lot["books"]
    n = len(books)
    if lot["kind"] == "series_run":
        nums = [issue_num(b["issue"]) for b in books]
        nums = [x for x in nums if x is not None]
        label = lot["label"].split(" (part")[0]
        if nums:
            lo, hi = min(nums), max(nums)
            span = f"#{lo}–#{hi}" if lo != hi else f"#{lo}"
            return f"{label} {span} comic lot ({n} books)"
        return f"{label} comic lot ({n} books)"
    if lot["kind"] == "character_pillar":
        return f"{lot['label']} — {n} comics lot"
    return f"Mixed comics lot ({n} books)"


def pack_lots_atomic(lots: list[dict], box_a: str, box_b: str) -> dict[str, int]:
    """Whole lots only. Fill box_a to the 150 floor, then balance."""
    counts = {box_a: 0, box_b: 0}
    for lot in sorted(lots, key=lambda l: -l["count"]):
        n = lot["count"]
        if counts[box_a] < BOX_FLOOR:
            box = box_a
        else:
            box = box_a if counts[box_a] <= counts[box_b] else box_b
        lot["boxId"] = box
        for b in lot["books"]:
            b["boxId"] = box
            b["location"] = box
        counts[box] += n
    return counts


def stratified_hold_sample(hold: list[dict], k: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    by_pub: dict[str, list[dict]] = defaultdict(list)
    for b in hold:
        by_pub[b["publisher"] or "Unknown"].append(b)
    pubs = sorted(by_pub.keys(), key=lambda p: (-len(by_pub[p]), p))
    picked: list[dict] = []
    used = set()
    # one from each publisher first
    for p in pubs:
        if len(picked) >= k:
            break
        choice = rng.choice(by_pub[p])
        picked.append(choice)
        used.add(choice["holdingId"])
    # fill remaining proportional to remainder size
    leftover = [b for b in hold if b["holdingId"] not in used]
    rng.shuffle(leftover)
    for b in leftover:
        if len(picked) >= k:
            break
        picked.append(b)
    return picked[:k]


def classify(conn) -> dict:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(HOLDINGS_EXTRA_SQL)
    holdings = [dict(r) for r in cur.fetchall()]
    cur.execute(GUIDE_SQL)
    guides = {(str(r["asset_id"]), r["condition_key"]): r["guide_price"] for r in cur.fetchall()}
    cur.execute(ASK_SQL, (ASK_N_MIN,))
    asks = {str(r["asset_id"]): (int(r["n"]), float(r["median_ask"])) for r in cur.fetchall()}

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
        vault_key = key and pillar in VAULT_KEY_PILLARS and pillar != "Sci-Fi"
        p98 = asset_id in P98_COMIC
        unmatched = not bool(h["map_confirmed"])
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
        elif source == "none":
            disp = "HOLD"
        elif ns >= 20:
            disp = "SELL_SINGLE"
        elif ns >= 5:
            disp = "SELL_LOT"
        else:
            disp = "BULK"
        year = num(h.get("year_began")) or num(h.get("release_year"))
        year_i = int(year) if year else None
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
                "assumedGrade": h.get("assumed_grade") or h.get("assumed_grade_col") or "",
                "gradeRating": num(h["grade_rating"]),
                "conditionKey": ck,
                "gross": money(gross),
                "netSingle": ns,
                "priceSource": source,
                "confidence": conf,
                "disposition": disp,
                "p98": p98,
                "graded": graded,
                "clz": money(clz) if clz else None,
                "locationBefore": h.get("location") or "",
                "clzLocation": h.get("clz_location") or "",
                "year": year_i,
                "era": era_of(year_i),
                "boxId": None,
                "lotId": None,
                "location": None,
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
    lots = group_lots(lot_books)
    for lot in lots:
        g = sum(x["gross"] for x in lot["books"])
        n = money(max(0.0, g * (1.0 - LOT_FVF) - LOT_SHIP))
        lot["gross"] = money(g)
        lot["net"] = n
        lot["count"] = len(lot["books"])
        lot["listingTitle"] = lot_listing_title(lot)
        for x in lot["books"]:
            x["lotId"] = lot["lotId"]
            x["netRealizable"] = money(n * (x["gross"] / g) if g else 0)
    bulk.sort(key=lambda x: (-x["gross"], x["series"], x["name"]))
    for i in range(0, len(bulk), BULK_PILE):
        pile = bulk[i : i + BULK_PILE]
        g = sum(x["gross"] for x in pile)
        n = money(max(0.0, g * (1.0 - BULK_FVF) - BULK_SHIP))
        for x in pile:
            x["netRealizable"] = money(n * (x["gross"] / g) if g else 0)
    singles.sort(key=lambda x: -x["netRealizable"])
    return {
        "books": books,
        "vault": vault,
        "grade": grade,
        "hold": hold,
        "singles": singles,
        "lots": lots,
        "lot_books": lot_books,
        "bulk": bulk,
    }


def assign_locations(plan: dict) -> None:
    vault = plan["vault"]
    vault.sort(key=lambda x: (x["pillar"], x["series"], issue_num(x["issue"]) or 0, x["name"]))
    split = (len(vault) + 1) // 2
    for i, b in enumerate(vault):
        b["location"] = "VAULT-01" if i < split else "VAULT-02"
        b["boxId"] = b["location"]

    for b in plan["singles"]:
        b["location"] = "SELL-S-01"
        b["boxId"] = "SELL-S-01"

    pack_lots_atomic(plan["lots"], "SELL-L-01", "SELL-L-02")

    hold_box: list[dict] = []
    grade_sorted = sorted(plan["grade"], key=lambda x: x["name"])
    hold_sorted = sorted(plan["hold"], key=lambda x: (x["publisher"], x["series"], issue_num(x["issue"]) or 0))
    for b in grade_sorted:
        hold_box.append(b)
    need = HOLD_BOX_CAP - len(hold_box)
    hold_box.extend(hold_sorted[: max(0, need)])
    overflow = hold_sorted[max(0, need) :]
    for b in hold_box:
        b["location"] = "HOLD-01"
        b["boxId"] = "HOLD-01"
    for i, b in enumerate(overflow):
        shelf = f"SHELF-HOLD-{(i // HOLD_SHELF_SIZE) + 1:02d}"
        b["location"] = shelf
        b["boxId"] = None

    for i, b in enumerate(plan["bulk"]):
        shelf = f"SHELF-BULK-{(i // BULK_SHELF_SIZE) + 1:02d}"
        b["location"] = shelf
        b["boxId"] = None


PAGE_CSS = """
@page { size: letter; margin: 0.55in 0.5in; }
html, body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; color: #111; }
h1 { font-size: 16pt; margin: 0 0 4px; }
h2 { font-size: 13pt; margin: 18px 0 8px; page-break-after: avoid; }
.meta { font-size: 9.5pt; color: #333; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid #ccc; padding: 5px 6px; vertical-align: top; text-align: left; }
th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; }
.chk { width: 22px; }
input[type=checkbox] { width: 14px; height: 14px; }
.lot { border: 1px solid #bbb; padding: 10px 12px; margin: 0 0 12px; page-break-inside: avoid; }
.lot h3 { margin: 0 0 4px; font-size: 12.5pt; }
.muted { color: #444; font-size: 9.5pt; }
.num { text-align: right; white-space: nowrap; }
.foot { font-size: 9pt; color: #555; margin-top: 16px; }
@media print { a { color: inherit; text-decoration: none; } }
"""


def page(title: str, subtitle: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{html.escape(title)}</title>
<style>{PAGE_CSS}</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
<p class="meta">{html.escape(subtitle)} · {html.escape(GENERATED_AT[:19])}Z · no listings · Phase 2 off</p>
{body}
<p class="foot">Mark the checkbox when the book is in the target location. Locations written to holding.location; reverse from data/raw/liquidation snapshot.</p>
</body>
</html>
"""


def html_singles(singles: list[dict]) -> str:
    rows = []
    for i, b in enumerate(singles, start=1):
        rows.append(
            "<tr>"
            f"<td class='chk'><input type='checkbox' aria-label='pulled {i}'/></td>"
            f"<td>{i}</td>"
            f"<td>{html.escape(clz_guess(b))}</td>"
            f"<td><strong>{html.escape(b['name'])}</strong><div class='muted'>"
            f"{html.escape(b['series'])} #{html.escape(str(b['issue']))}"
            f"{(' · ' + html.escape(b['cover'])) if b['cover'] else ''}</div></td>"
            f"<td>{html.escape(condition_label(b))}</td>"
            f"<td class='num'>${b['netRealizable']:.2f}</td>"
            f"<td>{html.escape(source_label(b['priceSource'], b['confidence']))}</td>"
            f"<td><strong>{html.escape(b['location'])}</strong></td>"
            "</tr>"
        )
    body = (
        "<p class='meta'>Work this list first. Sorted by net descending. "
        f"{len(singles)} books → SELL-S-01.</p>"
        "<table><thead><tr>"
        "<th class='chk'></th><th>#</th><th>Find (CLZ / last location)</th>"
        "<th>Title / issue / variant</th><th>Condition</th><th class='num'>Net</th>"
        "<th>Price source</th><th>Target</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )
    return page("Phase 1 pull sheet — 23 singles", "Net ≥ $20 · one box SELL-S-01", body)


def html_lots(lots: list[dict]) -> str:
    blocks = []
    for lot in lots:
        items = []
        for b in lot["books"]:
            items.append(
                "<tr>"
                f"<td class='chk'><input type='checkbox' aria-label='pulled {html.escape(b['name'])}'/></td>"
                f"<td>{html.escape(clz_guess(b))}</td>"
                f"<td>{html.escape(b['name'])}</td>"
                f"<td>{html.escape(condition_label(b))}</td>"
                "</tr>"
            )
        blocks.append(
            "<section class='lot'>"
            f"<h3>{html.escape(lot['label'])} · {html.escape(lot['lotId'])}</h3>"
            f"<p class='muted'>Box <strong>{html.escape(lot['boxId'])}</strong> · "
            f"{lot['count']} books · net ${lot['net']:.2f} · ships as one unit · "
            f"do not split</p>"
            f"<p><strong>Suggested listing title:</strong> {html.escape(lot['listingTitle'])}</p>"
            "<table><thead><tr><th class='chk'></th><th>Find</th><th>Book</th><th>Condition</th>"
            "</tr></thead><tbody>"
            + "".join(items)
            + "</tbody></table></section>"
        )
    body = (
        "<p class='meta'>32 lots. A lot must stay in one box and pull together.</p>"
        + "".join(blocks)
    )
    return page("Phase 2 pull sheet — 32 lots", "Packed by lot into SELL-L-01 / SELL-L-02", body)


def html_bulk(bulk: list[dict]) -> str:
    by_pub: dict[str, list[dict]] = defaultdict(list)
    by_era: dict[str, list[dict]] = defaultdict(list)
    for b in bulk:
        by_pub[b["publisher"] or "Unknown"].append(b)
        by_era[b["era"]].append(b)

    def rows(groups: dict[str, list[dict]]) -> str:
        lines = []
        for k, items in sorted(groups.items(), key=lambda kv: -sum(x["netRealizable"] for x in kv[1])):
            net = sum(x["netRealizable"] for x in items)
            lines.append(
                f"<tr><td>{html.escape(k)}</td><td class='num'>{len(items)}</td>"
                f"<td class='num'>${net:,.2f}</td></tr>"
            )
        return "".join(lines)

    total_net = sum(b["netRealizable"] for b in bulk)
    body = f"""
<p class="meta">One conversation for a dealer. {len(bulk)} books · net ${total_net:,.2f} after 13% + $15/50-book pile. Not listed. Locations SHELF-BULK-01..16.</p>
<h2>By publisher</h2>
<table><thead><tr><th>Publisher</th><th class="num">Books</th><th class="num">Net</th></tr></thead>
<tbody>{rows(by_pub)}</tbody></table>
<h2>By era</h2>
<table><thead><tr><th>Era</th><th class="num">Books</th><th class="num">Net</th></tr></thead>
<tbody>{rows(by_era)}</tbody></table>
"""
    return page("Bulk summary — dealer pitch", "Leave the pile. Do not pull book-by-book.", body)


def html_hold_sample(sample: list[dict]) -> str:
    rows = []
    for i, b in enumerate(sample, start=1):
        rows.append(
            "<tr>"
            f"<td class='chk'><input type='checkbox' aria-label='priced {i}'/></td>"
            f"<td>{i}</td>"
            f"<td>{html.escape(b['location'] or '')}</td>"
            f"<td>{html.escape(clz_guess(b))}</td>"
            f"<td><strong>{html.escape(b['name'])}</strong><div class='muted'>"
            f"{html.escape(b['publisher'])}</div></td>"
            f"<td>{html.escape(condition_label(b))}</td>"
            f"<td class='num'>{html.escape(str(b.get('clz') or '—'))}</td>"
            "<td style='min-width:70px'></td><td style='min-width:90px'></td>"
            "</tr>"
        )
    pubs = sorted({b["publisher"] or "Unknown" for b in sample})
    body = (
        f"<p class='meta'>50 HOLD books, stratified across {len(pubs)} publishers "
        f"(seed {SEED}). Manual price in the blank. If the sample shows real value, "
        "HOLD re-enters sale math. These are unmatched / no-confidence-source, not NM-assumed sale copies.</p>"
        "<table><thead><tr>"
        "<th class='chk'></th><th>#</th><th>Written location</th><th>Find (CLZ)</th>"
        "<th>Title</th><th>Condition</th><th class='num'>CLZ $</th>"
        "<th>Your $</th><th>Notes</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )
    return page("HOLD sampling worksheet — 50 books", "Manual pricing · not a listing queue", body)


def main() -> None:
    RAW_SNAP.mkdir(parents=True, exist_ok=True)
    SHEETS.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    plan = classify(conn)
    assign_locations(plan)

    all_books = plan["books"]
    snapshot = {
        "snapshottedAt": GENERATED_AT,
        "ruleOrModelVersion": RULE,
        "phase2Enabled": False,
        "listingsCreated": False,
        "note": "Pre-write holding.location. Restore with UPDATE from rows[].locationBefore.",
        "count": len(all_books),
        "rows": [
            {
                "holdingId": b["holdingId"],
                "sourceRowId": b["sourceRowId"],
                "locationBefore": b["locationBefore"] or None,
                "locationAfter": b["location"],
                "disposition": b["disposition"],
            }
            for b in all_books
        ],
    }
    snap_path = RAW_SNAP / "2026-09-20_holding_location_prewrite.json"
    snap_path.write_text(json.dumps(snapshot), encoding="utf-8")

    cur = conn.cursor()
    for b in all_books:
        cur.execute(
            """
            UPDATE vault_collection.holding
               SET location = %s, updated_at = now()
             WHERE id = %s::uuid
               AND source = 'clz_import'
            """,
            (b["location"], b["holdingId"]),
        )
    conn.commit()

    cur.execute(
        """
        SELECT location, count(*)::int
          FROM vault_collection.holding
         WHERE source = 'clz_import' AND dropped_at IS NULL
         GROUP BY 1
         ORDER BY 1
        """
    )
    counts = {r[0]: r[1] for r in cur.fetchall()}
    conn.close()

    # CLZ snapshot dollars for HOLD sample column
    for b in plan["hold"]:
        b["clz"] = None
    sample = stratified_hold_sample(plan["hold"], 50, SEED)

    (SHEETS / "01-phase1-singles.html").write_text(html_singles(plan["singles"]), encoding="utf-8")
    lots_sorted = sorted(plan["lots"], key=lambda l: (l["boxId"] or "", -l["net"], l["lotId"]))
    (SHEETS / "02-phase2-lots.html").write_text(html_lots(lots_sorted), encoding="utf-8")
    (SHEETS / "03-bulk-summary.html").write_text(html_bulk(plan["bulk"]), encoding="utf-8")
    (SHEETS / "04-hold-sample.html").write_text(html_hold_sample(sample), encoding="utf-8")
    index = page(
        "Liquidation pull sheets",
        "Print letter · checkboxes on each line",
        "<ul>"
        "<li><a href='01-phase1-singles.html'>Phase 1 — 23 singles</a></li>"
        "<li><a href='02-phase2-lots.html'>Phase 2 — 32 lots</a></li>"
        "<li><a href='03-bulk-summary.html'>Bulk summary (dealer pitch)</a></li>"
        "<li><a href='04-hold-sample.html'>HOLD sample of 50</a></li>"
        "</ul>",
    )
    (SHEETS / "index.html").write_text(index, encoding="utf-8")

    loc_counts: dict[str, int] = defaultdict(int)
    for b in all_books:
        loc_counts[b["location"] or "?"] += 1
    report = {
        "appliedAt": GENERATED_AT,
        "ruleOrModelVersion": RULE,
        "snapshot": str(snap_path.relative_to(ROOT)).replace("\\", "/"),
        "listingsCreated": False,
        "phase2Enabled": False,
        "updated": len(all_books),
        "dbCounts": counts,
        "planCounts": dict(sorted(loc_counts.items())),
        "lotBoxes": {lot["lotId"]: lot["boxId"] for lot in plan["lots"]},
        "singles": len(plan["singles"]),
        "lots": len(plan["lots"]),
        "holdSample": 50,
        "holdSampleSeed": SEED,
        "sheets": "data/liquidation/pull-sheets/",
    }
    (ROOT / "data" / "liquidation" / "2026-09-20_location_apply_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: report[k] for k in [
        "updated", "listingsCreated", "phase2Enabled", "snapshot",
        "planCounts", "singles", "lots", "sheets",
    ]}, indent=2))


if __name__ == "__main__":
    main()
