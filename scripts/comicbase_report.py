"""ComicBase exports → items, and items → VIP holdings (pure; no database).

Two ComicBase exports are read: the Collection Report (HTML, parse_report) and the item export
(CSV: Title, Item #, Qty In Stock, Item Description, Cover Date…; parse_export_csv).

A ComicBase "Collection Report" (HTML) lists, per series, the issues in stock:
  <h2>Action Comics (2nd Series)</h2><h3>DC (2011&ndash;2017)</h3>
  <b>Issues: </b>1(2), 5, 5/A, 200-2, Anl 1<br /><strong>Total Qty: </strong>6
An issue token is  [prefix ]number[/variant letter][-printing][(quantity)]:
  "5/A" = issue 5, ComicBase variant A;  "200-2" = issue 200, 2nd printing;
  "1(2)" = two copies;  "Anl 1" = Annual 1.  No letter = the regular cover.

ComicBase variant letters are not CLZ cover labels (ComicBase "5" is CLZ "A",
ComicBase "5/A" is often CLZ "B" or a named cover), so letters are never
matched blindly: one copy on each side matches; anything else is reviewed.
A quantity difference does not stop a match: ComicBase holds the newer count,
and the CLZ count is noted beside it.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

RULE_VERSION = "comicbase-report-match@0.2.0"
SOURCE = "comicbase_export"

_BLOCK = re.compile(
    r"<h2>(?P<title>.*?)</h2>\s*<h3>(?P<pub>.*?)</h3>\s*<b>Issues:\s*</b>(?P<issues>.*?)<br\s*/?>\s*"
    r"<strong>Total Qty:\s*</strong>\s*(?P<qty>\d+)",
    re.S,
)
_TOKEN = re.compile(
    r"(?:(?P<prefix>[A-Za-z]+)\s+)?(?P<num>\d+(?:\.\d+)?)(?:/(?P<var>[A-Z]{1,3}))?(?:-(?P<printing>\d+))?(?:\((?P<qty>\d+)\))?"
)
_SERIES_NO = re.compile(r"\((\d+)(?:st|nd|rd|th) Series\)", re.I)
_VOL = re.compile(r"(?:,\s*|\(\s*)Vol\.?\s*(\d+)\s*\)?", re.I)
_TRAILING_PAREN = re.compile(r"\s*\([^()]*\)\s*$")
_TAGS = re.compile(r"<[^>]+>")
# Title prefixes one catalogue uses and the other drops ("Star Wars: Han Solo" = "Han Solo").
_DROPPABLE_PREFIXES = ("star wars ", "marvel s ", "timely comics ")
_PRINTING_LABEL = re.compile(r"\b(\d+)(?:st|nd|rd|th) Printing\b", re.I)
_REGULAR_LABEL = re.compile(r"^(A|.*\bRegular\b.*|Direct Edition|First Printing|1st Printing)$", re.I)


class ReportFormatError(ValueError):
    """The file is not a ComicBase Collection Report, or a series' quantities do not add up."""


@dataclass(frozen=True)
class ComicBaseItem:
    series_title: str
    publisher: str
    year_label: str
    start_year: Optional[int]
    volume: Optional[int]
    issue_number: str
    issue_prefix: Optional[str]
    variant_letter: Optional[str]
    printing: int
    quantity: int

    @property
    def item_key(self) -> str:
        issue = f"{self.issue_prefix} {self.issue_number}" if self.issue_prefix else self.issue_number
        return "|".join(
            [
                series_key(self.series_title),
                str(self.start_year or ""),
                publisher_key(self.publisher),
                issue,
                self.variant_letter or "",
                f"p{self.printing}",
            ]
        )


def clean_title(title: str) -> str:
    return _TAGS.sub("", html.unescape(title)).strip()


