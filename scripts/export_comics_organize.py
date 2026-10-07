"""Filterable Excel work list. Does not write holdings or create listings."""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from liquidation_apply_locations import (  # noqa: E402
    DSN,
    VAULT_KEY_PILLARS,
    classify,
    condition_label,
)

OUT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "liquidation"
    / "2026-09-22_comics_organize.xlsx"
)
TARGET_NET = 6000.0

# Sci-Fi is a sell pillar. Horror / Independent are not pillars.
FAVORED = set(VAULT_KEY_PILLARS)

ORGANIZE_ORDER = [
    "Museum",
    "Personal pillar",
    "Grade",
    "Unknown price",
    "Sell now ($6k)",
    "Bulk - make sets",
    "Bulk - sell qty",
]


def price_status(b: dict) -> str:
    if b["priceSource"] in {"guide", "ebay_ask"}:
        return "Priced"
    if (b.get("clz") or 0) > 0:
        return "CLZ only"
    return "Unknown"


def assign_organize(books: list[dict]) -> None:
    for b in books:
        b["priceStatus"] = price_status(b)
        b["countsToward6k"] = "No"
        b["setOrLot"] = b.get("lotId") or ""
        if b.get("p98"):
            b["organize"] = "Grade"
        elif b.get("recommendation") == "Museum Candidate":
            b["organize"] = "Museum"
        elif (b.get("pillar") or "") in FAVORED:
            b["organize"] = "Personal pillar"
        elif b["priceStatus"] != "Priced" or b.get("disposition") == "HOLD":
            b["organize"] = "Unknown price"
        else:
            b["organize"] = ""

    # Museum flag lives on recommendation; classify stores it only via disposition.
    # Re-read recommendation from disposition path: museum books are VAULT with
    # recommendation not copied. Pull it from the holding name path below if missing.
    pool = [
        b
        for b in books
        if b["organize"] == "" and (b.get("netRealizable") or 0) >= 5
    ]
    pool.sort(key=lambda b: -b["netRealizable"])
    running = 0.0
    for b in pool:
        if running >= TARGET_NET:
            break
        b["organize"] = "Sell now ($6k)"
        b["countsToward6k"] = "Yes"
        running += b["netRealizable"]

    rest = [b for b in books if b["organize"] == ""]
    by_series: dict[str, list[dict]] = defaultdict(list)
    for b in rest:
        by_series[b["series"] or "(no series)"].append(b)
    for series, rows in by_series.items():
        label = "Bulk - make sets" if len(rows) >= 3 else "Bulk - sell qty"
        for b in rows:
            b["organize"] = label
            if label == "Bulk - make sets":
                b["setOrLot"] = b["setOrLot"] or f"SET · {series}"


