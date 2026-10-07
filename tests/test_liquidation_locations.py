import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

from liquidation_apply_locations import era_of, pack_lots_atomic, stratified_hold_sample


def test_era_buckets():
    assert era_of(1940) == "Golden (pre-1956)"
    assert era_of(1963) == "Silver (1956–1969)"
    assert era_of(1975) == "Bronze (1970–1983)"
    assert era_of(1988) == "Copper (1984–1991)"
    assert era_of(2015) == "Modern (1992+)"
    assert era_of(None) == "Unknown"


def test_lots_never_split_across_boxes():
    def lot(lot_id: str, n: int) -> dict:
        books = [{"holdingId": f"{lot_id}-{i}", "boxId": None, "location": None} for i in range(n)]
        return {"lotId": lot_id, "count": n, "books": books}

    lots = [lot("A", 40), lot("B", 80), lot("C", 30), lot("D", 47)]
    counts = pack_lots_atomic(lots, "SELL-L-01", "SELL-L-02")
    assert sum(counts.values()) == 197
    for row in lots:
        boxes = {b["boxId"] for b in row["books"]}
        assert len(boxes) == 1
        assert row["boxId"] in boxes
    assert counts["SELL-L-01"] >= 150 or counts["SELL-L-02"] >= 150


def test_hold_sample_covers_publishers():
    hold = []
    for pub, n in [("Marvel Comics", 20), ("DC Comics", 15), ("Image Comics", 10), ("Other", 5)]:
        for i in range(n):
            hold.append({"holdingId": f"{pub}-{i}", "publisher": pub})
    sample = stratified_hold_sample(hold, 10, 20260920)
    assert len(sample) == 10
    pubs = {b["publisher"] for b in sample}
    assert pubs == {"Marvel Comics", "DC Comics", "Image Comics", "Other"}
