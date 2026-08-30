"""Render readable sports-card backs so Tesseract can prove pixel ID.

Filenames are generic PaperStream IMG_#### — identity is only in the pixels.
Prefers Pillow when installed; falls back to a stdlib PNG bitmap.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

CARDS = [
    ("2021 PANINI DONRUSS FOOTBALL", "NO. 195", "BAKER MAYFIELD"),
    ("2023 PANINI PRIZM BASKETBALL", "NO. 136", "VICTOR WEMBANYAMA"),
    ("1986 TOPPS BASKETBALL", "NO. 57", "MICHAEL JORDAN"),
    ("1993 UPPER DECK BASEBALL", "NO. 449", "DEREK JETER"),
    ("2024 TOPPS BASEBALL", "NO. 1", "SHOHEI OHTANI"),
    ("2020 PANINI CONTENDERS FOOTBALL", "NO. 101", "JUSTIN HERBERT"),
    ("2018 PANINI PRIZM BASKETBALL", "NO. 280", "LUKA DONCIC"),
    ("2023 SELECT FOOTBALL", "NO. 43", "CJ STROUD"),
]


def _try_pillow() -> bool:
    try:
        from PIL import Image, ImageDraw, ImageFont  # noqa: F401
    except ImportError:
        return False
    return True


def write_fixture(dir_path: Path) -> Path:
    dir_path.mkdir(parents=True, exist_ok=True)
    if _try_pillow():
        _write_pillow(dir_path)
    else:
        _write_stdlib_png(dir_path)
    return dir_path


def _write_pillow(dir_path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    def font(size: int) -> ImageFont.ImageFont:
        for path in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
        ):
            if Path(path).is_file():
                return ImageFont.truetype(path, size)
        return ImageFont.load_default()

    def render(lines: list[str], unique: str) -> Image.Image:
        img = Image.new("RGB", (700, 980), (250, 248, 240))
        draw = ImageDraw.Draw(img)
        y = 80
        for line in lines:
            draw.text((40, y), line, fill=(20, 20, 20), font=font(36))
            y += 70
        draw.text((40, 900), unique, fill=(180, 180, 180), font=font(18))
        return img

    n = 1
    for set_line, number, player in CARDS:
        render([player, set_line.split()[0]], f"front-{n}").save(
            dir_path / f"IMG_{n:04d}.jpg", quality=92
        )
        n += 1
        render([set_line, number, player], f"back-{n}").save(
            dir_path / f"IMG_{n:04d}.jpg", quality=92
        )
        n += 1


_FONT: dict[str, tuple[int, ...]] = {
    "A": (0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001),
    "B": (0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110),
    "C": (0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110),
    "D": (0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110),
    "E": (0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111),
    "F": (0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000),
    "G": (0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110),
    "H": (0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001),
    "I": (0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110),
    "J": (0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100),
    "K": (0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001),
    "L": (0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111),
    "M": (0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0b10001),
    "N": (0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001),
    "O": (0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110),
    "P": (0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000),
    "Q": (0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101),
    "R": (0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001),
    "S": (0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110),
    "T": (0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100),
    "U": (0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110),
    "V": (0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100),
    "W": (0b10001, 0b10001, 0b10001, 0b10001, 0b10101, 0b11011, 0b10001),
    "X": (0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001),
    "Y": (0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100),
    "Z": (0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111),
    "0": (0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110),
    "1": (0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110),
    "2": (0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111),
    "3": (0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110),
    "4": (0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010),
    "5": (0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110),
    "6": (0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110),
    "7": (0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000),
    "8": (0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110),
    "9": (0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110),
    " ": (0, 0, 0, 0, 0, 0, 0),
    ".": (0, 0, 0, 0, 0, 0b00100, 0b00100),
    "-": (0, 0, 0, 0b11111, 0, 0, 0),
    "#": (0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0),
}


def _write_stdlib_png(dir_path: Path) -> None:
    n = 1
    for set_line, number, player in CARDS:
        for lines, tag in (
            ([player, set_line.split()[0]], "front"),
            ([set_line, number, player], "back"),
        ):
            w, h, px = _render_bitmap(lines, f"{tag}-{n}")
            _write_png(dir_path / f"IMG_{n:04d}.png", w, h, px)
            n += 1


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    raw = bytearray()
    row = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * row : (y + 1) * row])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )


def _render_bitmap(
    lines: list[str], unique: str, scale: int = 5
) -> tuple[int, int, bytearray]:
    width, height = 720, 400
    bg = (250, 248, 240)
    fg = (20, 20, 20)
    pixels = bytearray(bg * width * height)

    def plot(x: int, y: int, color: tuple[int, int, int]) -> None:
        if 0 <= x < width and 0 <= y < height:
            i = (y * width + x) * 3
            pixels[i : i + 3] = bytes(color)

    def glyph(ch: str, ox: int, oy: int) -> None:
        rows = _FONT.get(ch.upper(), _FONT[" "])
        for gy, bits in enumerate(rows):
            for gx in range(5):
                if bits & (1 << (4 - gx)):
                    for dy in range(scale):
                        for dx in range(scale):
                            plot(ox + gx * scale + dx, oy + gy * scale + dy, fg)

    def text(s: str, x: int, y: int) -> None:
        cx = x
        for ch in s:
            glyph(ch, cx, y)
            cx += 6 * scale

    y = 40
    for line in lines:
        text(line, 24, y)
        y += 8 * scale + 16
    text(unique, 24, height - 40)
    return width, height, pixels


if __name__ == "__main__":
    import sys

    dest = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else Path(__file__).resolve().parents[1] / "data" / "scan-inbox" / "pixel-id-v1"
    )
    write_fixture(dest)
    print(f"wrote {dest} ({len(CARDS)} cards / {len(CARDS) * 2} images)")
