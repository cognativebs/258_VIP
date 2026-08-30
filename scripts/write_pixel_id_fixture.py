"""Render readable sports-card backs so Tesseract can prove pixel ID.

Filenames are generic PaperStream IMG_#### — identity is only in the pixels.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render_side(lines: list[str], unique: str) -> Image.Image:
    img = Image.new("RGB", (700, 980), (250, 248, 240))
    draw = ImageDraw.Draw(img)
    font = _font(36)
    y = 80
    for line in lines:
        draw.text((40, y), line, fill=(20, 20, 20), font=font)
        y += 70
    draw.text((40, 900), unique, fill=(180, 180, 180), font=_font(18))
    return img


def write_fixture(dir_path: Path) -> Path:
    dir_path.mkdir(parents=True, exist_ok=True)
    n = 1
    for set_line, number, player in CARDS:
        front = render_side([player, set_line.split()[0]], f"front-{n}")
        back = render_side([set_line, number, player], f"back-{n}")
        front.save(dir_path / f"IMG_{n:04d}.jpg", quality=92)
        n += 1
        back.save(dir_path / f"IMG_{n:04d}.jpg", quality=92)
        n += 1
    return dir_path


if __name__ == "__main__":
    import sys

    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "data" / "scan-inbox" / "pixel-id-v1"
    write_fixture(dest)
    print(f"wrote {dest} ({len(CARDS)} cards / {len(CARDS) * 2} images)")