def main() -> None:
    conn = psycopg2.connect(DSN)
    plan = classify(conn)
    conn.close()
    books = plan["books"]
    # classify does not copy recommendation onto the row. Museum is disposition
    # VAULT plus the original recommendation, which we need for the Museum pile.
    # Re-query is unnecessary: vaultReasons is not on the row either.
    # Museum candidates were tagged only inside classify via local `museum`.
    # Stamp from recommendation by a second pass stored on disposition notes.
    for b in books:
        b["recommendation"] = ""
        b["vaultReasons"] = []
    # The classify loop drops recommendation. Infer museum from disposition
    # is wrong (keys are also VAULT). Patch: read recommendation in SQL via
    # the already-loaded canonical path — we add it in classify... it isn't
    # stored. Use a tiny follow-up map from a fresh query.
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id::text, recommendation
          FROM vault_collection.holding
         WHERE source = 'clz_import' AND dropped_at IS NULL
        """
    )
    recs = {r[0]: (r[1] or "") for r in cur.fetchall()}
    conn.close()
    for b in books:
        b["recommendation"] = recs.get(b["holdingId"], "")

    assign_organize(books)

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.table import Table, TableStyleInfo
    except ImportError:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl"])
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.table import Table, TableStyleInfo

    rank = {name: i for i, name in enumerate(ORGANIZE_ORDER)}
    books.sort(
        key=lambda b: (
            rank.get(b["organize"], 99),
            0 if b["organize"] == "Sell now ($6k)" else 1,
            -(b["netRealizable"] or 0) if b["organize"] == "Sell now ($6k)" else 0,
            b.get("pillar") or "",
            b.get("series") or "",
            b.get("issue") or "",
            b.get("name") or "",
        )
    )

    headers = [
        "Organize",
        "Pillar",
        "Price status",
        "Counts toward $6k",
        "Series",
        "Issue",
        "Variant",
        "Title",
        "Publisher",
        "Qty",
        "CLZ price",
        "Net if sold",
        "Price source",
        "Confidence",
        "Condition",
        "Box or shelf",
        "Set or lot",
        "Disposition",
    ]
    fills = {
        "Museum": "D9E8D3",
        "Personal pillar": "D6E3F0",
        "Grade": "FCE4D6",
        "Unknown price": "FFF2CC",
        "Sell now ($6k)": "F8CBAD",
        "Bulk - make sets": "E2D5F1",
        "Bulk - sell qty": "F2F2F2",
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "Comics"
    ws.append(headers)
    for b in books:
        ws.append(
            [
                b["organize"],
                b.get("pillar") or "",
                b["priceStatus"],
                b["countsToward6k"],
                b.get("series") or "",
                b.get("issue") or "",
                b.get("cover") or "",
                b.get("name") or "",
                b.get("publisher") or "",
                b.get("qty") or 1,
                b.get("clz") if b.get("clz") else None,
                round(b.get("netRealizable") or b.get("netSingle") or 0, 2),
                b.get("priceSource") or "",
                b.get("confidence"),
                condition_label(b),
                b.get("locationBefore") or "",
                b.get("setOrLot") or "",
                b.get("disposition") or "",
            ]
        )

    last_row = ws.max_row
    last_col = get_column_letter(len(headers))
    table = Table(displayName="ComicsOrganize", ref=f"A1:{last_col}{last_row}")
    table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(table)
    ws.freeze_panes = "A2"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F4E79")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for row in ws.iter_rows(min_row=2, max_row=last_row, min_col=1, max_col=1):
        label = row[0].value
        color = fills.get(label or "")
        if color:
            row[0].fill = PatternFill("solid", fgColor=color)
    for col in ("K", "L"):
        for cell in ws[col][1:]:
            cell.number_format = '"$"#,##0.00'
    widths = [20, 28, 14, 18, 36, 12, 28, 52, 24, 8, 12, 14, 14, 12, 28, 16, 36, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.paperSize = ws.PAPERSIZE_TABLOID
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.oddHeader.left.text = "Comics organize"
    ws.print_title_rows = "1:1"
    ws.page_setup.horizontalCentered = True
    ws.sheet_view.view = "pageBreakPreview"
    ws.page_margins.left = 0.4
    ws.page_margins.right = 0.4
    ws.page_margins.top = 0.6
    ws.page_margins.bottom = 0.5

    summary = wb.create_sheet("Summary", 0)
    summary.append(["Organize group", "Books", "CLZ $", "Net if sold", "What to do"])
    notes = {
        "Museum": "Keep together. Not in the sale.",
        "Personal pillar": "Batman, Spider-Man, X-Men, Superman, keys, art, Good Girl, favorites. Not Sci-Fi.",
        "Grade": "p98 pair — submit, do not list.",
        "Unknown price": "No trusted sale price. Pull aside and price by hand.",
        "Sell now ($6k)": "Net at least $5, outside museum and personal pillars. First cash.",
        "Bulk - make sets": "Same series, 3 or more, under $5 net. One set, not singles.",
        "Bulk - sell qty": "Leftover cheap books. Sell as a pile, not listings.",
    }
    by: dict[str, list] = defaultdict(list)
    for b in books:
        by[b["organize"]].append(b)
    for name in ORGANIZE_ORDER:
        rows = by.get(name, [])
        clz_sum = sum(b.get("clz") or 0 for b in rows)
        net_sum = sum((b.get("netRealizable") or b.get("netSingle") or 0) for b in rows)
        summary.append([name, len(rows), round(clz_sum, 2), round(net_sum, 2), notes[name]])
    sell_net = sum(b.get("netRealizable") or 0 for b in by.get("Sell now ($6k)", []))
    bulk_net = sum(
        b.get("netRealizable") or 0
        for b in by.get("Bulk - make sets", []) + by.get("Bulk - sell qty", [])
    )
    personal_if_sold = sum(
        (b.get("netRealizable") or b.get("netSingle") or 0) for b in by.get("Personal pillar", [])
    )
    gap = round(TARGET_NET - (sell_net + bulk_net), 2)
    summary.append([])
    summary.append(
        [
            "Sell now + bulk",
            "",
            "",
            round(sell_net + bulk_net, 2),
            (
                f"Reaches ${TARGET_NET:,.0f} without museum or personal pillars."
                if sell_net + bulk_net >= TARGET_NET
                else f"Short ${gap:,.2f} of $6k if museum and personal pillars stay put."
            ),
        ]
    )
    summary.append(
        [
            "Personal pillar if sold",
            "",
            "",
            round(personal_if_sold, 2),
            "Not in the sale. Filter Personal pillar and sort Net if sold only if you choose to dip in.",
        ]
    )
    summary.append(
        [
            "Generated",
            datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "",
            "",
            "Locations are the boxes already written. This file does not move them. No listings.",
        ]
    )
    for cell in summary[1]:
        cell.font = header_font
        cell.fill = header_fill
    for col, w in zip("ABCDE", (22, 12, 14, 14, 88)):
        summary.column_dimensions[col].width = w
    for row in summary.iter_rows(min_row=2, max_row=12, min_col=3, max_col=4):
        for cell in row:
            cell.number_format = '"$"#,##0.00'
    summary.freeze_panes = "A2"
    summary.page_setup.orientation = "landscape"
    summary.page_setup.fitToPage = True
    summary.page_setup.fitToWidth = 1
    summary.page_setup.fitToHeight = 1
    summary.page_setup.paperSize = summary.PAPERSIZE_TABLOID
    summary.sheet_properties.pageSetUpPr.fitToPage = True
    summary.print_title_rows = "1:1"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(OUT)
    for name in ORGANIZE_ORDER:
        rows = by.get(name, [])
        net_sum = sum(b.get("netRealizable") or 0 for b in rows)
        print(f"{name}\t{len(rows)}\t{net_sum:.2f}")
    print(f"sell_now_reaches_6k\t{sell_net >= TARGET_NET}\t{sell_net:.2f}")


if __name__ == "__main__":
    main()