def series_key(title: str) -> str:
    """'Action Comics, Vol. 2', 'Action Comics (2nd Series)' and 'G.I. Joe (Image)' lose their
    volume / publisher tags; case, punctuation, '&' and a leading (or ComicBase's inverted
    'Flash, The') 'The' are ignored."""
    t = clean_title(title)
    t = _SERIES_NO.sub("", t)
    t = _VOL.sub("", t)
    while _TRAILING_PAREN.search(t):
        t = _TRAILING_PAREN.sub("", t)
    t = re.sub(r",\s*The\b", "", t, flags=re.I)
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    t = re.sub(r"^the ", "", t)
    for prefix in _DROPPABLE_PREFIXES:
        if t.startswith(prefix) and len(t) > len(prefix):
            t = t[len(prefix):]
    return t


def series_volume(title: str) -> Optional[int]:
    t = clean_title(title)
    m = _SERIES_NO.search(t) or _VOL.search(t)
    return int(m.group(1)) if m else None


def publisher_key(publisher: str) -> str:
    """'Marvel Comics' / 'Marvel' → 'marvel'; 'Unknown' → '' (matches anything)."""
    p = html.unescape(publisher).lower()
    p = re.sub(r"\b(comics|comic|entertainment|publishing|press|inc)\b\.?", " ", p)
    p = re.sub(r"[^a-z0-9]+", " ", p).strip()
    return "" if p in ("", "unknown") else p


def parse_report(text: str) -> list[ComicBaseItem]:
    blocks = list(_BLOCK.finditer(text))
    if not blocks:
        raise ReportFormatError("no ComicBase series blocks found (expected a ComicBase Collection Report)")
    items: list[ComicBaseItem] = []
    for b in blocks:
        title = clean_title(b.group("title"))
        pub_line = html.unescape(b.group("pub")).strip()
        publisher = pub_line.split(" (")[0].strip()
        years = re.search(r"\((.*)\)\s*$", pub_line)
        year_label = years.group(1) if years else ""
        start = re.search(r"\d{4}", year_label)
        total = 0
        for raw in html.unescape(b.group("issues")).split(","):
            token = raw.strip()
            if not token:
                continue
            m = _TOKEN.fullmatch(token)
            if not m:
                raise ReportFormatError(f"unreadable issue token {token!r} in {title}")
            qty = int(m.group("qty") or 1)
            total += qty
            items.append(
                ComicBaseItem(
                    series_title=title,
                    publisher=publisher,
                    year_label=year_label,
                    start_year=int(start.group(0)) if start else None,
                    volume=series_volume(title),
                    issue_number=m.group("num"),
                    issue_prefix=m.group("prefix"),
                    variant_letter=m.group("var"),
                    printing=int(m.group("printing") or 1),
                    quantity=qty,
                )
            )
        if total != int(b.group("qty")):
            raise ReportFormatError(f"{title}: issues add up to {total}, report says {b.group('qty')}")
    return items


EXPORT_COLUMNS = ("Title", "Item #", "Qty In Stock")


