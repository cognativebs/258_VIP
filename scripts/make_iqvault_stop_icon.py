"""Write assets/iqvault-stop-icon.ico (stdlib only — no Pillow)."""

from __future__ import annotations

from pathlib import Path
from struct import pack
from zlib import crc32, compress

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "iqvault-stop-icon.ico"


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return pack(">I", len(data)) + tag + data + pack(">I", crc32(tag + data) & 0xFFFFFFFF)


def _png_rgba(width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> bytes:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixels[y * width + x])
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            _png_chunk(b"IDAT", compress(bytes(raw), 9)),
            _png_chunk(b"IEND", b""),
        ]
    )


def _stop_pixels(size: int) -> list[tuple[int, int, int, int]]:
    """Charcoal tile, red circle, white stop bar."""
    cx = cy = (size - 1) / 2
    r = size * 0.38
    bar_h = max(2, round(size * 0.14))
    bar_w = max(6, round(size * 0.46))
    pixels: list[tuple[int, int, int, int]] = []
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            inside = dx * dx + dy * dy <= r * r
            on_bar = abs(y - cy) <= bar_h / 2 and abs(x - cx) <= bar_w / 2
            if inside and on_bar:
                pixels.append((255, 255, 255, 255))
            elif inside:
                pixels.append((196, 48, 43, 255))
            else:
                # transparent outside the circle so Explorer shows a round stop
                pixels.append((0, 0, 0, 0))
    return pixels


def write_ico(path: Path) -> Path:
    sizes = (32, 16)
    pngs = [_png_rgba(s, s, _stop_pixels(s)) for s in sizes]
    header = pack("<HHH", 0, 1, len(sizes))
    entries = b""
    offset = 6 + 16 * len(sizes)
    blobs = b""
    for size, png in zip(sizes, pngs, strict=True):
        entries += pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(png), offset)
        blobs += png
        offset += len(png)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + entries + blobs)
    return path


if __name__ == "__main__":
    dest = write_ico(OUT)
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
