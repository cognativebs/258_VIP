from struct import unpack
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

from make_iqvault_stop_icon import write_ico  # noqa: E402


def test_stop_icon_is_a_two_size_windows_ico(tmp_path: Path) -> None:
    dest = write_ico(tmp_path / "iqvault-stop-icon.ico")
    data = dest.read_bytes()
    reserved, kind, count = unpack("<HHH", data[:6])
    assert reserved == 0
    assert kind == 1
    assert count == 2
    assert data[6] == 32
    assert data[22] == 16
    assert data.count(b"\x89PNG") == 2


def test_committed_stop_icon_matches_generator() -> None:
    committed = REPO / "assets" / "iqvault-stop-icon.ico"
    assert committed.is_file()
    assert committed.read_bytes().startswith(b"\x00\x00\x01\x00")