def parse_export_csv(text: str, series_info: Optional[dict] = None) -> tuple[list[ComicBaseItem], dict[str, dict]]:
    """ComicBase item export (CSV) → items, plus per-item details (cover description, artist, dates, prices).

    The export has no publisher or series years. series_info maps (series_key, volume) to
    (publisher, year_label, start_year), e.g. from a Collection Report of the same database; a title it
    does not know gets its earliest cover-date year as start year (CLZ's year_began is likewise the year
    of the earliest copy owned). Rows with no stock are skipped. "Condition" is ComicBase's default
    ("NM" on every row), not a grade, so it is not carried over."""
    import csv
    import io

    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    missing = [c for c in EXPORT_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise ReportFormatError(f"not a ComicBase item export: missing column(s) {', '.join(missing)}")
    rows = [r for r in reader if int((r.get("Qty In Stock") or "0").strip() or 0) > 0]
    first_year: dict[str, int] = {}
    for r in rows:
        y = re.search(r"\d{4}", r.get("Cover Date") or "")
        if y:
            t = r["Title"].strip()
            first_year[t] = min(first_year.get(t, 9999), int(y.group(0)))
    items: list[ComicBaseItem] = []
    details: dict[str, dict] = {}
    for r in rows:
        title = clean_title(r["Title"])
        token = (r["Item #"] or "").strip()
        m = _TOKEN.fullmatch(token)
        if not m or m.group("qty"):
            raise ReportFormatError(f"unreadable item number {token!r} in {title}")
        known = (series_info or {}).get((series_key(title), series_volume(title)))
        publisher, year_label, start = known or ("", "", first_year.get(r["Title"].strip()))
        it = ComicBaseItem(
            series_title=title,
            publisher=publisher,
            year_label=year_label,
            start_year=start,
            volume=series_volume(title),
            issue_number=m.group("num"),
            issue_prefix=m.group("prefix"),
            variant_letter=m.group("var"),
            printing=int(m.group("printing") or 1),
            quantity=int(r["Qty In Stock"]),
        )
        items.append(it)
        details[it.item_key] = {
            k: (r.get(k) or "").strip()
            for k in ("Item Description", "Cover Artist", "Cover Date", "Cover Price", "Box #", "Cost", "Purchase Date")
        }
    return items, details


def series_info_from_report(items: Iterable[ComicBaseItem]) -> dict:
    """(series_key, volume) → (publisher, year_label, start_year) from Collection Report items."""
    return {(series_key(it.series_title), it.volume): (it.publisher, it.year_label, it.start_year) for it in items}


@dataclass(frozen=True)
class VipHolding:
    holding_id: str
    series_title: str
    publisher: str
    year_began: Optional[int]
    issue_number: str
    cover_label: str
    printing: int
    quantity: int

    @property
    def effective_printing(self) -> int:
        if self.printing and self.printing > 1:
            return self.printing
        m = _PRINTING_LABEL.search(self.cover_label or "")
        return int(m.group(1)) if m else 1


@dataclass
class Match:
    item: ComicBaseItem
    status: str  # matched | needs_review | unmatched
    method: str  # exact_issue | review | unmatched
    confidence: float
    reason: str
    holding_id: Optional[str] = None
    candidates: list[str] = field(default_factory=list)
    # A CLZ holding in the same series (any issue): where an unmatched item borrows series-level metadata.
    series_holding_id: Optional[str] = None


def _series_ok(item: ComicBaseItem, h: VipHolding) -> bool:
    if series_key(h.series_title) != series_key(item.series_title):
        return False
    hp, ip = publisher_key(h.publisher), publisher_key(item.publisher)
    if hp and ip and hp != ip and not (hp.startswith(ip) or ip.startswith(hp)):
        return False
    # Same start year decides (volume numbers differ between catalogues). A year apart also decides
    # unless both sides carry a volume and they differ ("The Flash (3rd Series)" 2010 is not CLZ
    # "Flash, Vol. 4" 2011). Otherwise volumes must agree, a ComicBase title without a marker being the
    # first series. CLZ year_began is the year of the earliest copy owned, so with no CLZ volume it only
    # has to fall on or after the series start.
    hv = series_volume(h.series_title)
    if item.start_year and h.year_began:
        gap = abs(item.start_year - h.year_began)
        if gap == 0 or (gap == 1 and not (hv is not None and item.volume is not None and hv != item.volume)):
            return True
    if hv is not None:
        return (item.volume or 1) == hv
    if item.start_year and h.year_began:
        return h.year_began >= item.start_year - 1
    return True


def _qty_note(cb: int, vip: int) -> str:
    return "" if cb == vip else f"; quantity from ComicBase ({cb}), CLZ had {vip}"


def _issue_key(n: str) -> str:
    return re.sub(r"^0+(?=\d)", "", n.strip().lower())


def match_items(items: Iterable[ComicBaseItem], holdings: Iterable[VipHolding]) -> list[Match]:
    """Group by series + issue + printing. One ComicBase entry and one VIP holding → matched (ComicBase's
    quantity stands). A lone regular cover against one regular-looking VIP label also matches. Everything
    else is reviewed or, with no VIP copy at all, unmatched. A holding is never matched twice."""
    items = list(items)
    holdings = list(holdings)
    groups: dict[tuple[str, int, str, str], list[ComicBaseItem]] = {}
    for it in items:
        groups.setdefault((it.item_key.split("|")[0] + "|" + str(it.start_year or ""), it.printing, _issue_key(it.issue_number), it.issue_prefix or ""), []).append(it)

    out: list[Match] = []
    used: set[str] = set()
    for (_, printing, issue, prefix), entries in groups.items():
        first = entries[0]
        series_hits = [h for h in holdings if _series_ok(first, h)]
        if prefix:
            hint = series_hits[0].holding_id if series_hits else None
            for it in entries:
                out.append(Match(it, "needs_review", "review", 0.3, f"{prefix} issue (annual / special) — confirm by hand", series_holding_id=hint))
            continue
        if not series_hits:
            for it in entries:
                out.append(Match(it, "unmatched", "unmatched", 0.0, "series not in VIP"))
            continue
        cands = [
            h for h in series_hits
            if _issue_key(h.issue_number) == issue and h.effective_printing == printing and h.holding_id not in used
        ]
        if not cands:
            for it in entries:
                out.append(Match(it, "unmatched", "unmatched", 0.0, "no VIP holding for this issue", series_holding_id=series_hits[0].holding_id))
            continue
        ids = [h.holding_id for h in cands]
        if len(entries) == 1 and len(cands) == 1:
            it, h = entries[0], cands[0]
            used.add(h.holding_id)
            reason = "one entry each side: same series, issue and printing" + _qty_note(it.quantity, h.quantity)
            out.append(Match(it, "matched", "exact_issue", 0.9 if it.quantity == h.quantity else 0.8, reason, h.holding_id, ids))
            continue
        regular = [h for h in cands if _REGULAR_LABEL.match((h.cover_label or "").strip())]
        others = [h for h in cands if h not in regular]
        cb_regular = [e for e in entries if e.variant_letter is None]
        cb_variants = [e for e in entries if e.variant_letter is not None]
        # A lone ComicBase regular cover → the one VIP regular-looking label.
        if len(entries) == 1 and len(cb_regular) == 1 and len(regular) == 1:
            it, h = entries[0], regular[0]
            used.add(h.holding_id)
            out.append(Match(it, "matched", "exact_issue", 0.8, f"regular cover → VIP '{h.cover_label}'" + _qty_note(it.quantity, h.quantity), h.holding_id, ids))
            continue
        # Regular + one variant on each side → regular with regular, variant with variant.
        if len(cb_regular) == 1 and len(cb_variants) == 1 and len(regular) == 1 and len(others) == 1:
            used.update([regular[0].holding_id, others[0].holding_id])
            r, v = cb_regular[0], cb_variants[0]
            out.append(Match(r, "matched", "exact_issue", 0.75, f"regular cover → VIP '{regular[0].cover_label}'" + _qty_note(r.quantity, regular[0].quantity), regular[0].holding_id, ids))
            out.append(Match(v, "matched", "exact_issue", 0.7, f"only variant /{v.variant_letter} → VIP '{others[0].cover_label}'" + _qty_note(v.quantity, others[0].quantity), others[0].holding_id, ids))
            continue
        for it in entries:
            label = f"/{it.variant_letter}" if it.variant_letter else " (regular)"
            out.append(Match(it, "needs_review", "review", 0.4, f"{len(entries)} ComicBase variant(s) vs {len(cands)} VIP copies — pick the cover for {it.issue_number}{label}", None, ids))
    return out
